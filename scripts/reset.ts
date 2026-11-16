/** Reset the demo: clear the bill ledger, mandates and payment records; restore the default policy. Wallets untouched. */
import { MandateStore } from "../src/mandates/store.js";
import { Ledger } from "../src/billing/ledger.js";
import { resetPolicy } from "../src/policy/store.js";

new MandateStore().clear();
new Ledger().clear();
const p = resetPolicy();
console.log(`Ledger and mandates cleared. Policy reset to defaults (v${p.version}). Wallets and on-chain funds untouched.`);
