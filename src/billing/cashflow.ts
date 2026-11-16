/**
 * Cash-flow forecast: deterministic code, no AI, no I/O.
 *
 * Looks at the bills still open this month and answers three questions:
 *   1. Will paying them all fit the monthly budget? If not, which bill tips it over?
 *   2. Does the treasury hold enough (on-chain test USDC) to pay them?
 *   3. What's due soon, or overdue, and still waiting on someone?
 *
 * It only warns. Payments are still decided by the policy engine.
 */
import type { BillStatus } from "./ledger.js";

export interface CashflowBill {
  billId: string;
  name: string;
  status: BillStatus;
  /** Real-world USD still to pay on this bill. */
  amountUsd: number;
  /** On-chain test USDC still to pay on this bill. */
  onChainUsdc: number;
  /** YYYY-MM-DD, or null (e.g. pay-as-you-go). */
  dueDate: string | null;
}

export interface CashflowWarning {
  level: "warn" | "info" | "ok";
  code: "over_budget" | "treasury_short" | "due_soon" | "overdue" | "not_counted" | "all_clear";
  message: string;
  /** The same warning in Egyptian Arabic, for the dashboard's Arabic mode. */
  messageAr: string;
  billId?: string;
}

export interface Cashflow {
  open: { count: number; usd: number; onChainUsdc: number };
  budgetLeftAfterUsd: number;
  treasuryLeftAfterUsdc: number | null;
  warnings: CashflowWarning[];
}

/** Bills that still need money (paid / paying are already committed; blocked / rejected won't be paid). */
export const OPEN_STATUSES: readonly BillStatus[] = ["not_started", "awaiting_approval", "failed", "partially_paid"];
export const DUE_SOON_DAYS = 5;

const fmt = (usd: number) => {
  const round = Math.round(usd * 100) / 100;
  return round.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(round) ? 0 : 2, maximumFractionDigits: 2 });
};
const usdc = (n: number) => `${+n.toFixed(6)} test USDC`;
/** Arabic messages: keep "$4,850" and "0.4 test USDC" reading left-to-right inside right-to-left text. */
const ltr = (s: string) => `\u2066${s}\u2069`;
const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const shortDate = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
const shortDateAr = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS_AR[Number(ymd.slice(5, 7)) - 1]}`;
const daysAr = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوم`);

