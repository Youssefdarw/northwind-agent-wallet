import { useState, type ReactNode } from "react";
import type { BillView } from "../api";
import { dayMonth, ruleLabel, short, usd, usdShort } from "../api";
import { useLang } from "../i18n";
import { Button, ExtLink, StatusPill } from "./ui";

/** UI hint only (the policy engine never reads this text). */
const looksLikeInjection = (t: string) =>
  /\b(AI|agent|assistant)\b.*\b(ignore|pre-?approved|already approved|bypass|override|skip)\b|SYSTEM NOTE|NOTE TO (THE )?AI/i.test(t);

/** Paid and rejected bills are done: they fold to one line until opened. */
const SETTLED = new Set(["paid", "rejected"]);

export function BillCard({
  bill,
  index,
  busy,
  readOnly = false,
  onApprove,
  onReject,
  onMandate,
  onRemove,
}: {
  bill: BillView;
  index: number;
  busy: boolean;
  /** Shared read-only copy: no approve / reject / remove. */
  readOnly?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onMandate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t, ar, locale } = useLang();
  const e = bill.entry;
  const status = e?.status ?? "not_started";
  const d = e?.decision;
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const settled = SETTLED.has(status);
  const open = expanded ?? !settled;
  const injection = looksLikeInjection(bill.description) || (bill.upload?.suspiciousInstructions.length ?? 0) > 0;
  const metered = bill.billType === "pay_per_use";
  const calls = e?.calls ?? bill.expectedCalls ?? 0;
  const payments = e?.payments ?? [];
  const up = bill.upload;
  const walletChanged = !!bill.knownPayTo && bill.knownPayTo.toLowerCase() !== bill.payTo.toLowerCase();
  const typeLabel = {
    subscription: t("Subscription", "اشتراك"),
    pay_per_use: t("Pay-per-use · x402", "دفع بالاستخدام · x402"),
    invoice: t("Invoice", "فاتورة"),
  }[bill.billType];

  const accent =
    status === "paid"
      ? "border-s-emerald-500"
      : status === "blocked" || status === "failed"
        ? "border-s-red-500"
        : status === "awaiting_approval" || status === "partially_paid"
          ? "border-s-amber-500"
          : status === "paying"
            ? "border-s-sky-500"
            : status === "rejected"
              ? "border-s-slate-300"
              : "border-s-slate-200";

  const approvedLine = d && (status === "paid" || status === "partially_paid" || status === "paying" || status === "failed") && (
    <span className="font-semibold text-emerald-700">
      ✓{" "}
      {d.approval === "human"
        ? t(`Approved by you · policy v${d.policyVersion}`, `وافقت عليها · سياسة v${d.policyVersion}`)
        : t(`Auto-approved · policy v${d.policyVersion}`, `موافقة تلقائية · سياسة v${d.policyVersion}`)}
    </span>
  );

  const checksToggle = d && (
    <button onClick={() => setShowChecks((v) => !v)} className="font-medium text-brand-600 hover:underline">
      {showChecks ? t("Hide the policy checks", "اخفي فحوصات السياسة") : t(`Show all ${d.checks.length} policy checks`, `اعرض الـ ${d.checks.length} فحص`)}
    </button>
  );

  const paymentLinks = (
    <>
      {payments.length === 1 && <ExtLink href={payments[0]!.explorerUrl}>{t("Transaction on BaseScan", "المعاملة على BaseScan")}</ExtLink>}
      {payments.length > 1 && (
        <button onClick={() => setShowTx((v) => !v)} className="font-medium text-brand-600 hover:underline">
          {showTx
            ? t(`Hide ${payments.length} transactions`, `اخفي الـ ${payments.length} معاملة`)
            : t(`${payments.length} transactions on BaseScan`, `${payments.length} معاملة على BaseScan`)}
        </button>
      )}
      {e?.mandateId && (
        <button
          onClick={() => onMandate(e.mandateId!)}
          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 font-semibold text-brand-700 hover:bg-brand-100"
        >
          🔏 {t("Signed mandate", "التفويض الموقّع")}
        </button>
      )}
    </>
  );

  return (
    <article className={`card border-s-4 [overflow-wrap:anywhere] ${accent} p-4 transition-colors sm:p-5 ${status === "rejected" ? "bg-slate-50" : ""}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-500">{index}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="me-0.5 font-semibold text-slate-900">{bill.merchant}</h3>
              <Chip>{typeLabel}</Chip>
              {bill.source === "added" && <Chip tone="brand">{t("Added by you", "إنت ضفته")}</Chip>}
              {bill.source === "upload" && (
                <Chip tone="violet" title={up?.fileName}>
                  📄 {t("Uploaded", "فاتورة مرفوعة")}
                  {up?.language === "ar" && !ar ? " · العربية" : ""}
                </Chip>
              )}
              {bill.poNumber && (
                <Chip>
                  {t("PO", "أمر شراء")} {bill.poNumber}
                </Chip>
              )}
              {bill.dueDate && !settled && (
                <Chip>
                  {t("Due", "مستحقة")} {dayMonth(bill.dueDate, locale)}
                </Chip>
              )}
              {walletChanged && <Chip tone="red">⚠ {t("New wallet requested", "طالب محفظة جديدة")}</Chip>}
              {!bill.allowlisted && !bill.vendorId && <Chip tone="red">{t("Not allowlisted", "مش معتمد")}</Chip>}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              <span dir="ltr">
                {bill.domain} · {bill.invoiceNumber}
              </span>
              {bill.custom && !readOnly && status !== "paying" && status !== "awaiting_approval" && (
                <button
                  disabled={busy}
                  onClick={() => confirm(t(`Remove ${bill.merchant} from the bill list?`, `تشيل ${bill.merchant} من قايمة الفواتير؟`)) && onRemove(bill.billId)}
                  className="ms-2 font-medium text-slate-400 hover:text-red-600 hover:underline disabled:opacity-50"
                >
                  {t("Remove", "شيل")}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-end">
            <div className={`text-lg font-bold tabular-nums ${status === "rejected" ? "text-slate-400 line-through decoration-1" : "text-slate-900"}`}>
              {metered ? `${usd(bill.amountUsd)}/${t("call", "طلب")}` : usdShort(bill.amountUsd)}
            </div>
            <div className="text-[11px] text-slate-500" dir="ltr">
              {metered
                ? `× ${calls} = ${usd(bill.amountUsd * calls)} → ${+(bill.amountUsd * calls).toFixed(6)} test USDC`
                : `→ ${bill.onChainLabel.split("→ ")[1]?.replace(" on-chain", "") ?? bill.onChainLabel}`}
            </div>
          </div>
          <StatusPill status={status} />
        </div>
      </div>

      {/* Settled: one summary line */}
      {settled && (
        <div className="ms-11 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600">
          {status === "rejected" ? <span className="font-medium">{t("You rejected it. Nothing was signed.", "إنت رفضتها. محدش وقّع على حاجة.")}</span> : approvedLine}
          {metered && calls > 1 && (
            <span className="tabular-nums">
              {payments.length}/{calls} {t("calls paid", "طلب اتدفع")}
            </span>
          )}
          {paymentLinks}
          <button onClick={() => setExpanded(!open)} className="ms-auto font-medium text-slate-500 hover:text-slate-800">
            {open ? t("Hide details ▴", "اخفي التفاصيل ▴") : t("Details ▾", "التفاصيل ▾")}
          </button>
        </div>
      )}

      {open && (
        <>
          {/* Merchant-supplied text */}
          <div className={`ms-11 mt-3 rounded-lg px-3 py-2 text-xs ${injection ? "bg-red-50 ring-1 ring-inset ring-red-200" : "bg-slate-50 ring-1 ring-inset ring-slate-100"}`}>
            <div className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider rtl:tracking-normal ${injection ? "text-red-600" : "text-slate-400"}`}>
              {injection
                ? t("⚠ Invoice text contains instructions aimed at the AI · untrusted", "⚠ نص الفاتورة فيه تعليمات موجّهة للذكاء الاصطناعي · مش موثوق")
                : t("Invoice text from merchant · untrusted", "نص الفاتورة من المورد · مش موثوق")}
            </div>
            <div className={`font-mono leading-relaxed [overflow-wrap:anywhere] ${injection ? "text-red-900" : "text-slate-600"}`} dir="auto">
              {bill.description}
            </div>
          </div>

          {/* Uploaded invoice: what Claude read */}
          {up && (
            <div className="ms-11 mt-3 space-y-1.5 text-xs">
              <p className="text-slate-600" dir="auto">
                <span className="font-semibold text-slate-700">
                  {t("From", "من")} <span dir="ltr">{up.fileName}</span>:
                </span>{" "}
                {ar && up.summaryAr ? up.summaryAr : up.summaryEn}
                {up.dueDate && (
                  <span className="text-slate-400">
                    {" "}
                    · {t("due", "مستحقة")} {dayMonth(up.dueDate, locale)}
                  </span>
                )}
              </p>
              {!ar && up.language === "ar" && up.summaryAr && (
                <p dir="rtl" className="text-slate-600">
                  {up.summaryAr}
                </p>
              )}
              {walletChanged && (
                <p className="text-red-700 [overflow-wrap:anywhere]">
                  {t("Invoice asks to be paid at ", "الفاتورة طالبة الدفع على ")}
                  <code dir="ltr">{short(bill.payTo, 6)}</code>
                  {t("; the wallet on file is ", "، والمحفظة المسجلة هي ")}
                  <code dir="ltr">{short(bill.knownPayTo!, 6)}</code>.
                </p>
              )}
              {(up.computedNotes.length > 0 || up.reviewNotes.length > 0) && (
                <ul className="space-y-0.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900">
                  {up.computedNotes.map((n, i) => (
                    <li key={`c${i}`} dir="auto">
                      • <span className="font-semibold">{t("Code:", "الكود:")}</span> {n}
                    </li>
                  ))}
                  {up.reviewNotes.map((n, i) => (
                    <li key={i} dir="auto">
                      • <span className="font-semibold">Claude:</span> {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Agent reasoning */}
          {e?.agentReasoning && (
            <div className="ms-11 mt-3 flex gap-2 text-sm">
              <span className="mt-0.5 h-fit shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700 rtl:tracking-normal">
                {t("Agent", "الوكيل")}
              </span>
              <p className="italic text-slate-700" dir="auto">
                "{e.agentReasoning}"
              </p>
            </div>
          )}
          {settled && status === "paid" && d && <div className="ms-11 mt-2 text-xs">{checksToggle}</div>}
        </>
      )}

      {/* Held / blocked: the decision, always visible */}
      {d && (status === "blocked" || status === "awaiting_approval") && (
        <div
          className={`ms-11 mt-3 rounded-lg p-3 text-sm ring-1 ring-inset ${status === "blocked" ? "bg-red-50 text-red-900 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{status === "blocked" ? t("Blocked by policy:", "السياسة منعتها:") : t("Held for you:", "مستنية قرارك:")}</span>
            <span>{d.firedRule ? ruleLabel(d.firedRule, ar) : d.reason}</span>
            {d.firedRule && (
              <code className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold" dir="ltr">
                {d.firedRule}
              </code>
            )}
          </div>
          <div className={`mt-1 text-xs opacity-80 ${ar ? "text-end" : ""}`} dir="ltr">
            {d.reason}
          </div>
          {status === "blocked" && (
            <div className="mt-1 text-xs font-medium">
              {d.firedRule === "payee_mismatch"
                ? t("Nobody can approve this one, not even you: the wallet isn't the supplier's.", "محدش يقدر يوافق على دي، ولا حتى إنت: المحفظة مش بتاعة المورد.")
                : t("Nothing was signed and no money moved.", "محدش وقّع على حاجة ومفيش فلوس اتحركت.")}
            </div>
          )}
          {status === "awaiting_approval" && e?.approvalNote && (
            <div className="mt-2 rounded-md bg-white/70 px-2.5 py-1.5 text-xs">
              <div className="font-semibold">{t("Agent's note to you", "ملاحظة الوكيل ليك")}</div>
              <p dir="auto" className="mt-0.5">
                {e.approvalNote}
              </p>
            </div>
          )}
          {status === "awaiting_approval" && readOnly && (
            <div className="mt-2 text-xs font-semibold">{t("Waiting for the owner to approve or reject.", "مستنية صاحب الشركة يوافق أو يرفض.")}</div>
          )}
          {status === "awaiting_approval" && !readOnly && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="approve" disabled={busy} onClick={() => onApprove(bill.billId)}>
                ✓ {t("Approve", "موافقة")} {usdShort(d.totalUsd)}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => onReject(bill.billId)}>
                {t("Reject", "رفض")}
              </Button>
            </div>
          )}
          <div className="mt-2 text-xs [&_button]:text-current">{checksToggle}</div>
        </div>
      )}

      {/* In progress (paying / partial / failed): approval line */}
      {!settled && approvedLine && (
        <div className="ms-11 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          {approvedLine}
          <span className="text-slate-300">·</span>
          {checksToggle}
        </div>
      )}

      {e?.error && status !== "blocked" && (
        <div className="ms-11 mt-2 text-xs text-red-700" dir="ltr">
          {e.error}
        </div>
      )}

      {showChecks && d && (
        <ol className="ms-11 mt-2 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
          {d.checks.map((c) => (
            <li key={c.rule} className="flex gap-2">
              <span className={c.passed ? "text-emerald-600" : "font-bold text-red-600"}>{c.passed ? "✓" : "✗"}</span>
              <code className="w-36 shrink-0 font-semibold text-slate-700" dir="ltr">
                {c.rule}
              </code>
              <span className="text-slate-600" dir="ltr">
                {c.detail}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Payments (cards still in progress) */}
      {!settled && (payments.length > 0 || e?.mandateId) && (
        <div className="ms-11 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
          {metered && calls > 1 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(payments.length / calls) * 100}%` }} />
              </div>
              <span className="tabular-nums text-slate-600">
                {payments.length}/{calls} {t("calls paid", "طلب اتدفع")}
              </span>
            </div>
          )}
          {paymentLinks}
        </div>
      )}
      {showTx && payments.length > 1 && (
        <div className="ms-11 mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {payments.map((p, i) => (
            <a
              key={p.txHash}
              href={p.explorerUrl}
              target="_blank"
              rel="noreferrer"
              title={p.txHash}
              className="rounded bg-slate-50 px-1.5 py-1 text-center font-mono text-[11px] text-brand-600 ring-1 ring-inset ring-slate-200 hover:bg-brand-50"
            >
              #{i + 1}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

const CHIP = {
  slate: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 font-semibold",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 font-semibold",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-semibold",
} as const;

function Chip({ children, tone = "slate", title }: { children: ReactNode; tone?: keyof typeof CHIP; title?: string }) {
  return (
    <span title={title} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP[tone]}`}>
      {children}
    </span>
  );
}
