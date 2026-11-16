/**
 * Builds what the dashboard shows. Shared by the live API server and the
 * read-only snapshot (scripts/snapshot.ts), so both show exactly the same thing.
 */
import { isAddressEqual } from "viem";
import { EXPLORER_URL, X402_NETWORK, addressUrl } from "../config/network.js";
import { getAddressFor } from "../config/wallets.js";
import { DEMO_SCALE, getMerchants, amountLabel, dueDateOf, merchantAddress, knownVendorAddress } from "../config/scenario.js";
import { PURCHASE_ORDERS } from "../config/history.js";
import { loadPolicy } from "../policy/store.js";
import { recoverMandateSigner } from "../mandates/eip712.js";
import { cashflowStatus, ledger, mandates } from "../billing/service.js";
import { AGENT_MODEL } from "../agent/run.js";
import type { BillView, DashboardState, LiveLogLine, MandateView } from "./types.js";

export interface LiveInfo {
  treasuryUsdc: string | null;
  merchantsOnline: boolean;
  liveLog: LiveLogLine[];
  busy: string | null;
  readOnly: DashboardState["readOnly"];
}

export function buildState(live: LiveInfo): DashboardState {
  const policy = loadPolicy();
  const spend = mandates.spendState();
  const l = ledger.get();
  const bills: BillView[] = getMerchants().map((m) => ({
    billId: m.id,
    merchant: m.name,
    domain: m.domain,
    invoiceNumber: m.invoiceNumber,
    billType: m.billType,
    amountUsd: m.amountUsd,
    expectedCalls: m.expectedCalls,
    onChainLabel: amountLabel(m),
    description: m.description,
    allowlisted: policy.allowlist.some((e) => e.merchantId === m.id),
    payTo: merchantAddress(m),
    knownPayTo: m.vendorId ? knownVendorAddress(m.vendorId) : null,
    custom: !!m.custom,
    vendorId: m.vendorId ?? null,
    poNumber: m.poNumber ?? null,
    source: m.source ?? "scenario",
    upload: m.upload ?? null,
    dueDate: dueDateOf(m),
    entry: l.bills[m.id],
  }));
  const treasury = getAddressFor("treasury");
  return {
    config: { network: X402_NETWORK, demoScale: DEMO_SCALE, model: AGENT_MODEL, explorer: EXPLORER_URL },
    readOnly: live.readOnly,
    treasury: { address: treasury, usdc: live.treasuryUsdc, url: addressUrl(treasury) },
    cashflow: cashflowStatus(live.treasuryUsdc === null ? null : Number(live.treasuryUsdc)),
    policy,
    budget: { committedUsd: spend.committedUsd, remainingUsd: policy.monthlyBudgetUsd - spend.committedUsd },
    bills,
    run: { status: l.runStatus, mode: l.runMode, summary: l.agentSummary, busy: live.busy },
    events: l.events.slice(-150),
    liveLog: live.liveLog.slice(-200),
    merchantsOnline: live.merchantsOnline,
    purchaseOrders: PURCHASE_ORDERS,
  };
}

/** A mandate plus a fresh check of its signature against the company signer. */
export async function mandateView(id: string): Promise<MandateView> {
  const rec = mandates.get(id);
  if (!rec) throw new Error("Unknown mandate");
  const expected = getAddressFor("company_signer");
  let recovered: string | null = null;
  try {
    recovered = await recoverMandateSigner(rec.mandate);
  } catch {
    /* invalid */
  }
  return {
    body: rec.mandate.body,
    signature: rec.mandate.signature,
    signatureValid: !!recovered && isAddressEqual(recovered as `0x${string}`, expected),
    recoveredSigner: recovered,
    expectedSigner: expected,
    uses: rec.uses,
    attempts: rec.attempts,
    decision: rec.decision,
  };
}
