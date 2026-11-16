/**
 * The month's bill ledger: one entry per bill with its status, the agent's
 * reasoning, the policy decision, the mandate, and on-chain payments.
 * Plus an event log of everything that happened. Persisted in data/ledger.json.
 */
import { resolve } from "node:path";
import { DATA_DIR, readJson, writeJson } from "../store/json.js";
import type { BillType, PolicyDecision } from "../policy/types.js";

export type BillStatus =
  | "not_started"
  | "paying"
  | "paid"
  | "partially_paid"
  | "awaiting_approval"
  | "blocked"
  | "rejected"
  | "failed";

export interface BillPayment {
  txHash: string;
  explorerUrl: string;
  at: string;
}

export interface BillEntry {
  billId: string;
  merchantName: string;
  invoiceNumber: string;
  billType: BillType;
  amountUsd: number;
  calls?: number;
  onChainLabel: string;
  status: BillStatus;
  /** The agent's own words (1–2 sentences), saved for audit. */
  agentReasoning?: string;
  /** Note the agent left for the owner when a payment was held. */
  approvalNote?: string;
  decision?: PolicyDecision;
  mandateId?: string;
  payments: BillPayment[];
  error?: string;
  updatedAt: string;
}

export interface LedgerEvent {
  at: string;
  kind: "agent" | "tool" | "policy" | "payment" | "approval" | "system";
  billId?: string;
  message: string;
}

export interface LedgerData {
  runId: string | null;
  runStatus: "idle" | "running" | "done" | "error";
  runMode: "normal" | "compromised" | null;
  bills: Record<string, BillEntry | undefined>;
  events: LedgerEvent[];
  agentSummary?: string;
}

const empty = (): LedgerData => ({ runId: null, runStatus: "idle", runMode: null, bills: {}, events: [] });

export class Ledger {
  constructor(private readonly path = resolve(DATA_DIR, "ledger.json")) {}

  get(): LedgerData {
    return readJson<LedgerData>(this.path, empty());
  }

  private update(fn: (d: LedgerData) => void): LedgerData {
    const d = this.get();
    fn(d);
    writeJson(this.path, d);
    return d;
  }

  bill(billId: string): BillEntry | undefined {
    return this.get().bills[billId];
  }

  upsertBill(billId: string, base: Omit<BillEntry, "payments" | "updatedAt" | "status">, patch: Partial<BillEntry> = {}) {
    return this.update((d) => {
      const prev = d.bills[billId];
      d.bills[billId] = {
        status: "not_started",
        payments: [],
        ...prev,
        ...base,
        ...patch,
        updatedAt: new Date().toISOString(),
      } as BillEntry;
    }).bills[billId]!;
  }

  patchBill(billId: string, patch: Partial<BillEntry>) {
    return this.update((d) => {
      const prev = d.bills[billId];
      if (!prev) throw new Error(`No ledger entry for ${billId}`);
      d.bills[billId] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    }).bills[billId]!;
  }

  addPayment(billId: string, p: BillPayment) {
    this.update((d) => {
      d.bills[billId]!.payments.push(p);
      d.bills[billId]!.updatedAt = new Date().toISOString();
    });
  }

  event(kind: LedgerEvent["kind"], message: string, billId?: string) {
    this.update((d) => {
      d.events.push({ at: new Date().toISOString(), kind, billId, message });
    });
  }

  setRun(patch: Partial<Pick<LedgerData, "runId" | "runStatus" | "runMode" | "agentSummary">>) {
    this.update((d) => Object.assign(d, patch));
  }

  clear() {
    writeJson(this.path, empty());
  }
}
