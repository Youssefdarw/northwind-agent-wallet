/** Persists mandates, their policy decisions, and every payment attempt made against them. */
import { resolve } from "node:path";
import { DATA_DIR, readJson, writeJson } from "../store/json.js";
import { invoiceKey } from "../policy/engine.js";
import type { PaidRecord, PaymentRequest, PolicyDecision, SpendState } from "../policy/types.js";
import { PAST_PAYMENTS } from "../config/history.js";
import type { SignedMandate } from "./eip712.js";

/**
 * A signed EIP-3009 authorization whose settlement was reported as failed.
 * Until it expires (validBefore) anyone holding it (facilitator, merchant) could
 * still submit it, so it keeps counting against the mandate until resolved.
 */
export interface SignedAuthorization {
  nonce: `0x${string}`;
  /** Unix seconds; after this the authorization can never settle. */
  validBefore: number;
  /** outstanding → still counts against the mandate; released → expired unused; settled_late → it did settle. */
  state: "outstanding" | "released" | "settled_late";
}

export interface PaymentAttempt {
  at: string;
  status: "paid" | "refused" | "failed";
  txHash?: string;
  explorerUrl?: string;
  reason?: string;
  /** Present when a failure happened AFTER the treasury signed (funds could still move). */
  authorization?: SignedAuthorization;
}

/** Uses consumed + authorizations that could still settle. Never let this exceed maxUses. */
export const committedUses = (rec: MandateRecord) =>
  rec.uses + rec.attempts.filter((a) => a.authorization?.state === "outstanding").length;

export interface MandateRecord {
  mandate: SignedMandate;
  decision: PolicyDecision;
  /** The request the policy approved (kept for history-based checks; not part of the signed mandate). */
  request?: PaymentRequest;
  uses: number;
  attempts: PaymentAttempt[];
}

export class MandateStore {
  constructor(private readonly path = resolve(DATA_DIR, "mandates.json")) {}

  all(): MandateRecord[] {
    return readJson<MandateRecord[]>(this.path, []);
  }

  get(mandateId: string): MandateRecord | undefined {
    return this.all().find((r) => r.mandate.body.mandateId === mandateId);
  }

  add(mandate: SignedMandate, decision: PolicyDecision, request?: PaymentRequest): MandateRecord {
    const records = this.all();
    if (records.some((r) => r.mandate.body.mandateId === mandate.body.mandateId)) {
      throw new Error(`Mandate ${mandate.body.mandateId} already exists`);
    }
    const rec: MandateRecord = { mandate, decision, request, uses: 0, attempts: [] };
    writeJson(this.path, [...records, rec]);
    return rec;
  }

  recordAttempt(mandateId: string, attempt: PaymentAttempt): MandateRecord {
    const records = this.all();
    const rec = records.find((r) => r.mandate.body.mandateId === mandateId);
    if (!rec) throw new Error(`Unknown mandate ${mandateId}`);
    rec.attempts.push(attempt);
    if (attempt.status === "paid") rec.uses += 1;
    writeJson(this.path, records);
    return rec;
  }

  /** Resolve an outstanding authorization (after checking the chain). settled_late counts as a use. */
  resolveAuthorization(mandateId: string, nonce: string, state: "released" | "settled_late"): MandateRecord {
    const records = this.all();
    const rec = records.find((r) => r.mandate.body.mandateId === mandateId);
    const attempt = rec?.attempts.find((a) => a.authorization?.nonce === nonce);
    if (!rec || !attempt?.authorization) throw new Error(`Unknown authorization ${nonce} on mandate ${mandateId}`);
    if (attempt.authorization.state !== "outstanding") return rec;
    attempt.authorization.state = state;
    if (state === "settled_late") rec.uses += 1;
    writeJson(this.path, records);
    return rec;
  }

  /** Budget already committed this calendar month = every mandate issued this month, plus payment history for the smart checks. */
  spendState(now = new Date()): SpendState {
    const month = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const all = this.all();
    const thisMonth = all.filter((r) => month(new Date(r.mandate.body.issuedAt * 1000)) === month(now));
    const fromMandates: PaidRecord[] = all.map((r) => ({
      merchantId: r.mandate.body.merchantId,
      invoiceNumber: r.mandate.body.invoiceNumber,
      billType: r.request?.billType ?? (r.mandate.body.maxUses > 1 ? "pay_per_use" : "invoice"),
      totalUsd: r.decision.totalUsd,
      poNumber: r.request?.poNumber,
      at: new Date(r.mandate.body.issuedAt * 1000).toISOString(),
      thisMonth: month(new Date(r.mandate.body.issuedAt * 1000)) === month(now),
    }));
    const past: PaidRecord[] = PAST_PAYMENTS.map((p) => ({ ...p, thisMonth: month(new Date(p.at)) === month(now) }));
    return {
      committedUsd: thisMonth.reduce((sum, r) => sum + r.decision.totalUsd, 0),
      committedInvoiceKeys: thisMonth.map((r) => invoiceKey(r.mandate.body)),
      history: [...past, ...fromMandates].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }

  clear(): void {
    writeJson(this.path, []);
  }
}
