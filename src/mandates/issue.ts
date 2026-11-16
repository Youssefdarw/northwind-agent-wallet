/**
 * Mandate issuance: turns an APPROVED policy decision into a signed mandate.
 * This is the only place the company signer key is loaded. It can authorize
 * payments but holds no funds; only the executor can move money.
 */
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { loadPrivateKey } from "../config/wallets.js";
import { DEMO_SCALE, usdToOnChainAtomic } from "../config/scenario.js";
import type { PaymentRequest, PolicyDecision } from "../policy/types.js";
import { buildMandate, signMandate, type SignedMandate } from "./eip712.js";

/** Invoice mandates are short-lived; a metered (pay-per-use) mandate covers a session of calls. */
const TTL_INVOICE_SEC = 15 * 60;
const TTL_METERED_SEC = 60 * 60;

export async function issueMandate(
  request: PaymentRequest,
  decision: PolicyDecision,
  resource: string,
  now = new Date(),
): Promise<SignedMandate> {
  const signer = privateKeyToAccount(loadPrivateKey("company_signer"));
  const body = buildMandate({
    request,
    decision,
    resource,
    amountAtomic: usdToOnChainAtomic(request.amountUsd, request.billType),
    demoScale: DEMO_SCALE,
    issuer: signer.address,
    mandateId: randomUUID(),
    nowSec: Math.floor(now.getTime() / 1000),
    ttlSec: request.billType === "pay_per_use" ? TTL_METERED_SEC : TTL_INVOICE_SEC,
  });
  return signMandate(body, signer);
}
