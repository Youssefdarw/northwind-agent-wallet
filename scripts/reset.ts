/**
 * Reset the demo: clear the bill ledger, mandates and payment records; restore the default policy.
 * Wallets untouched. Saved sample runs in docs/sample-run are never touched: the check below stops
 * before any write if DATA_DIR points there, and writeJson() refuses protected paths as well.
 */
import { DATA_DIR, assertWritable } from "../src/store/json.js";
import { MandateStore } from "../src/mandates/store.js";
import { Ledger } from "../src/billing/ledger.js";
import { resetPolicy } from "../src/policy/store.js";

try {
  assertWritable(DATA_DIR);
} catch (err) {
  console.error(`✗ ${(err as Error).message}\n  Nothing was reset. Point DATA_DIR at a scratch folder (default: data/).`);
  process.exit(1);
}

new MandateStore().clear();
new Ledger().clear();
const p = resetPolicy();
console.log(`Ledger and mandates cleared. Policy reset to defaults (v${p.version}). Wallets and on-chain funds untouched. Saved sample runs in docs/sample-run kept.`);
