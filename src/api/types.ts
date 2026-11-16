/** Shapes the dashboard reads from the API. Type-only: shared with web/. */
import type { BillEntry, LedgerEvent } from "../billing/ledger.js";
import type { Policy, BillType, PurchaseOrder } from "../policy/types.js";
import type { UploadInfo } from "../config/scenario.js";
import type { MandateBody } from "../mandates/eip712.js";
import type { PaymentAttempt } from "../mandates/store.js";
import type { Cashflow } from "../billing/cashflow.js";

export interface BillView {
  billId: string;
  merchant: string;
  domain: string;
  invoiceNumber: string;
  billType: BillType;
  amountUsd: number;
  expectedCalls?: number;
  onChainLabel: string;
  /** Merchant-supplied text (untrusted). */
  description: string;
  allowlisted: boolean;
  /** The only wallet this merchant can be paid at. */
  payTo: string;
  /** Uploaded invoices from a supplier on file: that supplier's known wallet. */
  knownPayTo: string | null;
  /** Added by the owner from the dashboard (removable). */
  custom: boolean;
  /** Uploaded invoice linked to a supplier on file: that supplier's id. */
  vendorId: string | null;
  poNumber: string | null;
  source: "scenario" | "added" | "upload";
  upload: UploadInfo | null;
  /** YYYY-MM-DD or null. */
  dueDate: string | null;
  entry?: BillEntry;
}

export interface LiveLogLine {
  at: string;
  kind: "agent" | "tool" | "progress" | "error" | "system";
  text: string;
}

export interface DashboardState {
  config: { network: string; demoScale: number; model: string; explorer: string };
  /**
   * null: the full local dashboard.
   * "server": READ_ONLY=1, nothing can be changed (Ask may still work).
   * "snapshot": a static copy for sharing; no server at all.
   */
  readOnly: { mode: "server" | "snapshot"; askEnabled: boolean; takenAt: string } | null;
  treasury: { address: string; usdc: string | null; url: string };
  cashflow: Cashflow;
  policy: Policy;
  budget: { committedUsd: number; remainingUsd: number };
  bills: BillView[];
  run: { status: "idle" | "running" | "done" | "error"; mode: "normal" | "compromised" | null; summary?: string; busy: string | null };
  events: LedgerEvent[];
  liveLog: LiveLogLine[];
  merchantsOnline: boolean;
  purchaseOrders: PurchaseOrder[];
}

export interface InvoiceDraft {
  id: string;
  fileName: string;
  extraction: import("../invoices/extract.js").InvoiceExtraction;
  computed: string[];
  suggestion: { vendorId: string | null; why: string };
  vendors: { id: string; name: string; domain: string; payTo: string }[];
}

export interface MandateView {
  body: MandateBody;
  signature: string;
  signatureValid: boolean;
  recoveredSigner: string | null;
  expectedSigner: string;
  uses: number;
  attempts: PaymentAttempt[];
  decision: BillEntry["decision"];
}