export function forecast(input: {
  bills: CashflowBill[];
  committedUsd: number;
  budgetUsd: number;
  /** null when the chain couldn't be read. */
  treasuryUsdc: number | null;
  /** YYYY-MM-DD (passed in so this stays deterministic). */
  today: string;
  /** Names of open bills left out because the policy can't pay them (supplier not allowlisted). */
  notCounted?: string[];
}): Cashflow {
  const open = input.bills
    .filter((b) => OPEN_STATUSES.includes(b.status) && b.amountUsd > 0)
    // Pay order: earliest due first; undated bills last.
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const usd = open.reduce((s, b) => s + b.amountUsd, 0);
  const chain = open.reduce((s, b) => s + b.onChainUsdc, 0);
  const warnings: CashflowWarning[] = [];

  // 1. Budget: walk the open bills in due-date order and find the first one that no longer fits.
  let running = input.committedUsd;
  const tipping = open.find((b) => (running += b.amountUsd) > input.budgetUsd + 1e-9);
  if (tipping) {
    warnings.push({
      level: "warn",
      code: "over_budget",
      billId: tipping.billId,
      message:
        `Paying every open bill (${fmt(usd)}) would go ${fmt(input.committedUsd + usd - input.budgetUsd)} over the ${fmt(input.budgetUsd)} monthly budget. ` +
        `From ${tipping.name} on, the policy will block payments unless you raise the budget or reject something.`,
      messageAr:
        `لو اتدفعت كل الفواتير المفتوحة (${ltr(fmt(usd))}) هنعدّي ميزانية الشهر (${ltr(fmt(input.budgetUsd))}) بـ ${ltr(fmt(input.committedUsd + usd - input.budgetUsd))}. ` +
        `من أول ${tipping.name} السياسة هتوقف الدفع، إلا لو زودت الميزانية أو رفضت حاجة.`,
    });
  }

  // 2. Treasury: can the wallet actually cover what's open?
  if (input.treasuryUsdc !== null && chain > input.treasuryUsdc + 1e-9) {
    let left = input.treasuryUsdc;
    const first = open.find((b) => (left -= b.onChainUsdc) < -1e-9);
    warnings.push({
      level: "warn",
      code: "treasury_short",
      billId: first?.billId,
      message: `The treasury holds ${usdc(input.treasuryUsdc)} but the open bills need ${usdc(chain)}: short by ${usdc(chain - input.treasuryUsdc)}. Top up before ${first?.name ?? "the next payment"}${first?.dueDate ? ` (due ${first.dueDate})` : ""}.`,
      messageAr: `الخزنة فيها ${ltr(usdc(input.treasuryUsdc))} والفواتير المفتوحة محتاجة ${ltr(usdc(chain))}: ناقص ${ltr(usdc(chain - input.treasuryUsdc))}. اشحن الخزنة قبل ${first?.name ?? "الدفعة الجاية"}${first?.dueDate ? ` (مستحقة ${shortDateAr(first.dueDate)})` : ""}.`,
    });
  }

  // 3. Due dates. Anything waiting on someone gets its own line; routine unpaid bills share one.
  const today = dayNumber(input.today);
  const routine: string[] = [];
  const routineAr: string[] = [];
  for (const b of open) {
    if (!b.dueDate) continue;
    const days = dayNumber(b.dueDate) - today;
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days (${b.dueDate})`;
    const whenAr = days === 0 ? "النهارده" : days === 1 ? "بكرة" : `بعد ${daysAr(days)} (${shortDateAr(b.dueDate)})`;
    const waiting = b.status === "awaiting_approval" ? "waiting for your approval" : b.status === "partially_paid" ? "only partly paid" : b.status === "failed" ? "its payment failed" : "not paid yet";
    const waitingAr = b.status === "awaiting_approval" ? "مستنية موافقتك" : b.status === "partially_paid" ? "اتدفع جزء منها بس" : b.status === "failed" ? "الدفع فشل" : "لسه متدفعتش";
    if (days < 0) {
      warnings.push({ level: "warn", code: "overdue", billId: b.billId, message: `${b.name} (${fmt(b.amountUsd)}) was due ${-days} day${days === -1 ? "" : "s"} ago and is ${waiting}.`, messageAr: `${b.name} (${ltr(fmt(b.amountUsd))}) كانت مستحقة من ${daysAr(-days)} و${waitingAr}.` });
    } else if (days <= DUE_SOON_DAYS) {
      if (b.status === "not_started") {
        routine.push(`${b.name} ${fmt(b.amountUsd)} (${days <= 1 ? when : shortDate(b.dueDate)})`);
        routineAr.push(`${b.name} ${ltr(fmt(b.amountUsd))} (${days <= 1 ? whenAr : shortDateAr(b.dueDate)})`);
      } else
        warnings.push({
          level: "warn",
          code: "due_soon",
          billId: b.billId,
          message: `${b.name} (${fmt(b.amountUsd)}) is due ${when} and is ${waiting}.`,
          messageAr: `${b.name} (${ltr(fmt(b.amountUsd))}) مستحقة ${whenAr} و${waitingAr}.`,
        });
    }
  }
  if (routine.length) {
    warnings.push({ level: "info", code: "due_soon", message: `Due in the next ${DUE_SOON_DAYS} days and not paid yet: ${routine.join(", ")}.`, messageAr: `مستحق خلال ${DUE_SOON_DAYS} أيام ولسه متدفعش: ${routineAr.join("، ")}.` });
  }
  if (input.notCounted?.length) {
    const n = input.notCounted.length;
    warnings.push({
      level: "info",
      code: "not_counted",
      message: `Not counted: ${input.notCounted.join(", ")}. ${n === 1 ? "The supplier isn't" : "Their suppliers aren't"} on the allowlist, so the policy won't pay ${n === 1 ? "it" : "them"}.`,
      messageAr: `مش محسوبة: ${input.notCounted.join("، ")}. ${n === 1 ? "المورد مش" : "الموردين مش"} في قائمة الموردين المعتمدين، فالسياسة مش هتدفع ${n === 1 ? "الفاتورة دي" : "الفواتير دي"}.`,
    });
  }

  if (!warnings.some((w) => w.level === "warn") && open.length === 0) {
    warnings.unshift({ level: "ok", code: "all_clear", message: "Nothing left to pay this month.", messageAr: "مفيش حاجة فاضلة للدفع الشهر ده." });
  } else if (!tipping && !warnings.some((w) => w.code === "treasury_short")) {
    warnings.unshift({
      level: "ok",
      code: "all_clear",
      message: `The ${open.length} open bill${open.length === 1 ? "" : "s"} (${fmt(usd)}) fit the budget${input.treasuryUsdc !== null ? ` and the treasury covers them (needs ${usdc(chain)} of ${usdc(input.treasuryUsdc)})` : ""}.`,
      messageAr: `الفواتير المفتوحة (${open.length}) بإجمالي ${ltr(fmt(usd))} جوه الميزانية${input.treasuryUsdc !== null ? ` والخزنة تغطيها (محتاجة ${ltr(usdc(chain))} من ${ltr(usdc(input.treasuryUsdc))})` : ""}.`,
    });
  }

  return {
    open: { count: open.length, usd: Math.round(usd * 100) / 100, onChainUsdc: +chain.toFixed(6) },
    budgetLeftAfterUsd: Math.round((input.budgetUsd - input.committedUsd - usd) * 100) / 100,
    treasuryLeftAfterUsdc: input.treasuryUsdc === null ? null : +(input.treasuryUsdc - chain).toFixed(6),
    warnings,
  };
}
