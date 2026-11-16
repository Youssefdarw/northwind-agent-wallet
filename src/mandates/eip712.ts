/**
 * PAYMENT MANDATES (inspired by Google's AP2 "mandates").
 *
 * A mandate is the company's signed, tamper-evident statement:
 *   "Pay <merchant> at <address> exactly <amount> for <purpose>, under policy v<N>,
 *    valid until <expiry>, at most <maxUses> times."
 *
 * It's EIP-712 typed data signed by the company signer key. The executor pays
 * ONLY against a mandate whose signature, expiry, network, asset and use-count
 * all check out, and only the exact payee + amount written in it.
 *
 * Pure module: signing takes an account object; nothing here reads .env.
 */
import { isAddressEqual, recoverTypedDataAddress, type Address, type Hex, type LocalAccount } from "viem";
import { CHAIN_ID, USDC_ADDRESS, X402_NETWORK } from "../config/network.js";
import type { PaymentRequest, PolicyDecision } from "../policy/types.js";

export interface MandateBody {
  mandateId: string;
  merchantId: string;
  merchantName: string;
  invoiceNumber: string;
  /** The agent's stated reason, recorded for audit (never evaluated by policy). */
  purpose: string;
  /** x402-protected URL the payment is for. */
  resource: string;
  payTo: Address;
  network: string;
  asset: Address;
  /** Real-world USD per payment, e.g. "4850.00" (per call for pay-per-use). */
  invoiceAmountUsd: string;
  /** Exact on-chain amount per payment, USDC atomic units (6 decimals). */
  amountAtomic: string;
  /** 1 for invoices; number of calls for pay-per-use. */
  maxUses: number;
  demoScale: string;
  policyVersion: number;
  approval: "auto" | "human";
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
  issuer: Address;
}

export interface SignedMandate {
  body: MandateBody;
  signature: Hex;
}

export const MANDATE_DOMAIN = { name: "Northwind Industrial Payment Mandate", version: "1", chainId: CHAIN_ID } as const;

export const MANDATE_TYPES = {
  Mandate: [
    { name: "mandateId", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "merchantName", type: "string" },
    { name: "invoiceNumber", type: "string" },
    { name: "purpose", type: "string" },
    { name: "resource", type: "string" },
    { name: "payTo", type: "address" },
    { name: "network", type: "string" },
    { name: "asset", type: "address" },
    { name: "invoiceAmountUsd", type: "string" },
    { name: "amountAtomic", type: "uint256" },
    { name: "maxUses", type: "uint32" },
    { name: "demoScale", type: "string" },
    { name: "policyVersion", type: "uint32" },
    { name: "approval", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "issuer", type: "address" },
  ],
} as const;

const toMessage = (b: MandateBody) => ({
  ...b,
  amountAtomic: BigInt(b.amountAtomic),
  issuedAt: BigInt(b.issuedAt),
  expiresAt: BigInt(b.expiresAt),
});

export interface BuildMandateInput {
  request: PaymentRequest;
  decision: PolicyDecision;
  resource: string;
  amountAtomic: bigint;
  demoScale: number;
  issuer: Address;
  mandateId: string;
  nowSec: number;
  ttlSec: number;
}

/** Only an "approve" decision can become a mandate. */
export function buildMandate(i: BuildMandateInput): MandateBody {
  if (i.decision.outcome !== "approve" || !i.decision.approval) {
    throw new Error(`Cannot issue a mandate for a "${i.decision.outcome}" decision (${i.decision.reason})`);
  }
  return {
    mandateId: i.mandateId,
    merchantId: i.request.merchantId,
    merchantName: i.request.merchantName,
    invoiceNumber: i.request.invoiceNumber,
    purpose: i.request.purpose.slice(0, 500),
    resource: i.resource,
    payTo: i.request.payTo as Address,
    network: X402_NETWORK,
    asset: USDC_ADDRESS,
    invoiceAmountUsd: i.request.amountUsd.toFixed(2),
    amountAtomic: i.amountAtomic.toString(),
    maxUses: i.request.billType === "pay_per_use" ? (i.request.calls ?? 1) : 1,
    demoScale: String(i.demoScale),
    policyVersion: i.decision.policyVersion,
    approval: i.decision.approval,
    issuedAt: i.nowSec,
    expiresAt: i.nowSec + i.ttlSec,
    issuer: i.issuer,
  };
}

export async function signMandate(body: MandateBody, signer: LocalAccount): Promise<SignedMandate> {
  if (!isAddressEqual(signer.address, body.issuer)) throw new Error("Signer is not the mandate issuer");
  const signature = await signer.signTypedData({
    domain: MANDATE_DOMAIN,
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message: toMessage(body),
  });
  return { body, signature };
}

export async function recoverMandateSigner(m: SignedMandate): Promise<Address> {
  return recoverTypedDataAddress({
    domain: MANDATE_DOMAIN,
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message: toMessage(m.body),
    signature: m.signature,
  });
}

export type UsableResult = { ok: true } | { ok: false; reason: string };

/** Every check the executor runs before it will pay against a mandate. */
export async function checkMandateUsable(
  m: SignedMandate,
  ctx: { expectedIssuer: Address; nowSec: number; usesSoFar: number },
): Promise<UsableResult> {
  const b = m.body;
  let signer: Address;
  try {
    signer = await recoverMandateSigner(m);
  } catch {
    return { ok: false, reason: "mandate signature is malformed" };
  }
  if (!isAddressEqual(signer, ctx.expectedIssuer) || !isAddressEqual(b.issuer, ctx.expectedIssuer))
    return { ok: false, reason: "mandate is not signed by the Northwind Industrial company key (or was altered after signing)" };
  if (b.network !== X402_NETWORK) return { ok: false, reason: `mandate network ${b.network} is not Base Sepolia` };
  if (!isAddressEqual(b.asset, USDC_ADDRESS)) return { ok: false, reason: "mandate asset is not USDC" };
  if (ctx.nowSec >= b.expiresAt) return { ok: false, reason: "mandate has expired" };
  if (ctx.nowSec < b.issuedAt - 60) return { ok: false, reason: "mandate is not valid yet" };
  if (ctx.usesSoFar >= b.maxUses) return { ok: false, reason: `mandate already used ${ctx.usesSoFar}/${b.maxUses} times` };
  if (BigInt(b.amountAtomic) <= 0n) return { ok: false, reason: "mandate amount is zero" };
  return { ok: true };
}
