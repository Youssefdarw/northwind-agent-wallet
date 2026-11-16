/**
 * npm run snapshot: a read-only copy of the dashboard to share.
 *
 * Writes share/ : the built dashboard (static, no server) + snapshot/state.json +
 * snapshot/mandates/<id>.json. Open share/index.html through any static host
 * (or publish it as a link). It contains public wallet addresses, the ledger and
 * the audit trail. It contains NO private keys and no API key: nothing in it can pay.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getPublicClient } from "../src/config/network.js";
import { getAddressFor } from "../src/config/wallets.js";
import { getUsdcBalance } from "../src/wallets/balance.js";
import { buildState, mandateView } from "../src/api/state.js";
import { mandates } from "../src/billing/service.js";
import { DATA_DIR, readJson, writeJson } from "../src/store/json.js";
import type { LiveLogLine } from "../src/api/types.js";

const OUT = resolve(process.cwd(), process.argv[2] ?? "share");
if (!OUT.startsWith(process.cwd())) throw new Error("Output folder must be inside the project");

await getPublicClient(); // testnet guard
console.log("Reading the treasury balance…");
const usdc = await getUsdcBalance(getAddressFor("treasury"))
  .then((b) => b.usdc)
  .catch(() => null);

console.log("Building the static dashboard…");
rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "web/vite.config.ts", "--base", "./", "--outDir", OUT, "--emptyOutDir", "--logLevel", "warn"],
  { stdio: "inherit", env: { ...process.env, VITE_STATIC: "1" } },
);

const state = buildState({
  treasuryUsdc: usdc,
  merchantsOnline: true,
  liveLog: readJson<LiveLogLine[]>(resolve(DATA_DIR, "live-log.json"), []),
  busy: null,
  readOnly: { mode: "snapshot", askEnabled: false, takenAt: new Date().toISOString() },
});
writeJson(resolve(OUT, "snapshot/state.json"), state);

mkdirSync(resolve(OUT, "snapshot/mandates"), { recursive: true });
const ids = mandates.all().map((r) => r.mandate.body.mandateId);
for (const id of ids) writeJson(resolve(OUT, `snapshot/mandates/${id}.json`), await mandateView(id));

// Belt and braces: nothing that looks like a private key may end up in the copy.
const blob = readFileSync(resolve(OUT, "snapshot/state.json"), "utf8") + ids.map((id) => readFileSync(resolve(OUT, `snapshot/mandates/${id}.json`), "utf8")).join("");
if (/PRIVATE_KEY|sk-ant-/i.test(blob)) {
  rmSync(OUT, { recursive: true, force: true });
  throw new Error("Snapshot looked like it contained a secret; deleted it.");
}

const paid = state.bills.filter((b) => b.entry?.status === "paid").length;
console.log(`\nRead-only snapshot written to ${OUT}`);
console.log(`  ${state.bills.length} bills (${paid} paid), ${ids.length} mandates, ${state.events.length} audit events.`);
console.log(`  Preview it:  npx vite preview --outDir ${existsSync(OUT) ? OUT.replace(process.cwd() + "/", "") : OUT} --config web/vite.config.ts`);
