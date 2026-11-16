/**
 * Independently verify a payment on Base Sepolia (don't trust the facilitator's word for it).
 *   npm run verify:tx -- 0x<txHash>
 */
import { decodeEventLog, erc20Abi, formatUnits, isAddressEqual, type Hex } from "viem";
import { getPublicClient, USDC_ADDRESS, txUrl } from "../src/config/network.js";
import { WALLET_ROLES, getAddressFor } from "../src/config/wallets.js";

const hash = process.argv[2] as Hex | undefined;
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error("Usage: npm run verify:tx -- 0x<txHash>");
  process.exit(1);
}

const names = new Map(WALLET_ROLES.map((r) => [getAddressFor(r.id).toLowerCase(), r.label]));
const label = (a: string) => names.get(a.toLowerCase()) ?? a;

const client = await getPublicClient();
const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);

console.log(`Tx ${hash}`);
console.log(`  status:          ${receipt.status} (block ${receipt.blockNumber})`);
console.log(`  submitted by:    ${tx.from}  ← x402 facilitator (paid ${receipt.gasUsed} gas)`);
console.log(`  contract called: ${tx.to}${tx.to && isAddressEqual(tx.to, USDC_ADDRESS) ? "  (USDC)" : ""}`);

for (const log of receipt.logs) {
  if (!isAddressEqual(log.address, USDC_ADDRESS)) continue;
  try {
    const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
    if (ev.eventName === "Transfer") {
      const { from, to, value } = ev.args as { from: string; to: string; value: bigint };
      console.log(`  USDC transfer:   ${label(from)} → ${label(to)}  ${formatUnits(value, 6)} USDC`);
    }
  } catch {
    /* not a Transfer event */
  }
}
console.log(`  ${txUrl(hash)}`);
