/**
 * THE POLICY ENGINE. Pure, deterministic functions.
 *
 * - No I/O, no clock, no randomness, no LLM. Same inputs → same decision.
 * - Rules read only structured fields (merchantId, payTo, network, amounts).
 *   Free text (invoice descriptions, the agent's `purpose`) is never inspected,
 *   so a prompt injection has nothing to act on here.
 * - Hard rules → "block". Soft rules → "hold" (a human can approve):
 *   the auto-approve limit and the "smart checks" a careful accountant would do
 *   (possible duplicate, purchase-order mismatch, price jump).
 *   A human approval can NOT override a hard rule.
 * - The AI may explain a decision; it never makes one.
 */
import { SOFT_RULES, type Policy, type PaymentRequest, type PolicyDecision, type PurchaseOrder, type RuleCheck, type RuleId, type SpendState } from "./types.js";

/** A subscription costing more than this × the last payment is held as a price jump. */
export const PRICE_JUMP_FACTOR = 1.25;

export const TESTNET_NETWORK = "eip155:84532";

/** Work in integer micro-dollars to avoid floating-point drift (0.1 + 0.2 ≠ 0.3). */
const micros = (usd: number) => Math.round(usd * 1_000_000);
const fmt = (usd: number) =>
  usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const invoiceKey = (r: Pick<PaymentRequest, "merchantId" | "invoiceNumber">) =>
  `${r.merchantId}:${r.invoiceNumber}`;

/** Real-world USD committed by a request: price × calls for pay-per-use, else the invoice amount. */
export function totalUsd(r: PaymentRequest): number {
  const calls = r.billType === "pay_per_use" ? (r.calls ?? 1) : 1;
  return micros(r.amountUsd) * calls / 1_000_000;
}

export interface EvaluateOptions {
  /** Set only by the dashboard's Approve button, never by the agent. */
  humanApproved?: boolean;
  /** Purchase orders the company issued (reference data). */
  purchaseOrders?: PurchaseOrder[];
}

