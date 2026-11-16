/**
 * Pay ONE bill through the full pipeline (no LLM yet):
 *   merchant invoice → policy engine → signed mandate → executor (x402) → BaseScan
 *
 *   npm run pay:one                               → hosting ($12)
 *   npm run pay:one -- <merchantId>               → another merchant (must be running)
 *   npm run pay:one -- parts_supplier --approve      → simulate the owner clicking "Approve"
 *   npm run pay:one -- ai_quoting_api --calls 3   → pay-per-use: 3 paid API calls
 */
import { getAddressFor } from "../src/config/wallets.js";
import { amountLabel, atomicToUsdc, getMerchant, merchantUrl, requestFromInvoice } from "../src/config/scenario.js";
import { getUsdcBalance } from "../src/wallets/balance.js";
import { evaluate } from "../src/policy/engine.js";
import { loadPolicy } from "../src/policy/store.js";
import { issueMandate } from "../src/mandates/issue.js";
import { MandateStore } from "../src/mandates/store.js";
import { payMandate } from "../src/executor/pay.js";

const args = process.argv.slice(2);
const merchant = getMerchant(args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "hosting");
const humanApproved = args.includes("--approve");
const callsIdx = args.indexOf("--calls");
const calls = callsIdx >= 0 ? Number(args[callsIdx + 1]) : undefined;

const invoice = await fetch(merchantUrl(merchant, "/invoice"))
  .then((r) => r.json())
  .catch(() => {
    console.error(`✗ Can't reach ${merchant.name}. Start it first:  npm run merchants -- ${merchant.id}`);
    process.exit(1);
  });

console.log(`Invoice ${invoice.invoiceNumber} from ${invoice.merchant}`);
console.log(`  "${invoice.description}"`);
console.log(`  ${amountLabel(merchant)}\n`);

// 1. Policy check: deterministic code, not the LLM.
const request = requestFromInvoice(invoice, `Pay ${invoice.merchant} ${invoice.invoiceNumber} (manual test)`, calls);
const policy = loadPolicy();
const store = new MandateStore();
const decision = evaluate(request, policy, store.spendState(), { humanApproved });

console.log(`Policy v${policy.version} → ${decision.outcome.toUpperCase()}${decision.firedRule ? `  (rule: ${decision.firedRule})` : ""}`);
for (const c of decision.checks) console.log(`  ${c.passed ? "✓" : "✗"} ${c.rule.padEnd(20)} ${c.detail}`);
console.log(`  → ${decision.reason}\n`);

if (decision.outcome === "hold") {
  console.log("Held for the owner's approval. To simulate clicking Approve:");
  console.log(`  npm run pay:one -- ${merchant.id} --approve`);
  process.exit(0);
}
if (decision.outcome === "block") {
  console.log("Blocked. No mandate issued, nothing signed, no funds moved.");
  process.exit(0);
}

// 2. Signed mandate (company signer key).
const mandate = await issueMandate(request, decision, merchantUrl(merchant));
store.add(mandate, decision);
const b = mandate.body;
console.log(`Mandate ${b.mandateId}`);
console.log(`  ${b.merchantName} · ${b.invoiceNumber} · $${b.invoiceAmountUsd} → ${atomicToUsdc(BigInt(b.amountAtomic))} USDC × ${b.maxUses}`);
console.log(`  approval: ${b.approval} · policy v${b.policyVersion} · expires ${new Date(b.expiresAt * 1000).toISOString()}`);
console.log(`  signed by company key ${b.issuer}\n`);

// 3. Execute (treasury key, x402).
const treasury = getAddressFor("treasury");
const before = await getUsdcBalance(treasury);
// A failed call keeps its slot (its signed authorization could still settle), so this
// loop can never pay more than maxUses in total, even if a failure later goes through.
for (let i = 0; i < b.maxUses; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 250)); // be gentle with the shared testnet facilitator
  const r = await payMandate(mandate, store);
  if (r.status === "paid") console.log(`  ✓ payment ${i + 1}/${b.maxUses}: ${r.explorerUrl}`);
  else {
    console.log(`  ✗ payment ${i + 1}/${b.maxUses} ${r.status}: ${r.reason}`);
    if (r.status === "refused") break;
  }
}
await new Promise((r) => setTimeout(r, 3000));
console.log(`\nTreasury: ${before.usdc} → ${(await getUsdcBalance(treasury)).usdc} test USDC`);
