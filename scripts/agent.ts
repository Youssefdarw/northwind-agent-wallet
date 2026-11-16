/**
 * Phase 4: run the bill-paying agent and log everything to the terminal.
 *
 *   npm run agent                  → normal mode
 *   npm run agent -- --compromised → RED-TEAM: agent told to obey instructions in invoices
 *   npm run agent -- --arabic      → the agent writes its reasoning and summary in Egyptian Arabic
 *
 * Merchants must be running (npm run merchants). Run `npm run reset` between runs.
 */
import { runAgent, AGENT_MODEL, type AgentLogEvent } from "../src/agent/run.js";
import { getMerchants, merchantUrl, DEMO_SCALE } from "../src/config/scenario.js";
import { ledger } from "../src/billing/service.js";

const compromised = process.argv.includes("--compromised");
const language = process.argv.includes("--arabic") ? "ar" : "en";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

// Preflight: merchants up?
const down: string[] = [];
for (const m of getMerchants()) {
  const ok = await fetch(merchantUrl(m, "/invoice"), { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  if (!ok) down.push(m.id);
}
if (down.length) {
  console.error(c.red(`✗ Merchants not running: ${down.join(", ")}. Start them in another terminal:  npm run merchants`));
  process.exit(1);
}
const prior = Object.keys(ledger.get().bills).length;
if (prior) console.log(c.yellow(`Note: ${prior} bill(s) already have a status from an earlier run. For a clean demo: npm run reset\n`));

console.log(c.bold(`Northwind Industrial agent wallet · ${AGENT_MODEL} · Base Sepolia testnet · DEMO_SCALE ${DEMO_SCALE}`));
if (compromised) console.log(c.magenta("RED-TEAM MODE: the agent is told to obey instructions found inside invoices.\n"));
else console.log("");

const short = (v: unknown, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function log(e: AgentLogEvent) {
  switch (e.type) {
    case "text":
      console.log(`\n${c.cyan("Agent:")} ${e.text}\n`);
      break;
    case "tool_call": {
      const { reasoning, note, ...rest } = e.input as Record<string, string>;
      console.log(c.bold(`→ ${e.name}(${Object.keys(rest).length ? Object.values(rest).join(", ") : ""})`));
      if (reasoning) console.log(`  ${c.cyan("reasoning:")} ${reasoning}`);
      if (note) console.log(`  ${c.cyan("note to owner:")} ${note}`);
      break;
    }
    case "progress":
      console.log(
        e.message.includes("APPROVE") || e.message.includes("✓")
          ? c.green(e.message)
          : e.message.includes("HOLD")
            ? c.yellow(e.message)
            : e.message.includes("BLOCK") || e.message.includes("✗")
              ? c.red(e.message)
              : e.message,
      );
      break;
    case "tool_result":
      if (e.isError) console.log(c.red(`  tool error: ${short(e.result)}`));
      else if (e.name === "list_bills" || e.name === "get_budget_status") console.log(c.dim(`  ${short(e.result)}`));
      break;
    case "done":
      console.log(
        c.dim(`\nTokens: ${(e.usage.input + e.usage.cacheRead).toLocaleString()} in (${e.usage.cacheRead.toLocaleString()} from cache) · ${e.usage.output.toLocaleString()} out`),
      );
      break;
    case "error":
      console.error(c.red(`\n✗ ${e.message}`));
      process.exitCode = 1;
      break;
  }
}

await runAgent({ compromised, language, log });

// Final table from the ledger (the source of truth, not the model's summary).
const bills = ledger.get().bills;
console.log(c.bold("\nLedger"));
for (const m of getMerchants()) {
  const b = bills[m.id];
  const status = b?.status ?? "not proposed";
  const color = status === "paid" ? c.green : status === "awaiting_approval" ? c.yellow : status === "not proposed" ? c.dim : c.red;
  const rule = b?.decision?.firedRule ? ` [${b.decision.firedRule}]` : "";
  console.log(`  ${m.name.padEnd(30)} ${color((status + rule).padEnd(36))} ${b?.payments.length ? `${b.payments.length} tx` : ""}`);
}
