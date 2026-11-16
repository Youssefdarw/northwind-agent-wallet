import { useEffect, useState } from "react";
import { useLang } from "../i18n";
import type { DashboardState } from "../api";
import { usd, usdShort, short } from "../api";
import { Button, ExtLink } from "./ui";

export function TreasuryCard({ s }: { s: DashboardState }) {
  const { t } = useLang();
  return (
    <div className="card flex flex-col p-5">
      <div className="text-sm font-medium text-slate-500">{t("Agent's treasury wallet", "خزنة الوكيل")}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
          {s.treasury.usdc === null ? "…" : Number(s.treasury.usdc).toLocaleString("en-US", { maximumFractionDigits: 6 })}
        </span>
        <span className="text-sm font-semibold text-slate-500">test USDC</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">{t("Live on-chain balance · Base Sepolia", "الرصيد الحالي على البلوكتشين · Base Sepolia")}</div>
      <div className="mt-auto space-y-1.5 pt-4 text-xs text-slate-600">
        <div className="flex items-center justify-between gap-2">
          <span>{t("Address", "العنوان")}</span>
          <ExtLink href={s.treasury.url} className="font-mono">
            {short(s.treasury.address, 5)}
          </ExtLink>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>{t("Demo scale", "مقياس الديمو")}</span>
          <span className="font-medium text-slate-800" dir="ltr">
            ×{s.config.demoScale} ($4,850 → {+(4850 * s.config.demoScale).toFixed(6)} USDC)
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>{t("Gas", "رسوم الشبكة")}</span>
          <span className="font-medium text-slate-800">{t("Paid by x402 facilitator", "بيدفعها وسيط x402")}</span>
        </div>
      </div>
    </div>
  );
}

export function BudgetCard({ s }: { s: DashboardState }) {
  const { t } = useLang();
  const budget = s.policy.monthlyBudgetUsd;
  const committed = s.budget.committedUsd;
  const held = s.bills
    .filter((b) => b.entry?.status === "awaiting_approval")
    .reduce((sum, b) => sum + (b.entry?.decision?.totalUsd ?? 0), 0);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / budget) * 100))}%`;
  const over = committed + held > budget;
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between text-sm font-medium text-slate-500">
        <span>{t("Monthly budget", "ميزانية الشهر")}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {t("policy", "سياسة")} v{s.policy.version}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{usd(committed)}</span>
        <span className="text-sm font-medium text-slate-500">{t(`of ${usdShort(budget)} committed`, `من ${usdShort(budget)} اتصرفت`)}</span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
        <div className="bg-brand-600 transition-all duration-700" style={{ width: pct(committed) }} />
        <div className={`stripes transition-all duration-700 ${over ? "bg-red-400" : "bg-amber-400"}`} style={{ width: pct(held) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-brand-600" /> {t("Committed", "اتصرف")}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-amber-400" /> {t("Held for approval", "مستني موافقتك")} {held > 0 && `(${usdShort(held)})`}
        </span>
        <span className="ms-auto font-medium text-slate-800">{t(`${usd(s.budget.remainingUsd)} left`, `فاضل ${usd(s.budget.remainingUsd)}`)}</span>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4 text-xs">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-slate-500">{t("Auto-approve up to", "موافقة تلقائية لحد")}</div>
          <div className="font-semibold text-slate-900">
            {usdShort(s.policy.autoApproveLimitUsd)} / {t("payment", "دفعة")}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-slate-500">{t("API calls at most", "أقصى سعر للطلب")}</div>
          <div className="font-semibold text-slate-900">
            {usd(s.policy.maxPricePerCallUsd)} / {t("call", "طلب")}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunCard({
  s,
  onRun,
  onReset,
  pending,
}: {
  s: DashboardState;
  onRun: (compromised: boolean, language: "en" | "ar") => void;
  onReset: () => void;
  pending: boolean;
}) {
  const { t, lang: uiLang } = useLang();
  const [redTeam, setRedTeam] = useState(false);
  const [lang, setLang] = useState<"en" | "ar">(uiLang);
  useEffect(() => setLang(uiLang), [uiLang]); // the agent writes in the dashboard's language unless you pick otherwise
  const busy = !!s.run.busy;
  if (s.readOnly) return <ReadOnlyRunCard s={s} />;
  const anyStarted = s.bills.some((b) => b.entry);
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between text-sm font-medium text-slate-500">
        <span>{t("AI agent", "الوكيل الذكي")}</span>
        <span className="font-mono text-[11px] text-slate-400">{s.config.model}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {t(
          "The agent reads each invoice and proposes payments. Deterministic policy code decides; only then is a mandate signed and USDC sent via x402.",
          "الوكيل بيقرا كل فاتورة وبيقترح الدفع. كود السياسة الثابت هو اللي بيقرر؛ وبعدها بس بيتوقّع التفويض وتتبعت USDC عن طريق x402.",
        )}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-700">{t("Agent writes in", "الوكيل بيكتب بـ")}</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Agent language">
          {(
            [
              ["en", "English"],
              ["ar", "العربية"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={lang === id}
              disabled={busy}
              onClick={() => setLang(id)}
              className={`rounded-md px-3 py-1 font-semibold transition ${lang === id ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className={`mt-2 flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 text-xs ring-1 ring-inset transition ${redTeam ? "bg-red-50 ring-red-200" : "bg-slate-50 ring-slate-200"}`}>
        <input type="checkbox" className="mt-0.5 accent-red-600" checked={redTeam} onChange={(e) => setRedTeam(e.target.checked)} disabled={busy} />
        <span>
          <span className="font-semibold text-slate-800">{t("Red-team mode", "وضع الاختبار الهجومي")}</span>
          <span className="text-slate-600">
            {t(
              ": tell the agent to obey instructions it finds in invoices, to show the policy still holds.",
              ": بنقول للوكيل ينفّذ أي تعليمات يلاقيها في الفواتير، عشان نثبت إن السياسة لسه بتحمي.",
            )}
          </span>
        </span>
      </label>

      <div className="mt-auto flex gap-2 pt-4">
        <Button variant={redTeam ? "danger" : "primary"} className="flex-1" disabled={busy || pending || !s.merchantsOnline} onClick={() => onRun(redTeam, lang)}>
          {busy ? (
            <>
              <Spinner /> {s.run.busy}
            </>
          ) : (
            <>
              <span>▶</span> {t("Run this month's bills", "شغّل فواتير الشهر")}
            </>
          )}
        </Button>
        <Button
          variant="outline"
          disabled={busy || pending || !anyStarted}
          onClick={() => {
            if (
              confirm(
                t(
                  "Reset the demo? This clears the ledger, mandates and policy edits. On-chain balances are not touched.",
                  "تعيد الديمو من الأول؟ ده بيمسح السجل والتفويضات وتعديلات السياسة. الأرصدة على البلوكتشين مش بتتأثر.",
                ),
              )
            )
              onReset();
          }}
        >
          {t("Reset", "من الأول")}
        </Button>
      </div>
      {!s.merchantsOnline && (
        <p className="mt-2 text-xs font-medium text-red-600">
          {t("Merchant servers aren't reachable. Start them with ", "سيرفرات الموردين مش شغالة. شغّلها بـ ")}
          <code className="rounded bg-red-50 px-1">npm run merchants</code>.
        </p>
      )}
    </div>
  );
}

