/**
 * Owner-added merchants ("Add merchant" on the dashboard).
 *
 * The owner never types a wallet address. In this demo each new merchant is a
 * simulated business, so the system generates its wallet: the private key goes
 * to .env (gitignored, never printed), the address to data/custom-merchants.json.
 * In a real product this step would be a verified supplier onboarding, which is
 * exactly why a hand-typed "pay to" field is left out: it's the #1 invoice-fraud trick.
 *
 * The merchants process (npm run merchants) picks up additions/removals within ~2s.
 */
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import {
  BUILTIN_MERCHANTS,
  CUSTOM_MERCHANTS_PATH,
  getMerchant,
  getMerchants,
  getVendors,
  knownVendorAddress,
  loadCustomMerchants,
  usdToOnChainAtomic,
  type Merchant,
  type UploadInfo,
} from "../config/scenario.js";
import { writeJson } from "../store/json.js";

export const MAX_CUSTOM_MERCHANTS = 12;
const FIRST_CUSTOM_PORT = 4111;

export interface NewMerchantInput {
  name: string;
  domain: string;
  billType: "invoice" | "subscription";
  amountUsd: number;
  description?: string;
  invoiceNumber?: string;
  /** Also put it on the allowlist (and keep it there when the demo is reset). */
  allowlist: boolean;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);

export function validateNewMerchant(input: Partial<NewMerchantInput>, { skipAmount = false } = {}): string[] {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  const domain = (input.domain ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 60) errors.push("Name must be 2–60 characters");
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) errors.push("Domain must look like supplier.com");
  if (input.billType !== "invoice" && input.billType !== "subscription") errors.push("Bill type must be invoice or subscription");
  const amt = Number(input.amountUsd);
  if (skipAmount) {
    /* amount comes from an uploaded invoice, checked separately */
  } else if (!Number.isFinite(amt) || amt <= 0 || amt > 100_000) errors.push("Amount must be between $0.01 and $100,000");
  else if (Math.round(amt * 100) !== amt * 100) errors.push("Amount can have at most 2 decimals");
  else {
    try {
      usdToOnChainAtomic(amt, "invoice");
    } catch {
      errors.push("Amount is too small to settle on-chain at the current demo scale");
    }
  }
  if ((input.description ?? "").length > 300) errors.push("Invoice text must be 300 characters or fewer");
  if ((input.invoiceNumber ?? "").length > 40) errors.push("Invoice number must be 40 characters or fewer");
  const all = getMerchants();
  if (all.some((m) => m.name.toLowerCase() === name.toLowerCase())) errors.push(`A merchant named "${name}" already exists`);
  if (all.some((m) => m.domain.toLowerCase() === domain)) errors.push(`A merchant with domain ${domain} already exists`);
  if (loadCustomMerchants().length >= MAX_CUSTOM_MERCHANTS) errors.push(`At most ${MAX_CUSTOM_MERCHANTS} added merchants and uploaded invoices in this demo`);
  return errors;
}

const ENV_PATH = resolve(process.cwd(), ".env");
const envVar = (id: string) => `MERCHANT_${id.toUpperCase()}`;

/** Store the generated key in .env only. Refuses unless .env is gitignored. */
function storeKey(id: string, key: `0x${string}`, address: string) {
  const gi = resolve(process.cwd(), ".gitignore");
  if (!existsSync(gi) || !readFileSync(gi, "utf8").split("\n").some((l) => l.trim() === ".env")) {
    throw new Error("Refusing to write a private key: .env is not listed in .gitignore");
  }
  appendFileSync(ENV_PATH, `\n# Owner-added merchant (${id}), added ${new Date().toISOString()}\n${envVar(id)}_PRIVATE_KEY=${key}\n${envVar(id)}_ADDRESS=${address}\n`);
  chmodSync(ENV_PATH, 0o600);
}

/** A fresh id and a free port for a new record. */
function allocate(prefix: string, name: string) {
  const existing = getMerchants();
  const base = `${prefix}_${slug(name) || "merchant"}`;
  let id = base;
  for (let i = 2; existing.some((m) => m.id === id); i++) id = `${base}_${i}`;
  const usedPorts = new Set(existing.map((m) => m.port));
  let port = FIRST_CUSTOM_PORT;
  while (usedPorts.has(port)) port++;
  return { id, port };
}

/** Simulated supplier wallet: key → .env only, address returned. */
function generateWallet(id: string): Address {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  storeKey(id, key, address);
  return address;
}

export function addCustomMerchant(input: NewMerchantInput): Merchant {
  const errors = validateNewMerchant(input);
  if (errors.length) throw new Error(errors.join("; "));

  const { id, port } = allocate("custom", input.name);
  const address = generateWallet(id);

  const m: Merchant = {
    id,
    name: input.name.trim(),
    domain: input.domain.trim().toLowerCase(),
    port,
    billType: input.billType,
    amountUsd: Number(input.amountUsd),
    invoiceNumber: input.invoiceNumber?.trim() || `INV-${Date.now().toString(36).toUpperCase()}`,
    description: input.description?.trim() || "(no description)",
    paidPath: "/invoice/pay",
    payTo: address,
    custom: true,
    source: "added",
    allowlistByDefault: input.allowlist,
    addedAt: new Date().toISOString(),
  };
  writeJson(CUSTOM_MERCHANTS_PATH, [...loadCustomMerchants(), m]);
  return m;
}

