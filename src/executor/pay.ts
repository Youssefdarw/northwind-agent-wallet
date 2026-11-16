/**
 * PAYMENT EXECUTOR: the only module that loads the treasury private key.
 *
 * Public entry point: `payMandate()`. It pays ONLY against a signed mandate that
 * passes every check (company signature, expiry, network, asset, use count).
 * Then four independent locks stand between a merchant's 402 and a signature:
 *
 *   0. Mandate check: signed by the company key, unexpired, uses remaining.
 *   1. x402 spend controls: library-level cap = the mandate amount.
 *   2. onBeforePaymentCreation hook: the merchant's 402 terms (network, asset,
 *      payTo, amount) must equal the mandate exactly, or creation is aborted.
 *   3. Guarded signer: the key itself refuses to sign anything except a USDC
 *      TransferWithAuthorization on Base Sepolia to the mandate's payee for
 *      the mandate's amount.
 *
 * The agent (LLM) never imports this module.
 */
import { getAddress, isAddressEqual, parseAbi, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import type { SettleResponse } from "@x402/core/types";
import { CHAIN_ID, USDC_ADDRESS, X402_NETWORK, getPublicClient, txUrl } from "../config/network.js";
import { getAddressFor, loadPrivateKey } from "../config/wallets.js";
import { atomicToUsdc } from "../config/scenario.js";
import { checkMandateUsable, type SignedMandate } from "../mandates/eip712.js";
import { MandateStore, committedUses } from "../mandates/store.js";

export interface PaymentOrder {
  merchantId: string;
  url: string;
  payTo: Address;
  amountAtomic: bigint;
}

export type PaymentResult =
  | { status: "paid"; txHash: Hex; explorerUrl: string; payer?: string; body: unknown; note?: string }
  | { status: "refused"; reason: string }
  | {
      status: "failed";
      reason: string;
      httpStatus?: number;
      /** Reverted settlement tx, if the facilitator reported one. */
      txHash?: Hex;
      /** Set when the treasury had already signed: that authorization may still settle until validBefore. */
      authorization?: { nonce: Hex; validBefore: number };
    };

const authorizationStateAbi = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** Asks USDC directly whether an EIP-3009 authorization nonce has been used (i.e. the transfer happened). */
export async function isAuthorizationUsed(authorizer: Address, nonce: Hex): Promise<boolean> {
  const client = await getPublicClient();
  return client.readContract({
    address: USDC_ADDRESS,
    abi: authorizationStateAbi,
    functionName: "authorizationState",
    args: [authorizer, nonce],
  });
}

export class SignerRefusal extends Error {}

/**
 * Longest a signed payment authorization may stay valid. If a settlement fails, the
 * signed authorization could still be submitted by whoever holds it until it expires,
 * so short windows keep that exposure (and the wait before a safe retry) small.
 */
export const MAX_AUTHORIZATION_WINDOW_SEC = 120;

type TypedDataMsg = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** Lock 3: wraps an account so it can sign ONLY the authorized USDC transfer. Exported for tests. */
export function createGuardedSigner(
  account: LocalAccount,
  order: Pick<PaymentOrder, "payTo" | "amountAtomic">,
  onSigned?: (auth: { nonce: Hex; validBefore: number }) => void,
) {
  return {
    address: account.address,
    async signTypedData(msg: TypedDataMsg): Promise<Hex> {
      const d = msg.domain;
      const m = msg.message;
      const problems: string[] = [];
      if (msg.primaryType !== "TransferWithAuthorization") problems.push(`primaryType ${msg.primaryType}`);
      if (Number(d.chainId) !== CHAIN_ID) problems.push(`chainId ${String(d.chainId)}`);
      if (typeof d.verifyingContract !== "string" || !isAddressEqual(d.verifyingContract as Address, USDC_ADDRESS))
        problems.push(`token ${String(d.verifyingContract)}`);
      if (typeof m.to !== "string" || !isAddressEqual(m.to as Address, order.payTo)) problems.push(`payee ${String(m.to)}`);
      let value: bigint | null = null;
      try {
        value = BigInt(m.value as string | bigint);
      } catch {
        /* handled below */
      }
      if (value !== order.amountAtomic) problems.push(`amount ${String(m.value)}`);
      const window = Number(m.validBefore as bigint | string) - Math.floor(Date.now() / 1000);
      if (!(window <= MAX_AUTHORIZATION_WINDOW_SEC + 30)) problems.push(`validity window ${window}s`);
      if (problems.length) throw new SignerRefusal(`signer refused: ${problems.join(", ")}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await account.signTypedData(msg as any);
      onSigned?.({ nonce: m.nonce as Hex, validBefore: Number(m.validBefore as bigint | string) });
      return signature;
    },
  };
}

/** Locks 1–3 around one x402 request. Not exported: callers must go through payMandate(). */
async function executeOrder(order: PaymentOrder): Promise<PaymentResult> {
  await getPublicClient(); // testnet guard: throws unless the RPC is Base Sepolia
  const payTo = getAddress(order.payTo);
  const capUsd = `$${atomicToUsdc(order.amountAtomic)}`;
  const account = privateKeyToAccount(loadPrivateKey("treasury"));

  let settle: SettleResponse | undefined;
  let signed: { nonce: Hex; validBefore: number } | undefined;

  const client = new x402Client()
    // Only Base Sepolia is registered: a 402 asking for any other network has no scheme to pay with.
    .register(
      X402_NETWORK,
      new ExactEvmScheme(
        createGuardedSigner(account, { payTo, amountAtomic: order.amountAtomic }, (auth) => (signed = auth)),
      ),
    )
    // Lock 1: x402 spend controls. Cap = exactly the authorized amount.
    .setSpendControls({ maxAmountPerPayment: capUsd })
    // Lock 2: the merchant's actual terms must match the mandate.
    .onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
      const problems: string[] = [];
      if (r.network !== X402_NETWORK) problems.push(`network ${r.network} ≠ ${X402_NETWORK}`);
      if (!isAddressEqual(r.asset as Address, USDC_ADDRESS)) problems.push(`asset ${r.asset} is not USDC`);
      if (!isAddressEqual(r.payTo as Address, payTo)) problems.push(`payTo ${r.payTo} ≠ authorized ${payTo}`);
      if (BigInt(r.amount) !== order.amountAtomic)
        problems.push(`amount ${atomicToUsdc(BigInt(r.amount))} ≠ authorized ${atomicToUsdc(order.amountAtomic)} USDC`);
      if (r.maxTimeoutSeconds > MAX_AUTHORIZATION_WINDOW_SEC)
        problems.push(`merchant asks for a ${r.maxTimeoutSeconds}s authorization (max ${MAX_AUTHORIZATION_WINDOW_SEC}s)`);
      if (problems.length) return { abort: true, reason: problems.join("; ") };
    })
    .onPaymentResponse(async (ctx) => {
      settle = ctx.settleResponse;
    });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  let res: Response;
  try {
    res = await fetchWithPayment(order.url, { method: "GET" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!signed && /aborted|refused|spend|no.*(matching|suitable)|cap/i.test(msg)) return { status: "refused", reason: msg };
    return { status: "failed", reason: msg, authorization: signed };
  }

  if (!settle) {
    const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    if (header) settle = decodePaymentResponseHeader(header) as SettleResponse;
  }

  const body = await res.json().catch(() => null);

  if (res.ok && settle?.success && settle.transaction) {
    const txHash = settle.transaction as Hex;
    return { status: "paid", txHash, explorerUrl: txUrl(txHash), payer: settle.payer, body };
  }
  return {
    status: "failed",
    httpStatus: res.status,
    reason:
      // errorMessage can be a multi-line RPC dump; the first line is the useful part.
      [settle?.errorReason, settle?.errorMessage?.split("\n")[0]?.trim()].filter(Boolean).join(": ") ||
      `HTTP ${res.status}: ${JSON.stringify(body)}`,
    txHash: settle?.transaction ? (settle.transaction as Hex) : undefined,
    authorization: signed,
  };
}

/**
 * Check every outstanding authorization on this mandate against USDC itself:
 *   used on-chain            → settled_late (counts as a payment)
 *   unused and expired       → released (can never settle; frees the slot)
 *   unused, not yet expired  → stays outstanding (still counts against the mandate)
 */
export async function reconcileMandate(mandateId: string, store: MandateStore, now = new Date()) {
  const rec = store.get(mandateId);
  if (!rec) return;
  const treasury = getAddressFor("treasury");
  const nowSec = Math.floor(now.getTime() / 1000);
  for (const a of rec.attempts) {
    const auth = a.authorization;
    if (auth?.state !== "outstanding") continue;
    if (await isAuthorizationUsed(treasury, auth.nonce)) store.resolveAuthorization(mandateId, auth.nonce, "settled_late");
    else if (nowSec >= auth.validBefore) store.resolveAuthorization(mandateId, auth.nonce, "released");
  }
}

/**
 * Pay once against a signed mandate. Every attempt (paid, refused, failed) is
 * recorded on the mandate. Nothing is signed unless lock 0 passes.
 */
export async function payMandate(
  mandate: SignedMandate,
  store = new MandateStore(),
  now = new Date(),
): Promise<PaymentResult> {
  const id = mandate.body.mandateId;
  const rec = store.get(id);
  if (!rec) return { status: "refused", reason: `mandate ${id} was never issued by the policy service` };
  if (rec.mandate.signature !== mandate.signature) {
    const result: PaymentResult = { status: "refused", reason: "mandate differs from the one on record" };
    store.recordAttempt(id, { at: now.toISOString(), status: result.status, reason: result.reason });
    return result;
  }

  // Resolve earlier failed-but-signed authorizations against the chain before counting uses.
  await reconcileMandate(id, store, now);
  const fresh = store.get(id)!;
  const committed = committedUses(fresh);
  const outstanding = committed - fresh.uses;

  let result: PaymentResult;
  if (outstanding > 0 && committed >= mandate.body.maxUses) {
    const until = Math.max(...fresh.attempts.filter((a) => a.authorization?.state === "outstanding").map((a) => a.authorization!.validBefore));
    result = {
      status: "refused",
      reason:
        `${outstanding} earlier signed authorization(s) could still settle until ${new Date(until * 1000).toISOString()}; ` +
        `paying again now could exceed this mandate. Retry after that time.`,
    };
  } else {
    // Lock 0
    const usable = await checkMandateUsable(mandate, {
      expectedIssuer: getAddressFor("company_signer"),
      nowSec: Math.floor(now.getTime() / 1000),
      usesSoFar: committed,
    });
    result = usable.ok
      ? await executeOrder({
          merchantId: mandate.body.merchantId,
          url: mandate.body.resource,
          payTo: mandate.body.payTo,
          amountAtomic: BigInt(mandate.body.amountAtomic),
        })
      : { status: "refused", reason: usable.reason };
  }

  store.recordAttempt(id, {
    at: new Date().toISOString(),
    status: result.status,
    txHash: result.status !== "refused" ? result.txHash : undefined,
    explorerUrl: result.status !== "refused" && result.txHash ? txUrl(result.txHash) : undefined,
    reason: result.status === "paid" ? undefined : result.reason,
    authorization:
      result.status === "failed" && result.authorization
        ? { ...result.authorization, state: "outstanding" }
        : undefined,
  });

  // A failure after signing: ask USDC right away whether the transfer happened anyway.
  if (result.status === "failed" && result.authorization) {
    const auth = result.authorization;
    await reconcileMandate(id, store, new Date());
    const state = store.get(id)!.attempts.find((a) => a.authorization?.nonce === auth.nonce)!.authorization!.state;
    result = {
      ...result,
      reason:
        state === "settled_late"
          ? `${result.reason} (but USDC shows the transfer DID settle; counted as paid)`
          : `${result.reason} (nothing moved; the signed authorization stays counted against this mandate until ${new Date(auth.validBefore * 1000).toISOString()})`,
    };
  }
  return result;
}
