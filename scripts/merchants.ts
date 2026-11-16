/**
 * Start mock merchants.
 *   npm run merchants              → the six built-in merchants + any the owner added
 *   npm run merchants -- hosting   → just the listed ids
 *
 * With no ids, it also watches for merchants added/removed from the dashboard
 * and starts/stops their servers within ~2 seconds.
 */
import type { Server } from "node:http";
import { getMerchants, getMerchant, FACILITATOR_URL, DEMO_SCALE, type Merchant } from "../src/config/scenario.js";
import { startMerchant } from "../src/merchants/server.js";

const ids = process.argv.slice(2);
const running = new Map<string, Server>();

async function start(m: Merchant) {
  try {
    running.set(m.id, await startMerchant(m));
  } catch (err) {
    console.error(`✗ could not start ${m.id} on port ${m.port}: ${(err as Error).message}`);
  }
}

console.log(`Facilitator: ${FACILITATOR_URL} · DEMO_SCALE ${DEMO_SCALE} · Base Sepolia testnet\n`);
for (const m of ids.length ? ids.map(getMerchant) : getMerchants()) await start(m);
console.log("\nMerchants running. Ctrl+C to stop.");

if (!ids.length) {
  setInterval(async () => {
    let current: Merchant[];
    try {
      current = getMerchants();
    } catch {
      return; // file mid-write; try again next tick
    }
    for (const m of current) if (!running.has(m.id)) {
      console.log(`+ owner added merchant ${m.name}`);
      await start(m);
    }
    for (const [id, server] of running) if (!current.some((m) => m.id === id)) {
      server.close();
      running.delete(id);
      console.log(`− removed merchant ${id} (server stopped)`);
    }
  }, 2000);
}
