import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMandate, checkMandateUsable, signMandate, type MandateBody, type SignedMandate } from "./eip712.js";
import { MandateStore, committedUses } from "./store.js";
import { evaluate, TESTNET_NETWORK } from "../policy/engine.js";
import { BUILTIN_MERCHANTS, getMerchant, usdToOnChainAtomic } from "../config/scenario.js";
import type { PaymentRequest, Policy } from "../policy/types.js";

const company = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());
const addr = Object.fromEntries(BUILTIN_MERCHANTS.map((m) => [m.id, privateKeyToAccount(generatePrivateKey()).address]));
const policy: Policy = {
  version: 3,
  updatedAt: "2026-11-01T00:00:00.000Z",
  monthlyBudgetUsd: 6000,
  autoApproveLimitUsd: 500,
  maxPricePerCallUsd: 0.05,
  network: TESTNET_NETWORK,
  allowlist: BUILTIN_MERCHANTS.filter((m) => m.id !== "cheap_parts_shop").map((m) => ({ merchantId: m.id, name: m.name, payTo: addr[m.id] })),
};
const empty = { committedUsd: 0, committedInvoiceKeys: [] };
const NOW = 1_794_000_000; // fixed clock

function req(id: string): PaymentRequest {
  const m = getMerchant(id);
  return {
    merchantId: m.id,
    merchantName: m.name,
    payTo: addr[m.id],
    network: TESTNET_NETWORK,
    billType: m.billType,
    amountUsd: m.amountUsd,
    calls: m.expectedCalls,
    invoiceNumber: m.invoiceNumber,
    purpose: "Monthly bill",
  };
}

async function mandateFor(id: string, opts: { humanApproved?: boolean } = {}): Promise<SignedMandate> {
  const r = req(id);
  const decision = evaluate(r, policy, empty, opts);
  const body = buildMandate({
    request: r,
    decision,
    resource: `http://localhost:4104/invoice/pay`,
    amountAtomic: usdToOnChainAtomic(r.amountUsd, r.billType, 0.001),
    demoScale: 0.001,
    issuer: company.address,
    mandateId: `m-${id}`,
    nowSec: NOW,
    ttlSec: 900,
  });
  return signMandate(body, company);
}

const ctx = (over: Partial<{ nowSec: number; usesSoFar: number }> = {}) => ({
  expectedIssuer: company.address,
  nowSec: NOW + 10,
  usesSoFar: 0,
  ...over,
});

const tamper = (m: SignedMandate, patch: Partial<MandateBody>): SignedMandate => ({ ...m, body: { ...m.body, ...patch } });

