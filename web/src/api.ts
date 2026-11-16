import type { DashboardState, MandateView, BillView, InvoiceDraft } from "../../src/api/types";
import type { BillStatus } from "../../src/billing/ledger";
import type { RuleId, Policy } from "../../src/policy/types";

export type { DashboardState, MandateView, BillView, BillStatus, RuleId, Policy, InvoiceDraft };

/** Static build (npm run snapshot): reads JSON files next to the page; nothing can change. */
export const STATIC = import.meta.env.VITE_STATIC === "1";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (STATIC) return staticCall<T>(method, path);
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

async function staticCall<T>(method: string, path: string): Promise<T> {
  const file = method === "GET" && path === "/api/state" ? "snapshot/state.json" : method === "GET" && path.startsWith("/api/mandates/") ? `snapshot/mandates/${encodeURIComponent(path.slice(14))}.json` : null;
  if (!file) throw new Error("This is a read-only copy");
  const res = await fetch(`./${file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load ${file}`);
  return (await res.json()) as T;
}

export const api = {
  ask: (question: string, history: { role: "user" | "assistant"; text: string }[]) =>
    call<{ answer: string }>("POST", "/api/ask", { question, history }),
  state: () => call<DashboardState>("GET", "/api/state"),
  run: (compromised: boolean, language: "en" | "ar") => call("POST", "/api/run", { compromised, language }),
  readInvoice: (f: { fileName: string; mediaType: string; dataBase64: string }) => call<InvoiceDraft>("POST", "/api/invoices/read", f),
  addInvoice: (draftId: string, body: { vendorId?: string; newVendor?: { name: string; domain: string; allowlist: boolean } }) =>
    call("POST", `/api/invoices/${draftId}/add`, body),
  approve: (id: string) => call("POST", `/api/bills/${id}/approve`),
  reject: (id: string) => call("POST", `/api/bills/${id}/reject`),
  reset: () => call("POST", "/api/reset"),
  savePolicy: (p: { monthlyBudgetUsd: number; autoApproveLimitUsd: number; maxPricePerCallUsd: number; allowlistIds: string[] }) =>
    call<Policy>("PUT", "/api/policy", p),
  mandate: (id: string) => call<MandateView>("GET", `/api/mandates/${id}`),
  addMerchant: (m: { name: string; domain: string; billType: string; amountUsd: number; invoiceNumber?: string; description?: string; allowlist: boolean }) =>
    call("POST", "/api/merchants", m),
  removeMerchant: (id: string) => call("DELETE", `/api/merchants/${id}`),
};

// ── Formatting ───────────────────────────────────────────────────────────
/** Wrapped in invisible left-to-right isolates so "$6,000" doesn't flip to "6,000$" inside Arabic text. */
export const usd = (n: number, digits = 2) =>
  `\u2066${n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits })}\u2069`;

export const usdShort = (n: number) => (Number.isInteger(n) ? usd(n, 0) : usd(n));

export const short = (addr: string, n = 4) => (addr.length > 2 * n + 2 ? `${addr.slice(0, n + 2)}…${addr.slice(-n)}` : addr);

export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "17 Nov" / "17 نوفمبر" from YYYY-MM-DD. */
export const dayMonth = (ymd: string, locale = "en-GB") =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

export const dateTime = (isoOrSec: string | number, locale = "en-GB") =>
  new Date(typeof isoOrSec === "number" ? isoOrSec * 1000 : isoOrSec).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Plain-words names for the policy rules (the engine's rule ids stay visible as code). */
export const RULE_LABEL: Record<RuleId, string> = {
  network: "Wrong network (testnet only)",
  allowlist: "Merchant is not on the allowlist",
  payee_mismatch: "Pay-to wallet isn't the supplier's known wallet",
  invalid_amount: "Invalid amount",
  max_price_per_call: "Price per API call is above the limit",
  duplicate_invoice: "This invoice was already paid",
  monthly_budget: "Would exceed the monthly budget",
  possible_duplicate: "Looks like a duplicate of a bill already paid",
  po_mismatch: "Doesn't match the purchase order",
  price_jump: "Price jumped since last time",
  auto_approve_limit: "Above the auto-approve limit: needs the owner",
};

/** Neutral names for listing checks that passed or failed. */
export const RULE_NAME: Record<RuleId, string> = {
  network: "Testnet network",
  allowlist: "Merchant allowlisted",
  payee_mismatch: "Pays the supplier's known wallet",
  invalid_amount: "Valid amount",
  max_price_per_call: "Price per call within limit",
  duplicate_invoice: "Not already paid",
  monthly_budget: "Within monthly budget",
  possible_duplicate: "Not a disguised duplicate",
  po_mismatch: "Matches purchase order",
  price_jump: "No price jump",
  auto_approve_limit: "Within auto-approve limit",
};

export const RULE_LABEL_AR: Record<RuleId, string> = {
  network: "شبكة غلط (شبكة الاختبار بس)",
  allowlist: "المورد مش في قائمة الموردين المعتمدين",
  payee_mismatch: "المحفظة المطلوب الدفع ليها مش محفظة المورد المسجلة",
  invalid_amount: "مبلغ غير صحيح",
  max_price_per_call: "سعر الطلب الواحد أعلى من الحد",
  duplicate_invoice: "الفاتورة دي اتدفعت قبل كده",
  monthly_budget: "هتعدّي ميزانية الشهر",
  possible_duplicate: "شكلها مكررة من فاتورة اتدفعت",
  po_mismatch: "مش مطابقة لأمر الشراء",
  price_jump: "السعر زاد عن المرة اللي فاتت",
  auto_approve_limit: "أعلى من حد الموافقة التلقائية: محتاجة موافقتك",
};

export const RULE_NAME_AR: Record<RuleId, string> = {
  network: "شبكة الاختبار",
  allowlist: "المورد معتمد",
  payee_mismatch: "بيدفع لمحفظة المورد المسجلة",
  invalid_amount: "المبلغ صحيح",
  max_price_per_call: "سعر الطلب في الحد",
  duplicate_invoice: "متدفعتش قبل كده",
  monthly_budget: "جوه ميزانية الشهر",
  possible_duplicate: "مش مكررة متخفية",
  po_mismatch: "مطابقة لأمر الشراء",
  price_jump: "مفيش زيادة في السعر",
  auto_approve_limit: "في حد الموافقة التلقائية",
};

export const ruleLabel = (r: RuleId, ar: boolean) => (ar ? RULE_LABEL_AR : RULE_LABEL)[r];
export const ruleName = (r: RuleId, ar: boolean) => (ar ? RULE_NAME_AR : RULE_NAME)[r];
