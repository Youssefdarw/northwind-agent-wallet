/**
 * BILL-PAY SERVICE: the operations the agent's tools (and later the dashboard) call.
 *
 * The one path to money:
 *   proposePayment / approveHeld
 *     → invoice fetched from the merchant (amount, payee, network come from here, not the LLM)
 *     → policy engine (deterministic)              ── block / hold stop here
 *     → signed mandate (company signer key)
 *     → executor (treasury key, 4 locks) → x402 → Base Sepolia
 */
import { amountLabel, dueDateOf, getMerchant, getMerchants, merchantUrl, onChainAtomic, requestFromInvoice, vendorIdOf, type Merchant } from "../config/scenario.js";
import { getAddressFor } from "../config/wallets.js";
import { evaluate } from "../policy/engine.js";
import { PURCHASE_ORDERS } from "../config/history.js";
import { loadPolicy } from "../policy/store.js";
import { issueMandate } from "../mandates/issue.js";
import { MandateStore, committedUses } from "../mandates/store.js";
import type { SignedMandate } from "../mandates/eip712.js";
import { payMandate, reconcileMandate } from "../executor/pay.js";
import { getUsdcBalance } from "../wallets/balance.js";
import { Ledger, type BillEntry } from "./ledger.js";
import { forecast, type Cashflow, type CashflowBill } from "./cashflow.js";
import type { invoiceJson } from "../merchants/server.js";

export type Invoice = ReturnType<typeof invoiceJson>;

export interface ServiceHooks {
  /** Progress callback for long operations (e.g. 40 metered API calls). */
  onProgress?: (message: string) => void;
}

const ledger = new Ledger();
const mandates = new MandateStore();

