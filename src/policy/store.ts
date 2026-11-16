/** Loads/saves the owner's policy (data/policy.json). Every save bumps the version. */
import { resolve } from "node:path";
import { getMerchants, merchantAddress } from "../config/scenario.js";
import { DATA_DIR, readJson, writeJson } from "../store/json.js";
import { TESTNET_NETWORK, validatePolicy } from "./engine.js";
import type { Policy } from "./types.js";

const POLICY_PATH = resolve(DATA_DIR, "policy.json");

/**
 * The starting policy from the brief: $6,000/month, $500 auto-approve, $0.05/call, merchants #1–#5,
 * plus any owner-added merchant that was marked "allowlist" when it was added.
 */
export function defaultPolicy(): Policy {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    monthlyBudgetUsd: 6000,
    autoApproveLimitUsd: 500,
    maxPricePerCallUsd: 0.05,
    network: TESTNET_NETWORK,
    allowlist: getMerchants()
      .filter((m) => (m.custom ? m.allowlistByDefault : m.id !== "cheap_parts_shop"))
      .map((m) => ({ merchantId: m.id, name: m.name, payTo: merchantAddress(m) })),
  };
}

export function loadPolicy(): Policy {
  const stored = readJson<Policy | null>(POLICY_PATH, null);
  if (stored) return stored;
  const p = defaultPolicy();
  writeJson(POLICY_PATH, p);
  return p;
}

/** Saves an edited policy. Throws with all validation errors if invalid. */
export function savePolicy(edit: Omit<Policy, "version" | "updatedAt">): Policy {
  const current = loadPolicy();
  const next: Policy = { ...edit, version: current.version + 1, updatedAt: new Date().toISOString() };
  const errors = validatePolicy(next);
  if (errors.length) throw new Error(errors.join("; "));
  writeJson(POLICY_PATH, next);
  return next;
}

export function resetPolicy(): Policy {
  const p = defaultPolicy();
  writeJson(POLICY_PATH, p);
  return p;
}
