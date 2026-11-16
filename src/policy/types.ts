/** Policy engine types. No runtime imports: pure data shapes (plus the SOFT_RULES list). */

export type BillType = "subscription" | "pay_per_use" | "invoice";

export interface AllowlistEntry {
  merchantId: string;
  name: string;
  /** The ONLY address this merchant may be paid at. */
  payTo: `0x${string}`;
}

/** The owner's rules. Editable from the dashboard; every edit bumps `version`. */
export interface Policy {
  version: number;
  updatedAt: string;
  /** Real-world USD the agent may commit per calendar month. */
  monthlyBudgetUsd: number;
  /** Above this (per payment, real-world USD) a human must approve. */
  autoApproveLimitUsd: number;
  /** Pay-per-use ceiling per API call (real-world USD). */
  maxPricePerCallUsd: number;
  allowlist: AllowlistEntry[];
  /** Must be Base Sepolia. */
  network: string;
}

/**
 * What gets evaluated. Built by the system from the merchant's invoice
 * (amount, payTo, network), not typed in by the LLM. `purpose` is the agent's
 * own words: stored on the mandate for audit, NEVER read by any rule.
 */
export interface PaymentRequest {
  merchantId: string;
  merchantName: string;
  payTo: string;
  network: string;
  billType: BillType;
  /** Real-world USD. For pay_per_use: price per call. */
  amountUsd: number;
  /** pay_per_use only: number of calls this authorization covers. */
  calls?: number;
  invoiceNumber: string;
  /** Purchase order the invoice references, if any (e.g. "PO-TEST-02"). */
  poNumber?: string;
  purpose: string;
}

/** A purchase order Northwind Industrial issued to a supplier (reference data, set by the company). */
export interface PurchaseOrder {
  number: string;
  merchantId: string;
  amountUsd: number;
  description: string;
  issuedAt: string;
}

/** A payment already authorized (this month or earlier). Used by the smart checks. */
export interface PaidRecord {
  merchantId: string;
  invoiceNumber: string;
  billType: BillType;
  totalUsd: number;
  poNumber?: string;
  /** ISO date. */
  at: string;
  /** Precomputed by the caller so the engine never reads a clock. */
  thisMonth: boolean;
}

/** What has already been committed this month (derived from issued mandates). */
export interface SpendState {
  committedUsd: number;
  /** `${merchantId}:${invoiceNumber}` for every invoice that already has a mandate. */
  committedInvoiceKeys: string[];
  /** Earlier payments (previous months + this month), oldest first. Optional: no history → smart checks pass. */
  history?: PaidRecord[];
}

export type Outcome = "approve" | "hold" | "block";

export type RuleId =
  | "network"
  | "allowlist"
  | "payee_mismatch"
  | "invalid_amount"
  | "max_price_per_call"
  | "duplicate_invoice"
  | "monthly_budget"
  | "possible_duplicate"
  | "po_mismatch"
  | "price_jump"
  | "auto_approve_limit";

/** Rules a human can approve past (→ "hold"). Every other failed rule → "block". */
export const SOFT_RULES: readonly RuleId[] = ["possible_duplicate", "po_mismatch", "price_jump", "auto_approve_limit"];

export interface RuleCheck {
  rule: RuleId;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  outcome: Outcome;
  /** How an approval was reached. null unless outcome is "approve". */
  approval: "auto" | "human" | null;
  /** The rule that caused a hold or block. null on approve. */
  firedRule: RuleId | null;
  reason: string;
  /** Real-world USD this authorization commits (price × calls for pay-per-use). */
  totalUsd: number;
  /** Every rule, in evaluation order, with its result. */
  checks: RuleCheck[];
  policyVersion: number;
}