export function evaluate(
  request: PaymentRequest,
  policy: Policy,
  state: SpendState,
  opts: EvaluateOptions = {},
): PolicyDecision {
  const checks: RuleCheck[] = [];
  const add = (rule: RuleId, passed: boolean, detail: string) => checks.push({ rule, passed, detail });

  // 1. Network: testnet only.
  add(
    "network",
    request.network === TESTNET_NETWORK && policy.network === TESTNET_NETWORK,
    request.network === TESTNET_NETWORK ? "Base Sepolia testnet" : `network ${request.network} is not Base Sepolia`,
  );

  // 2. Allowlist: merchant must be on it.
  const entry = policy.allowlist.find((e) => e.merchantId === request.merchantId);
  add(
    "allowlist",
    !!entry,
    entry ? `${entry.name} is on the allowlist` : `${request.merchantName} (${request.merchantId}) is not on the allowlist`,
  );

  // 3. Payee: the address must be the one on the allowlist for that merchant.
  const payeeOk = !!entry && entry.payTo.toLowerCase() === request.payTo.toLowerCase();
  add(
    "payee_mismatch",
    payeeOk,
    !entry
      ? "no allowlisted address to compare against"
      : payeeOk
        ? "pay-to address matches allowlist"
        : `pay-to ${request.payTo} ≠ allowlisted ${entry.payTo}`,
  );

  // 4. Amount sanity.
  const calls = request.calls ?? 1;
  const isPpu = request.billType === "pay_per_use";
  const amountOk =
    Number.isFinite(request.amountUsd) &&
    request.amountUsd > 0 &&
    Number.isInteger(calls) &&
    calls >= 1 &&
    calls <= 10_000 &&
    (isPpu || calls === 1);
  add("invalid_amount", amountOk, amountOk ? `${fmt(request.amountUsd)}${isPpu ? ` × ${calls} calls` : ""}` : "amount or call count is invalid");

  // 5. Pay-per-use price ceiling.
  const priceOk = !isPpu || micros(request.amountUsd) <= micros(policy.maxPricePerCallUsd);
  add(
    "max_price_per_call",
    priceOk,
    isPpu
      ? `${fmt(request.amountUsd)}/call ${priceOk ? "≤" : ">"} max ${fmt(policy.maxPricePerCallUsd)}/call`
      : "not pay-per-use",
  );

  // 6. Duplicate: an invoice can only be authorized once.
  const dup = !isPpu && state.committedInvoiceKeys.includes(invoiceKey(request));
  add("duplicate_invoice", !dup, dup ? `invoice ${request.invoiceNumber} was already authorized` : "first authorization for this invoice");

  // 7. Monthly budget.
  const total = totalUsd(request);
  const after = micros(state.committedUsd) + micros(total);
  const budgetOk = after <= micros(policy.monthlyBudgetUsd);
  add(
    "monthly_budget",
    budgetOk,
    `${fmt(state.committedUsd)} committed + ${fmt(total)} = ${fmt(after / 1_000_000)} ${budgetOk ? "≤" : ">"} ${fmt(policy.monthlyBudgetUsd)} budget`,
  );

  // ── Smart checks (soft: a human can approve past them) ─────────────────
  const human = !!opts.humanApproved;
  const soft = (rule: RuleId, ok: boolean, okDetail: string, failDetail: string) =>
    add(rule, ok || human, ok ? okDetail : human ? `${failDetail}: approved by a human` : failDetail);
  const history = state.history ?? [];
  const sameMerchant = history.filter((h) => h.merchantId === request.merchantId && h.invoiceNumber !== request.invoiceNumber);

  // 8. Possible duplicate: same supplier, same amount, already paid this month under ANOTHER invoice number.
  const twin = isPpu ? undefined : sameMerchant.find((h) => h.thisMonth && h.billType !== "pay_per_use" && micros(h.totalUsd) === micros(total));
  soft(
    "possible_duplicate",
    !twin,
    isPpu ? "not applicable to pay-per-use" : "no same-amount payment to this supplier this month",
    twin ? `${fmt(total)} was already paid to ${request.merchantName} this month under invoice ${twin.invoiceNumber}` : "",
  );

  // 9. Purchase order: the invoice must match a PO for this supplier, with enough left on it.
  if (request.poNumber) {
    const po = (opts.purchaseOrders ?? []).find((p) => p.number.toLowerCase() === request.poNumber!.toLowerCase());
    const invoiced = history
      .filter((h) => h.poNumber?.toLowerCase() === request.poNumber!.toLowerCase())
      .reduce((s, h) => s + micros(h.totalUsd), 0);
    const remaining = po ? micros(po.amountUsd) - invoiced : 0;
    const problem = !po
      ? `PO ${request.poNumber} doesn't exist in Northwind Industrial's purchase orders`
      : po.merchantId !== request.merchantId
        ? `PO ${po.number} was issued to a different supplier`
        : micros(total) > remaining
          ? `${fmt(total)} is more than what's left on PO ${po.number} (${fmt(remaining / 1_000_000)} of ${fmt(po.amountUsd)})`
          : null;
    soft("po_mismatch", !problem, po ? `matches PO ${po.number}: ${fmt(total)} of ${fmt(remaining / 1_000_000)} remaining` : "", problem ?? "");
  } else {
    add("po_mismatch", true, "no purchase order referenced");
  }

  // 10. Price jump: a subscription costing much more than last time.
  const last = request.billType === "subscription" ? sameMerchant.filter((h) => h.billType === "subscription").at(-1) : undefined;
  const jumped = !!last && micros(total) > micros(last.totalUsd) * PRICE_JUMP_FACTOR;
  soft(
    "price_jump",
    !jumped,
    request.billType !== "subscription"
      ? "not a subscription"
      : last
        ? `in line with last payment (${fmt(last.totalUsd)})`
        : "no earlier payment to compare",
    last ? `${fmt(total)} vs ${fmt(last.totalUsd)} last time (+${Math.round((total / last.totalUsd - 1) * 100)}%)` : "",
  );

  // 11. Auto-approve limit (soft).
  const underLimit = micros(total) <= micros(policy.autoApproveLimitUsd);
  add(
    "auto_approve_limit",
    underLimit || !!opts.humanApproved,
    underLimit
      ? `${fmt(total)} ≤ ${fmt(policy.autoApproveLimitUsd)} auto-approve limit`
      : opts.humanApproved
        ? `${fmt(total)} > ${fmt(policy.autoApproveLimitUsd)}: approved by a human`
        : `${fmt(total)} > ${fmt(policy.autoApproveLimitUsd)} auto-approve limit: needs human approval`,
  );

  const base = { totalUsd: total, checks, policyVersion: policy.version };
  const failedHard = checks.find((c) => !c.passed && !SOFT_RULES.includes(c.rule));
  if (failedHard) {
    return { ...base, outcome: "block", approval: null, firedRule: failedHard.rule, reason: failedHard.detail };
  }
  const failedSoft = checks.find((c) => !c.passed);
  if (failedSoft) {
    return { ...base, outcome: "hold", approval: null, firedRule: failedSoft.rule, reason: failedSoft.detail };
  }
  const needsHuman = human && checks.some((c) => SOFT_RULES.includes(c.rule) && c.detail.endsWith("approved by a human"));
  return {
    ...base,
    outcome: "approve",
    approval: needsHuman ? "human" : "auto",
    firedRule: null,
    reason: needsHuman ? "All hard rules passed: approved by a human" : "All rules passed: auto-approved",
  };
}

/** Validates an edited policy (e.g. from the dashboard) before it is saved. */
export function validatePolicy(p: Policy): string[] {
  const errors: string[] = [];
  const positive = (n: number, name: string) => {
    if (!Number.isFinite(n) || n <= 0) errors.push(`${name} must be a positive number`);
  };
  positive(p.monthlyBudgetUsd, "Monthly budget");
  positive(p.maxPricePerCallUsd, "Max price per call");
  if (!Number.isFinite(p.autoApproveLimitUsd) || p.autoApproveLimitUsd < 0)
    errors.push("Auto-approve limit must be zero or more");
  if (p.network !== TESTNET_NETWORK) errors.push(`Network must be ${TESTNET_NETWORK} (Base Sepolia)`);
  for (const e of p.allowlist) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(e.payTo)) errors.push(`Allowlist entry ${e.merchantId} has an invalid address`);
  }
  const ids = p.allowlist.map((e) => e.merchantId);
  if (new Set(ids).size !== ids.length) errors.push("Allowlist has duplicate merchants");
  return errors;
}
