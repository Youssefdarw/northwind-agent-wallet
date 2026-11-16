/**
 * Network configuration + TESTNET GUARD.
 *
 * This project is hard-wired to Base Sepolia. Everything that touches the chain
 * goes through `getPublicClient()` / `assertTestnet()`, which refuse to run
 * against anything else (including Base mainnet, chain id 8453).
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

/** x402 / CAIP-2 identifier for Base Sepolia. */
export const X402_NETWORK = "eip155:84532" as const;
export const CHAIN = baseSepolia;
export const CHAIN_ID = 84532;

/** Circle's USDC on Base Sepolia (developers.circle.com/stablecoins/usdc-contract-addresses). */
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6;

export const EXPLORER_URL = "https://sepolia.basescan.org";
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/** Known mainnet chain ids we must never touch. */
const MAINNET_CHAIN_IDS = new Set([1, 8453, 10, 137, 42161]);

export class MainnetRefusedError extends Error {
  constructor(detail: string) {
    super(`REFUSING TO RUN: this demo is testnet-only (Base Sepolia, chain ${CHAIN_ID}). ${detail}`);
    this.name = "MainnetRefusedError";
  }
}

/** Static guard: config constants must describe Base Sepolia. */
export function assertTestnetConfig(): void {
  if (CHAIN.id !== CHAIN_ID || !CHAIN.testnet) {
    throw new MainnetRefusedError(`Configured chain is ${CHAIN.name} (${CHAIN.id}).`);
  }
  if (X402_NETWORK !== `eip155:${CHAIN_ID}`) {
    throw new MainnetRefusedError(`x402 network is ${X402_NETWORK}.`);
  }
  if (process.env.X402_NETWORK && process.env.X402_NETWORK !== X402_NETWORK) {
    throw new MainnetRefusedError(`X402_NETWORK env is ${process.env.X402_NETWORK}.`);
  }
}

/** Live guard: ask the RPC which chain it actually serves. */
export async function assertTestnet(client: PublicClient): Promise<void> {
  assertTestnetConfig();
  const liveChainId = await client.getChainId();
  if (MAINNET_CHAIN_IDS.has(liveChainId) || liveChainId !== CHAIN_ID) {
    throw new MainnetRefusedError(`RPC ${RPC_URL} reports chain id ${liveChainId}.`);
  }
}

let cached: PublicClient | undefined;

/** The only way code in this repo should get a chain client. Verifies chain id on first use. */
export async function getPublicClient(): Promise<PublicClient> {
  if (cached) return cached;
  const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) }) as PublicClient;
  await assertTestnet(client);
  cached = client;
  return client;
}

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