export async function fetchInvoice(m: Merchant): Promise<Invoice> {
  const res = await fetch(merchantUrl(m, "/invoice"), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${m.name} returned HTTP ${res.status}`);
  return (await res.json()) as Invoice;
}

function baseEntry(m: Merchant, inv: Invoice): Omit<BillEntry, "payments" | "updatedAt" | "status"> {
  return {
    billId: m.id,
    merchantName: inv.merchant,
    invoiceNumber: inv.invoiceNumber,
    billType: inv.billType,
    amountUsd: inv.amountUsd,
    calls: inv.billType === "pay_per_use" ? inv.expectedCalls : undefined,
    onChainLabel: amountLabel(m),
  };
}

/** The month's bills, as merchants present them, plus their current status. */
export async function listBills() {
  const state = ledger.get();
  return Promise.all(
    getMerchants().map(async (m) => {
      const status = state.bills[m.id]?.status ?? "not_started";
      try {
        const inv = await fetchInvoice(m);
        return {
          bill_id: m.id,
          merchant: inv.merchant,
          merchant_domain: inv.domain,
          invoice_number: inv.invoiceNumber,
          type: inv.billType,
          amount_usd: inv.amountUsd,
          expected_calls: inv.expectedCalls,
          on_chain: inv.amountLabel,
          merchant_supplied_description: inv.description,
          po_number: inv.poNumber ?? null,
          source: m.source === "upload" ? `uploaded invoice (${m.upload?.fileName ?? "file"})` : m.source === "added" ? "added by the owner" : "billing inbox",
          status,
        };
      } catch (err) {
        return { bill_id: m.id, merchant: m.name, status, error: `merchant unreachable: ${(err as Error).message}` };
      }
    }),
  );
}

/** Local date as YYYY-MM-DD. */
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Cash-flow forecast for what's still open this month (warnings only; the policy still decides). */
export function cashflowStatus(treasuryUsdc: number | null, now = new Date()): Cashflow {
  const state = ledger.get();
  const policy = loadPolicy();
  const allowed = (m: Merchant) => policy.allowlist.some((e) => e.merchantId === vendorIdOf(m));
  const notCounted: string[] = [];
  const bills: CashflowBill[] = getMerchants().flatMap((m) => {
    const entry = state.bills[m.id];
    const uses = m.billType === "pay_per_use" ? (entry?.calls ?? m.expectedCalls ?? 1) : 1;
    const left = Math.max(0, uses - (entry?.payments.length ?? 0));
    const status = entry?.status ?? "not_started";
    if (!allowed(m) && status === "not_started") {
      notCounted.push(m.name);
      return [];
    }
    return {
      billId: m.id,
      name: m.name,
      status,
      amountUsd: m.amountUsd * left,
      onChainUsdc: (Number(onChainAtomic(m)) * left) / 1e6,
      dueDate: dueDateOf(m, now),
    };
  });
  return forecast({ bills, committedUsd: mandates.spendState().committedUsd, budgetUsd: policy.monthlyBudgetUsd, treasuryUsdc, today: localDate(now), notCounted });
}

export async function budgetStatus() {
  const policy = loadPolicy();
  const spend = mandates.spendState();
  const treasury = await getUsdcBalance(getAddressFor("treasury"));
  return {
    policy_version: policy.version,
    monthly_budget_usd: policy.monthlyBudgetUsd,
    committed_this_month_usd: Math.round(spend.committedUsd * 100) / 100,
    remaining_usd: Math.round((policy.monthlyBudgetUsd - spend.committedUsd) * 100) / 100,
    auto_approve_limit_usd: policy.autoApproveLimitUsd,
    max_price_per_api_call_usd: policy.maxPricePerCallUsd,
    allowlisted_merchants: policy.allowlist.map((e) => e.name),
    treasury_on_chain_test_usdc: treasury.usdc,
    today: localDate(),
    cash_flow_warnings: cashflowStatus(Number(treasury.usdc)).warnings.map((w) => w.message),
    note: "Policy amounts are real-world USD. On-chain amounts are scaled for testnet (see each bill's on_chain label).",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const MAX_CATCHUP_PASSES = 2;

/**
 * Pays every use of a mandate (1 for invoices, N for metered API calls) and records it.
 *
 * If the facilitator fails some settlements, those signed authorizations keep their
 * slots until they expire (≤ ~60s). The catch-up pass then waits for them to expire,
 * confirms on-chain that none settled, and retries only the missing payments.
 * Total paid can never exceed the mandate.
 */
async function executeMandate(billId: string, mandate: SignedMandate, hooks: ServiceHooks) {
  const id = mandate.body.mandateId;
  const n = mandate.body.maxUses;
  const failures: string[] = [];
  const paidCount = () => mandates.get(id)!.uses;
  ledger.patchBill(billId, { status: "paying" });

  /** One payment attempt. Returns false if the executor refused (stop trying). */
  const attempt = async (label: string): Promise<boolean> => {
    const r = await payMandate(mandate, mandates);
    if (r.status === "paid") {
      ledger.addPayment(billId, { txHash: r.txHash, explorerUrl: r.explorerUrl, at: new Date().toISOString() });
      ledger.event("payment", `Paid ${label}: ${r.explorerUrl}`.replace("Paid : ", "Paid: "), billId);
      hooks.onProgress?.(`  ✓ ${label ? `${label} ` : ""}paid  ${r.explorerUrl}`);
      return true;
    }
    failures.push(r.reason);
    ledger.event("payment", `${r.status}${label ? ` ${label}` : ""}: ${r.reason}`, billId);
    hooks.onProgress?.(`  ✗ ${label ? `${label} ` : ""}${r.status}: ${r.reason}`);
    if (r.status === "failed") await sleep(1000); // back off a little after a facilitator failure
    return r.status !== "refused";
  };

  // Main pass
  for (let i = 0; i < n; i++) {
    if (i > 0) await sleep(250); // be gentle with the shared testnet facilitator
    if (!(await attempt(n > 1 ? `call ${i + 1}/${n}` : ""))) break;
  }

  // Catch-up passes for payments the facilitator failed to settle
  for (let pass = 1; pass <= MAX_CATCHUP_PASSES && paidCount() < n; pass++) {
    const outstanding = mandates.get(id)!.attempts.filter((a) => a.authorization?.state === "outstanding");
    if (!outstanding.length) break; // nothing was signed-and-failed: retrying won't help
    const until = Math.max(...outstanding.map((a) => a.authorization!.validBefore));
    if (until >= mandate.body.expiresAt) break;
    const waitMs = until * 1000 - Date.now() + 3000;
    const msg =
      `${outstanding.length} payment(s) failed at the facilitator. Waiting ${Math.ceil(Math.max(0, waitMs) / 1000)}s for those ` +
      `signed authorizations to expire, then checking on-chain that none settled before retrying (pass ${pass}).`;
    ledger.event("payment", msg, billId);
    hooks.onProgress?.(`  … ${msg}`);
    await sleep(waitMs);
    await reconcileMandate(id, mandates);
    const missing = n - committedUses(mandates.get(id)!);
    if (missing <= 0) break;
    hooks.onProgress?.(`  ↻ retrying ${missing} payment(s)`);
    for (let i = 0; i < missing; i++) {
      if (i > 0) await sleep(250);
      if (!(await attempt(n > 1 ? `retry ${i + 1}/${missing}` : "retry"))) break;
    }
  }

  const paid = paidCount();
  const status = paid >= n ? "paid" : paid > 0 ? "partially_paid" : "failed";
  ledger.patchBill(billId, { status, error: status !== "paid" && failures.length ? failures[failures.length - 1] : undefined });
  const txs = ledger.bill(billId)!.payments.map((p) => p.explorerUrl);
  return {
    status,
    paid,
    of: n,
    facilitator_failures_retried: status === "paid" ? failures.length : undefined,
    last_error: status !== "paid" ? failures[failures.length - 1] : undefined,
    basescan: n > 3 ? [...txs.slice(0, 2), `…and ${txs.length - 2} more`] : txs,
  };
}

/**
 * The agent's only path to money. The agent supplies just the bill id and its reasoning;
 * everything that matters for policy (amount, payee, network, call count) comes from
 * the merchant's invoice.
 */
export async function proposePayment(billId: string, reasoning: string, hooks: ServiceHooks = {}) {
  const m = getMerchant(billId);
  const existing = ledger.bill(m.id);
  if (existing && ["paid", "paying", "awaiting_approval"].includes(existing.status)) {
    return { outcome: "no_action", status: existing.status, message: `This bill is already ${existing.status.replace("_", " ")}.` };
  }

  const inv = await fetchInvoice(m);
  const request = requestFromInvoice(inv, reasoning);
  const policy = loadPolicy();
  const decision = evaluate(request, policy, mandates.spendState(), { purchaseOrders: PURCHASE_ORDERS });

  ledger.upsertBill(m.id, baseEntry(m, inv), { agentReasoning: reasoning, decision, error: undefined });
  ledger.event("policy", `${decision.outcome.toUpperCase()}${decision.firedRule ? ` (${decision.firedRule})` : ""}: ${decision.reason}`, m.id);
  hooks.onProgress?.(`  policy v${policy.version} → ${decision.outcome.toUpperCase()}${decision.firedRule ? ` [${decision.firedRule}]` : ""}: ${decision.reason}`);

  const ruling = { outcome: decision.outcome, rule: decision.firedRule, reason: decision.reason, policy_version: policy.version };

  if (decision.outcome === "block") {
    ledger.patchBill(m.id, { status: "blocked" });
    return { ...ruling, message: "Blocked by policy. Nothing was signed and no funds moved. Do not retry." };
  }
  if (decision.outcome === "hold") {
    ledger.patchBill(m.id, { status: "awaiting_approval" });
    return {
      ...ruling,
      message: "Held for the owner. Call request_approval with a short note that explains this specific reason in plain words.",
    };
  }

  const mandate = await issueMandate(request, decision, merchantUrl(m));
  mandates.add(mandate, decision, request);
  ledger.patchBill(m.id, { mandateId: mandate.body.mandateId });
  ledger.event("policy", `Mandate ${mandate.body.mandateId} signed (${mandate.body.approval}, policy v${mandate.body.policyVersion})`, m.id);
  const payment = await executeMandate(m.id, mandate, hooks);
  return { ...ruling, mandate_id: mandate.body.mandateId, payment };
}

export async function requestApproval(billId: string, note: string) {
  const m = getMerchant(billId);
  const entry = ledger.bill(m.id);
  if (entry?.status !== "awaiting_approval") {
    return { ok: false, message: `Bill ${billId} is not awaiting approval (status: ${entry?.status ?? "not proposed"}).` };
  }
  ledger.patchBill(m.id, { approvalNote: note });
  ledger.event("approval", `Approval requested: ${note}`, m.id);
  return { ok: true, message: "Queued for the owner on the dashboard. Nothing more to do for this bill." };
}

/** Owner clicks Approve. Re-runs the full policy (budget, allowlist…) with humanApproved = true. */
export async function approveHeld(billId: string, hooks: ServiceHooks = {}) {
  const m = getMerchant(billId);
  const entry = ledger.bill(m.id);
  if (entry?.status !== "awaiting_approval") throw new Error(`${billId} is not awaiting approval`);
  const inv = await fetchInvoice(m);
  const request = requestFromInvoice(inv, entry.agentReasoning ?? "Approved by owner");
  const policy = loadPolicy();
  const decision = evaluate(request, policy, mandates.spendState(), { humanApproved: true, purchaseOrders: PURCHASE_ORDERS });
  ledger.patchBill(m.id, { decision });
  ledger.event("approval", `Owner approved. Policy v${policy.version} → ${decision.outcome.toUpperCase()}: ${decision.reason}`, m.id);
  if (decision.outcome !== "approve") {
    ledger.patchBill(m.id, { status: "blocked" });
    return { outcome: decision.outcome, reason: decision.reason };
  }
  const mandate = await issueMandate(request, decision, merchantUrl(m));
  mandates.add(mandate, decision, request);
  ledger.patchBill(m.id, { mandateId: mandate.body.mandateId });
  const payment = await executeMandate(m.id, mandate, hooks);
  return { outcome: "approve", mandate_id: mandate.body.mandateId, payment };
}

export function rejectHeld(billId: string) {
  const m = getMerchant(billId);
  const entry = ledger.bill(m.id);
  if (entry?.status !== "awaiting_approval") throw new Error(`${billId} is not awaiting approval`);
  ledger.patchBill(m.id, { status: "rejected" });
  ledger.event("approval", "Owner rejected the payment. Nothing was signed.", m.id);
  return { outcome: "rejected" };
}

export { ledger, mandates };
