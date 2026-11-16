import type { DashboardState } from "../api";
import { usd } from "../api";
import { useLang } from "../i18n";

const LEVEL = {
  warn: { icon: "!", cls: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500 text-white" },
  info: { icon: "i", cls: "bg-sky-50 text-sky-900 ring-sky-200", dot: "bg-sky-500 text-white" },
  ok: { icon: "✓", cls: "bg-emerald-50 text-emerald-900 ring-emerald-200", dot: "bg-emerald-500 text-white" },
} as const;

export function CashflowCard({ s }: { s: DashboardState }) {
  const c = s.cashflow;
  const { t, ar } = useLang();
  return (
    <div className="card flex flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-500">
        <span className="whitespace-nowrap">{t("Cash-flow check", "فحص السيولة")}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">{t("plain code, no AI", "كود عادي، من غير ذكاء اصطناعي")}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3 text-center">
        <Stat label={t("Still to pay", "فاضل يتدفع")} value={usd(c.open.usd, 0)} sub={t(`${c.open.count} bill${c.open.count === 1 ? "" : "s"}`, `${c.open.count} فاتورة`)} />
        <Stat label={t("Budget left after", "الميزانية بعدها")} value={usd(c.budgetLeftAfterUsd, 0)} bad={c.budgetLeftAfterUsd < 0} />
        <Stat
          label={t("Treasury left after", "الخزنة بعدها")}
          value={c.treasuryLeftAfterUsdc === null ? "…" : `${+c.treasuryLeftAfterUsdc.toFixed(4)}`}
          sub="test USDC"
          bad={(c.treasuryLeftAfterUsdc ?? 0) < 0}
        />
      </div>
      <ul className="mt-4 space-y-2">
        {c.warnings.map((w, i) => {
          const l = LEVEL[w.level];
          return (
            <li key={i} className={`flex gap-2.5 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${l.cls}`}>
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${l.dot}`}>{l.icon}</span>
              <span className="[overflow-wrap:anywhere]">{ar && w.messageAr ? w.messageAr : w.message}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-auto pt-3 text-xs text-slate-500">
        {t("Warnings only. Whether a bill gets paid is still decided by the policy.", "دي تنبيهات بس. الدفع نفسه لسه قرار السياسة.")}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2 ring-1 ring-inset ring-slate-200" dir="auto">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div dir="ltr" className={`mt-0.5 text-lg font-bold tabular-nums ${bad ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