function ReadOnlyRunCard({ s }: { s: DashboardState }) {
  const { t } = useLang();
  const paid = s.bills.filter((b) => b.entry?.status === "paid").length;
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between text-sm font-medium text-slate-500">
        <span>{t("AI agent", "الوكيل الذكي")}</span>
        <span className="font-mono text-[11px] text-slate-400">{s.config.model}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {t(
          "The agent reads each invoice and proposes payments. Deterministic policy code decides; only then is a mandate signed and USDC sent via x402.",
          "الوكيل بيقرا كل فاتورة وبيقترح الدفع. كود السياسة الثابت هو اللي بيقرر؛ وبعدها بس بيتوقّع التفويض وتتبعت USDC عن طريق x402.",
        )}
      </p>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
        <div className="font-semibold text-slate-800">
          {t("Last run: ", "آخر تشغيل: ")}
          {s.run.status === "idle"
            ? t("not run yet", "لسه متشغلش")
            : s.run.mode === "compromised"
              ? t("red-team mode", "وضع الاختبار الهجومي")
              : t("normal mode", "الوضع العادي")}
        </div>
        <div className="mt-0.5">
          {t(
            `${paid} of ${s.bills.length} bills paid on-chain. Click a payment's link to check it on BaseScan.`,
            `${paid} من ${s.bills.length} فواتير اتدفعت على البلوكتشين. دوس على لينك أي دفعة عشان تتأكد منها على BaseScan.`,
          )}
        </div>
      </div>
      <p className="mt-auto pt-4 text-xs text-slate-500">{t("Read-only copy: the owner runs the agent on their own machine.", "نسخة للعرض بس: صاحب الشركة بيشغّل الوكيل على جهازه.")}</p>
    </div>
  );
}

export function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />;
}