/** What the owner decided on the review screen. */
export type UploadChoice =
  | { kind: "existing"; vendorId: string }
  | { kind: "new"; name: string; domain: string; allowlist: boolean };

export interface UploadedInvoice {
  invoiceNumber: string | null;
  amountUsd: number;
  recurring: boolean;
  poNumber: string | null;
  /** What the agent will read as the invoice text (untrusted). */
  description: string;
  statedWallet: string | null;
  info: UploadInfo;
}

/**
 * Turns a reviewed upload into a bill.
 *  - From a supplier on file: evaluated AS that supplier. It pays the supplier's known wallet,
 *    unless the invoice itself asks for a different wallet; then it pays exactly what the
 *    invoice asks, and the policy's payee check blocks it (wallet-change fraud).
 *  - From a new supplier: a new supplier record with a generated test wallet.
 */
export function addUploadedBill(inv: UploadedInvoice, choice: UploadChoice): Merchant {
  if (!(inv.amountUsd > 0) || inv.amountUsd > 100_000) throw new Error("Invoice total must be between $0.01 and $100,000");
  try {
    usdToOnChainAtomic(inv.amountUsd, "invoice");
  } catch {
    throw new Error("Invoice total is too small to settle on-chain at the current demo scale");
  }
  if (loadCustomMerchants().length >= MAX_CUSTOM_MERCHANTS) throw new Error(`At most ${MAX_CUSTOM_MERCHANTS} added merchants and uploaded invoices in this demo`);
  const stated = inv.statedWallet && isAddress(inv.statedWallet) ? getAddress(inv.statedWallet) : null;
  const common = {
    billType: inv.recurring ? ("subscription" as const) : ("invoice" as const),
    amountUsd: Math.round(inv.amountUsd * 100) / 100,
    invoiceNumber: inv.invoiceNumber?.trim().slice(0, 40) || `UPL-${Date.now().toString(36).toUpperCase()}`,
    poNumber: inv.poNumber?.replace(/^PO[\s#:-]*/i, "").trim() || undefined,
    description: inv.description.slice(0, 300) || "(no description)",
    paidPath: "/invoice/pay",
    custom: true as const,
    source: "upload" as const,
    upload: inv.info,
    addedAt: new Date().toISOString(),
  };

  let m: Merchant;
  if (choice.kind === "existing") {
    const vendor = getMerchant(choice.vendorId);
    if (vendor.vendorId) throw new Error("Pick a supplier, not another uploaded bill");
    const known = knownVendorAddress(vendor.id);
    const { id, port } = allocate("upload", `${vendor.id}_${common.invoiceNumber}`);
    m = {
      ...common,
      id,
      port,
      name: vendor.name,
      domain: vendor.domain,
      vendorId: vendor.id,
      payTo: stated && !isAddressEqual(stated, known) ? stated : known,
    };
  } else {
    const errors = validateNewMerchant({ name: choice.name, domain: choice.domain, billType: "invoice" }, { skipAmount: true });
    if (errors.length) throw new Error(errors.join("; "));
    const { id, port } = allocate("custom", choice.name);
    m = {
      ...common,
      id,
      port,
      name: choice.name.trim(),
      domain: choice.domain.trim().toLowerCase(),
      payTo: generateWallet(id),
      allowlistByDefault: choice.allowlist,
    };
  }
  writeJson(CUSTOM_MERCHANTS_PATH, [...loadCustomMerchants(), m]);
  return m;
}

/** Suggest which supplier on file an uploaded invoice is from (deterministic; the owner confirms). */
export function suggestVendor(vendorName: string, vendorDomain: string | null): { vendorId: string | null; why: string } {
  const vendors = getVendors();
  const domain = vendorDomain?.toLowerCase().replace(/^www\./, "");
  if (domain) {
    const byDomain = vendors.find((v) => v.domain.toLowerCase() === domain);
    if (byDomain) return { vendorId: byDomain.id, why: `domain ${domain} matches ${byDomain.name}` };
  }
  const STOP = new Set(["ltd", "llc", "inc", "co", "company", "the", "group", "supplier", "parts", "services", "service", "شركة", "مؤسسة"]);
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
  const target = new Set(words(vendorName));
  const byName = vendors.find((v) => words(v.name).some((w) => target.has(w)));
  if (byName) return { vendorId: byName.id, why: `name "${vendorName}" resembles ${byName.name}` };
  return { vendorId: null, why: "no supplier on file matches this name or domain" };
}

/** Removes an owner-added merchant from the bill list. Its key stays in .env (funds it received remain recoverable). */
export function removeCustomMerchant(id: string): { removed: Merchant; alsoRemoved: Merchant[] } {
  if (BUILTIN_MERCHANTS.some((m) => m.id === id)) throw new Error("Built-in demo merchants can't be removed");
  const list = loadCustomMerchants();
  const m = list.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown merchant ${id}`);
  const linked = list.filter((x) => x.vendorId === id); // uploaded invoices from this supplier go too
  writeJson(CUSTOM_MERCHANTS_PATH, list.filter((x) => x.id !== id && x.vendorId !== id));
  return { removed: m, alsoRemoved: linked };
}
