/**
 * Owner approval from the terminal (the dashboard gets buttons in Phase 5).
 *   npm run approve -- parts_supplier            → approve: re-checks policy with human approval, then pays
 *   npm run approve -- parts_supplier --reject   → reject: nothing is signed
 */
import { approveHeld, rejectHeld, ledger } from "../src/billing/service.js";

const billId = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!billId) {
  const held = Object.values(ledger.get().bills).filter((b) => b?.status === "awaiting_approval");
  console.log(held.length ? "Awaiting approval:" : "Nothing is awaiting approval.");
  for (const b of held) console.log(`  ${b!.billId}  ${b!.merchantName}  $${b!.amountUsd}  note: ${b!.approvalNote ?? "-"}`);
  console.log("\nUsage: npm run approve -- <bill_id> [--reject]");
  process.exit(0);
}

if (process.argv.includes("--reject")) {
  console.log(rejectHeld(billId));
} else {
  const b = ledger.bill(billId as never);
  console.log(`Approving ${b?.merchantName ?? billId}. Agent's reasoning: ${b?.agentReasoning ?? "-"}`);
  console.log(`Agent's note: ${b?.approvalNote ?? "-"}\n`);
  const r = await approveHeld(billId, { onProgress: (m) => console.log(m) });
  console.log(`\n${JSON.stringify(r, null, 2)}`);
}