describe("Mandates (AP2-style, EIP-712 signed by the company key)", () => {
  it("records merchant, amount (both scales), purpose, policy version, timestamps and issuer", async () => {
    const m = await mandateFor("freight_forwarder");
    expect(m.body).toMatchObject({
      merchantId: "freight_forwarder",
      invoiceAmountUsd: "320.00",
      amountAtomic: "320000", // $320 × 0.001 = 0.32 USDC
      maxUses: 1,
      policyVersion: 3,
      approval: "auto",
      issuedAt: NOW,
      expiresAt: NOW + 900,
      issuer: company.address,
      network: TESTNET_NETWORK,
    });
    expect(m.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("a valid mandate is usable", async () => {
    expect(await checkMandateUsable(await mandateFor("hosting"), ctx())).toEqual({ ok: true });
  });

  it("Fabrikam: no mandate can exist before the owner approves; after approval it's stamped 'human'", async () => {
    await expect(mandateFor("parts_supplier")).rejects.toThrow(/hold/);
    const m = await mandateFor("parts_supplier", { humanApproved: true });
    expect(m.body.approval).toBe("human");
    expect(m.body.amountAtomic).toBe("4850000"); // $4,850 → 4.85 USDC
  });

  it("injected cheap-parts invoice: no mandate can be issued for a blocked decision", async () => {
    await expect(mandateFor("cheap_parts_shop")).rejects.toThrow(/block/);
  });

  it("pay-per-use: one mandate covers N calls, each unscaled ($0.01 → 0.01 USDC)", async () => {
    const m = await mandateFor("ai_quoting_api");
    expect(m.body.maxUses).toBe(40);
    expect(m.body.amountAtomic).toBe("10000");
    expect((await checkMandateUsable(m, ctx({ usesSoFar: 39 }))).ok).toBe(true);
    expect(await checkMandateUsable(m, ctx({ usesSoFar: 40 }))).toEqual({ ok: false, reason: "mandate already used 40/40 times" });
  });

  it.each([
    ["amount raised after signing", { amountAtomic: "4850000" }],
    ["payee swapped after signing", { payTo: addr.cheap_parts_shop }],
    ["expiry extended after signing", { expiresAt: NOW + 999_999 }],
    ["uses increased after signing", { maxUses: 100 }],
  ] as const)("rejects a tampered mandate: %s", async (_label, patch) => {
    const m = tamper(await mandateFor("freight_forwarder"), patch as Partial<MandateBody>);
    const r = await checkMandateUsable(m, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not signed by the Northwind Industrial company key/);
  });

  it("rejects a mandate forged with another key", async () => {
    const m = await mandateFor("hosting");
    const forged = await signMandate({ ...m.body, issuer: attacker.address }, attacker);
    expect((await checkMandateUsable(forged, ctx())).ok).toBe(false);
  });

  it("rejects an expired mandate and a one-shot mandate that was already used", async () => {
    const m = await mandateFor("hosting");
    expect(await checkMandateUsable(m, ctx({ nowSec: NOW + 900 }))).toEqual({ ok: false, reason: "mandate has expired" });
    expect(await checkMandateUsable(m, ctx({ usesSoFar: 1 }))).toEqual({ ok: false, reason: "mandate already used 1/1 times" });
  });

  it("refuses to sign with a key that isn't the named issuer", async () => {
    const m = await mandateFor("hosting");
    await expect(signMandate(m.body, attacker)).rejects.toThrow(/not the mandate issuer/);
  });
});

describe("MandateStore", () => {
  it("tracks committed budget, invoice keys, and counts only successful payments as uses", async () => {
    const store = new MandateStore(join(mkdtempSync(join(tmpdir(), "nw-")), "mandates.json"));
    const r = req("freight_forwarder");
    const decision = evaluate(r, policy, empty);
    const m = await mandateFor("freight_forwarder");
    store.add(m, decision);

    const now = new Date(NOW * 1000);
    expect(store.spendState(now)).toMatchObject({ committedUsd: 320, committedInvoiceKeys: ["freight_forwarder:TEST-FRT-0002"] });
    expect(store.spendState(now).history?.filter((h) => h.thisMonth).map((h) => h.invoiceNumber)).toEqual(["TEST-FRT-0002"]);

    store.recordAttempt(m.body.mandateId, { at: "t1", status: "failed", reason: "facilitator timeout" });
    expect(store.get(m.body.mandateId)?.uses).toBe(0);
    store.recordAttempt(m.body.mandateId, { at: "t2", status: "paid", txHash: "0xabc" });
    expect(store.get(m.body.mandateId)?.uses).toBe(1);
    expect(() => store.add(m, decision)).toThrow(/already exists/);
  });

  it("a failed-but-signed authorization keeps counting against the mandate until resolved", async () => {
    const store = new MandateStore(join(mkdtempSync(join(tmpdir(), "nw-")), "mandates.json"));
    const r = req("ai_quoting_api");
    const m = await mandateFor("ai_quoting_api"); // maxUses 40
    store.add(m, evaluate(r, policy, empty));
    const id = m.body.mandateId;

    store.recordAttempt(id, { at: "t1", status: "paid", txHash: "0x1" });
    store.recordAttempt(id, {
      at: "t2",
      status: "failed",
      reason: "invalid_exact_evm_transaction_failed",
      authorization: { nonce: "0xaa", validBefore: NOW + 300, state: "outstanding" },
    });
    store.recordAttempt(id, {
      at: "t3",
      status: "failed",
      reason: "invalid_exact_evm_transaction_failed",
      authorization: { nonce: "0xbb", validBefore: NOW + 300, state: "outstanding" },
    });
    expect(committedUses(store.get(id)!)).toBe(3); // 1 paid + 2 that could still settle

    store.resolveAuthorization(id, "0xaa", "released"); // expired, never used → slot freed
    expect(committedUses(store.get(id)!)).toBe(2);
    store.resolveAuthorization(id, "0xbb", "settled_late"); // it went through after all → a real use
    expect(store.get(id)!.uses).toBe(2);
    expect(committedUses(store.get(id)!)).toBe(2);
    store.resolveAuthorization(id, "0xbb", "released"); // already resolved: no double counting
    expect(store.get(id)!.uses).toBe(2);
  });
});
