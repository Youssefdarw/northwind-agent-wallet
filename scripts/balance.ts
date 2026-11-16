/** Phase 1: read every wallet's test-USDC (and ETH) balance from Base Sepolia. */
import { getPublicClient, USDC_ADDRESS, addressUrl } from "../src/config/network.js";
import { WALLET_ROLES, getAddressFor } from "../src/config/wallets.js";
import { getEthBalance, getUsdcBalance, verifyUsdcContract } from "../src/wallets/balance.js";

const client = await getPublicClient(); // throws unless the RPC is Base Sepolia
const block = await client.getBlockNumber();
const token = await verifyUsdcContract();

console.log(`Network: Base Sepolia (chain ${await client.getChainId()}) · block ${block}`);
console.log(`Token:   ${token.name} (${token.symbol}) at ${USDC_ADDRESS}\n`);

for (const r of WALLET_ROLES.filter((w) => w.kind === "wallet")) {
  const address = getAddressFor(r.id);
  const [usdc, eth] = await Promise.all([getUsdcBalance(address), getEthBalance(address)]);
  console.log(
    `  ${r.label.padEnd(32)} ${address}  ${usdc.usdc.padStart(10)} test USDC  ${Number(eth).toFixed(4)} ETH`,
  );
}

const treasury = getAddressFor("treasury");
const t = await getUsdcBalance(treasury);
console.log("");
if (t.raw === 0n) {
  console.log(`Treasury is empty. Fund it at https://faucet.circle.com (Base Sepolia, USDC) → ${treasury}`);
} else {
  console.log(`✓ Treasury holds ${t.usdc} test USDC. ${addressUrl(treasury)}`);
}
