/** On-chain USDC / ETH balance reads (Base Sepolia only, via the guarded client). */
import { erc20Abi, formatUnits, type Address } from "viem";
import { getPublicClient, USDC_ADDRESS, USDC_DECIMALS } from "../config/network.js";

/** Confirms the configured USDC contract really is USDC with 6 decimals. */
export async function verifyUsdcContract(): Promise<{ symbol: string; name: string }> {
  const client = await getPublicClient();
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (symbol !== "USDC" || decimals !== USDC_DECIMALS) {
    throw new Error(`Unexpected token at ${USDC_ADDRESS}: ${symbol} / ${decimals} decimals`);
  }
  return { symbol, name };
}

export async function getUsdcBalance(address: Address): Promise<{ raw: bigint; usdc: string }> {
  const client = await getPublicClient();
  const raw = await client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return { raw, usdc: formatUnits(raw, USDC_DECIMALS) };
}

export async function getEthBalance(address: Address): Promise<string> {
  const client = await getPublicClient();
  return formatUnits(await client.getBalance({ address }), 18);
}
