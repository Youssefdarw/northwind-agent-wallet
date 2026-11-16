import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { createGuardedSigner, SignerRefusal } from "./pay.js";
import { USDC_ADDRESS } from "../config/network.js";

// Lock 3: even if every other check were bypassed, the key itself only signs
// the exact USDC transfer the mandate authorizes.
const treasury = privateKeyToAccount(generatePrivateKey());
const payee = privateKeyToAccount(generatePrivateKey()).address;
const attacker = privateKeyToAccount(generatePrivateKey()).address;
const VALID_BEFORE = Math.floor(Date.now() / 1000) + 60; // merchants ask for 60s windows
const signer = createGuardedSigner(treasury, { payTo: payee, amountAtomic: 320000n });

const transfer = (over: { domain?: object; message?: object; primaryType?: string } = {}) => ({
  domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC_ADDRESS, ...over.domain },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: over.primaryType ?? "TransferWithAuthorization",
  message: {
    from: treasury.address,
    to: payee,
    value: 320000n,
    validAfter: 0n,
    validBefore: BigInt(VALID_BEFORE),
    nonce: `0x${"11".repeat(32)}`,
    ...over.message,
  },
});

describe("Guarded treasury signer (lock 3)", () => {
  it("signs the exact authorized USDC transfer", async () => {
    const msg = transfer();
    const sig = await signer.signTypedData(msg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recoverTypedDataAddress({ ...(msg as any), signature: sig })).toBe(treasury.address);
  });

  it("reports the nonce and expiry of every authorization it signs (so failures can be tracked)", async () => {
    const seen: { nonce: string; validBefore: number }[] = [];
    const tracked = createGuardedSigner(treasury, { payTo: payee, amountAtomic: 320000n }, (a) => seen.push(a));
    await tracked.signTypedData(transfer());
    expect(seen).toEqual([{ nonce: `0x${"11".repeat(32)}`, validBefore: VALID_BEFORE }]);
    await expect(tracked.signTypedData(transfer({ message: { to: attacker } }))).rejects.toThrow();
    expect(seen).toHaveLength(1); // refused signatures are never reported as signed
  });

  it.each([
    ["a different payee", { message: { to: attacker } }],
    ["a bigger amount", { message: { value: 4850000n } }],
    ["Base mainnet", { domain: { chainId: 8453 } }],
    ["a different token", { domain: { verifyingContract: attacker } }],
    ["a Permit instead of a transfer", { primaryType: "Permit" }],
    ["an authorization valid for an hour (max is 2 minutes)", { message: { validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600) } }],
  ] as const)("refuses %s", async (_label, over) => {
    await expect(signer.signTypedData(transfer(over as object))).rejects.toBeInstanceOf(SignerRefusal);
  });
});
