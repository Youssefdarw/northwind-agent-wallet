/**
 * npm run demo: check the setup, then start everything with one command.
 *
 *   1. Preflight: Node version, .env (wallets, gitignored), Claude API key (never printed),
 *      testnet guard, treasury balance, free ports.
 *   2. Build the dashboard, start the merchant servers and the API, open the browser.
 *
 * Ctrl+C stops everything.
 */
import "dotenv/config";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const problems: string[] = [];
const fail = (m: string, fix: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}\n      → ${fix}`);
  problems.push(m);
};

console.log("\nNorthwind Industrial agent wallet · setup check\n");

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "Install Node 22 or newer from nodejs.org");

// 2. .env exists and is gitignored
const envPath = resolve(process.cwd(), ".env");
if (!existsSync(envPath)) {
  fail(".env not found", "Run: npm run wallets:generate");
} else {
  const ignored = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8").split("\n").some((l) => l.trim() === ".env");
  if (ignored) ok(".env exists and is in .gitignore");
  else fail(".env is not in .gitignore", "Add a line `.env` to .gitignore before going further");
}

// 3. Wallets (addresses only; keys are checked for shape, never printed)
const { WALLET_ROLES, getAddressFor } = await import("../src/config/wallets.js");
let walletsOk = true;
for (const r of WALLET_ROLES) {
  try {
    getAddressFor(r.id);
    // Shape check only, without loading the key (only the executor and the mandate signer do that).
    if ((r.id === "treasury" || r.id === "company_signer") && !/^0x[0-9a-fA-F]{64}$/.test(process.env[`${r.env}_PRIVATE_KEY`] ?? ""))
      throw new Error(`${r.env}_PRIVATE_KEY missing or malformed in .env.`);
  } catch (err) {
    walletsOk = false;
    fail(`${r.label}: ${(err as Error).message.split(".")[0]}`, "Run: npm run wallets:generate");
  }
}
if (walletsOk) ok(`${WALLET_ROLES.length} wallets found in .env`);

// 4. Claude API key: presence and shape only
const key = process.env.ANTHROPIC_API_KEY ?? "";
if (/^sk-ant-\S{20,}$/.test(key)) ok("ANTHROPIC_API_KEY is set");
else if (key) warn("ANTHROPIC_API_KEY is set but doesn't look like an Anthropic key (sk-ant-…)");
else fail("ANTHROPIC_API_KEY is missing", "Add ANTHROPIC_API_KEY=sk-ant-… to .env (console.anthropic.com → API keys)");

// 5. Testnet guard + treasury
if (walletsOk) {
  try {
    const { getPublicClient } = await import("../src/config/network.js");
    await getPublicClient();
    ok("Connected to Base Sepolia (testnet guard passed)");
    const { getUsdcBalance } = await import("../src/wallets/balance.js");
    const { cashflowStatus } = await import("../src/billing/service.js");
    const bal = Number((await getUsdcBalance(getAddressFor("treasury"))).usdc);
    const need = cashflowStatus(bal).open.onChainUsdc;
    if (bal >= need) ok(`Treasury holds ${bal} test USDC (open bills need ${need})`);
    else warn(`Treasury holds ${bal} test USDC but open bills need ${need}. Top up at https://faucet.circle.com (Base Sepolia) to ${getAddressFor("treasury")}`);
  } catch (err) {
    fail(`Chain check failed: ${(err as Error).message}`, "Check your internet connection or BASE_SEPOLIA_RPC_URL in .env");
  }
}

// 6. Ports
const API_PORT = Number(process.env.API_PORT || 4000);
const portInUse = (port: number) =>
  new Promise<boolean>((res) => {
    const s = connect({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
    s.setTimeout(800, () => (s.destroy(), res(false)));
  });
let ports: number[] = [API_PORT];
if (walletsOk) {
  const { getMerchants } = await import("../src/config/scenario.js");
  ports = [API_PORT, ...getMerchants().map((m) => m.port)];
}
const busyPorts = (await Promise.all(ports.map(async (p) => ((await portInUse(p)) ? p : null)))).filter((p): p is number => p !== null);
if (busyPorts.length === 0) ok(`Ports free (${ports[0]}, ${ports.slice(1).join(", ")})`);
else fail(`Ports already in use: ${busyPorts.join(", ")}`, "Stop the other dashboard (Ctrl+C in its terminal), then try again");

if (problems.length) {
  console.log(`\n${problems.length} thing${problems.length === 1 ? "" : "s"} to fix first.\n`);
  process.exit(1);
}

// ── Start ───────────────────────────────────────────────────────────────
console.log("\nBuilding the dashboard…");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["vite", "build", "--config", "web/vite.config.ts", "--logLevel", "warn"], { stdio: "inherit" });

const children: ChildProcess[] = [];
const start = (name: string, color: number, args: string[]) => {
  const c = spawn(npx, ["tsx", ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `\x1b[${color}m${name.padEnd(9)}\x1b[0m│ `;
  const out = (d: Buffer) => process.stdout.write(d.toString().replace(/^(?=.)/gm, tag));
  c.stdout!.on("data", out);
  c.stderr!.on("data", out);
  c.on("exit", (code) => {
    if (!stopping) {
      console.log(`${tag}stopped (code ${code}). Shutting down.`);
      stop(1);
    }
  });
  children.push(c);
};
let stopping = false;
const stop = (code = 0) => {
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

start("merchants", 90, ["scripts/merchants.ts"]);
start("api", 34, ["src/api/server.ts"]);

const url = `http://127.0.0.1:${API_PORT}`;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const up = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (up) {
    console.log(`\n  Dashboard ready: \x1b[1m${url}\x1b[0m   (Ctrl+C to stop)\n`);
    if (!process.env.NO_OPEN) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
    }
    break;
  }
  if (i === 59) console.log("  The API didn't come up in 30 seconds; see the log above.");
}
