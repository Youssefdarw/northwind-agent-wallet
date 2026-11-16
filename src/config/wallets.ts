/**
 * Wallet roles and .env variable names.
 *
 * Only ADDRESSES are exported from here. Private keys are read exclusively by
 * `loadPrivateKey()`, and only the payment executor (Phase 2+) and the wallet
 * scripts call it. The agent never imports this function.
 */
import "dotenv/config";
import { getAddress, isAddress, type Address, type Hex } from "viem";

/**
 * kind "wallet" holds funds. kind "signer" never holds funds: the company signer
 * key only signs payment mandates (separation of duties: the key that AUTHORIZES
 * payments is not the key that MOVES money).
 */
export const WALLET_ROLES = [
  { id: "treasury", label: "Northwind Industrial treasury", env: "TREASURY", kind: "wallet" },
  { id: "company_signer", label: "Northwind Industrial mandate signer", env: "COMPANY_SIGNER", kind: "signer" },
  { id: "office_suite", label: "Contoso Office (SaaS)", env: "MERCHANT_OFFICE_SUITE", kind: "wallet" },
  { id: "hosting", label: "northwind.example.com hosting", env: "MERCHANT_HOSTING", kind: "wallet" },
  { id: "ai_quoting_api", label: "AI quoting API", env: "MERCHANT_AI_QUOTING_API", kind: "wallet" },
  { id: "freight_forwarder", label: "Freight forwarder (Alexandria)", env: "MERCHANT_FREIGHT_FORWARDER", kind: "wallet" },
  { id: "parts_supplier", label: "Fabrikam parts supplier", env: "MERCHANT_PARTS_SUPPLIER", kind: "wallet" },
  { id: "cheap_parts_shop", label: "cheap-machine-parts.example", env: "MERCHANT_CHEAP_PARTS_SHOP", kind: "wallet" },
] as const;

export type WalletRoleId = (typeof WALLET_ROLES)[number]["id"];
export type MerchantId = Exclude<WalletRoleId, "treasury" | "company_signer">;

const role = (id: WalletRoleId) => {
  const r = WALLET_ROLES.find((w) => w.id === id);
  if (!r) throw new Error(`Unknown wallet role ${id}`);
  return r;
};

export function getAddressFor(id: WalletRoleId): Address {
  const r = role(id);
  const value = process.env[`${r.env}_ADDRESS`];
  if (!value || !isAddress(value)) {
    throw new Error(`${r.env}_ADDRESS missing or invalid in .env. Run: npm run wallets:generate`);
  }
  return getAddress(value);
}

/** Restricted: returns a private key. Never log the return value. */
export function loadPrivateKey(id: WalletRoleId): Hex {
  const r = role(id);
  const value = process.env[`${r.env}_PRIVATE_KEY`];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${r.env}_PRIVATE_KEY missing or malformed in .env. Run: npm run wallets:generate`);
  }
  return value as Hex;
}
