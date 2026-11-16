import { useCallback, useEffect, useState } from "react";
import type { DashboardState } from "./api";
import { api } from "./api";
import { LangSwitch, Logo, SectionTitle } from "./components/ui";
import { useLang } from "./i18n";
import { BudgetCard, RunCard, TreasuryCard } from "./components/Overview";
import { BillCard } from "./components/BillCard";
import { ActivityPanel } from "./components/Activity";
import { PolicyEditor } from "./components/PolicyEditor";
import { MandateModal } from "./components/MandateModal";
import { AddMerchantButton } from "./components/AddMerchant";
import { UploadInvoiceButton } from "./components/UploadInvoice";
import { PurchaseOrders } from "./components/PurchaseOrders";
import { CashflowCard } from "./components/Cashflow";
import { AskCard } from "./components/Ask";
import { STATIC } from "./api";

const POLL_MS = 1500;

export default function App() {
  const [s, setS] = useState<DashboardState | null>(null);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const { t, locale } = useLang();

  const refresh = useCallback(async () => {
    try {
      setS(await api.state());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (STATIC) return; // a snapshot never changes
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setToast(null);
    try {
      await fn();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
      refresh();
    }
  };

  const stats = s ? countStatuses(s) : null;
  const ro = !!s?.readOnly;

  return (
    <div className="min-h-screen">
      <header className="bg-brand-800 shadow-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Logo />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-500/15 px-3 py-1 text-xs font-semibold text-accent-400 ring-1 ring-inset ring-accent-500/40">
              {t("Concept demo · Base Sepolia testnet", "ديمو تجريبي · شبكة Base Sepolia للاختبار")}
            </span>
            <LangSwitch />
          </div>
        </div>
      </header>

      {s?.readOnly && (
        <div className="bg-brand-50 px-4 py-2 text-center text-sm font-medium text-brand-800 ring-1 ring-inset ring-brand-100">
          {s.readOnly.mode === "snapshot"
            ? t(
                `Read-only copy of the dashboard, taken ${new Date(s.readOnly.takenAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Payments are real Base Sepolia testnet transactions: click any link to check them.`,
                `نسخة للعرض من لوحة التحكم، اتاخدت ${new Date(s.readOnly.takenAt).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}. الدفعات معاملات حقيقية على شبكة Base Sepolia للاختبار: دوس على أي لينك وتأكد بنفسك.`,
              )
            : t("Read-only view: you can look around, but nothing can be paid or changed from here.", "عرض بس: تقدر تتفرج، بس مفيش حاجة تتدفع أو تتغير من هنا.")}
        </div>
      )}
      {offline && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm font-medium text-white">
          {STATIC ? (
            t("Couldn't load this snapshot.", "النسخة دي مش راضية تفتح.")
          ) : (
            <>
              {t("Can't reach the dashboard API on 127.0.0.1:4000. Is ", "مش قادر يوصل للسيرفر على 127.0.0.1:4000. هل ")}
              <code className="rounded bg-red-700 px-1">npm run demo</code>
              {t(" running?", " شغال؟")}
            </>
          )}
        </div>
      )}
      {toast && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          {toast}
          <button className="ms-3 underline" onClick={() => setToast(null)}>
            {t("dismiss", "اقفل")}
          </button>
        </div>
      )}

      {!s ? (
        <div className="py-32 text-center text-slate-500">{offline ? t("Waiting for the API…", "مستني السيرفر…") : t("Loading…", "بيحمّل…")}</div>
      ) : (
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("November bills", "فواتير نوفمبر")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              {t(
                "An AI agent pays Northwind Industrial's monthly bills from a USDC wallet using x402, but only inside the limits you set. Every payment is a real testnet transaction you can check on BaseScan.",
                "وكيل ذكاء اصطناعي بيدفع فواتير Northwind Industrial الشهرية من محفظة USDC عن طريق x402، بس جوه الحدود اللي إنت حاططها. كل دفعة معاملة حقيقية على شبكة الاختبار وتقدر تتأكد منها على BaseScan.",
              )}
            </p>
          </div>

          {stats && stats.heldBills.length > 0 && !ro && (
            <a
              href={`#bill-${stats.heldBills[0]!.billId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300 transition hover:bg-amber-100"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="font-semibold">
                {t(
                  `${stats.heldBills.length} bill${stats.heldBills.length === 1 ? " needs" : "s need"} your decision`,
                  stats.heldBills.length === 1 ? "فيه فاتورة مستنية قرارك" : `فيه ${stats.heldBills.length} فواتير مستنية قرارك`,
                )}
              </span>
              <span className="text-amber-800">{stats.heldBills.map((b) => b.merchant).join(" · ")}</span>
              <span className="ms-auto font-semibold">{t("Review ↓", "راجعها ↓")}</span>
            </a>
          )}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TreasuryCard s={s} />
            <BudgetCard s={s} />
            <RunCard s={s} pending={pending} onRun={(c, lang) => act(() => api.run(c, lang))} onReset={() => act(api.reset)} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CashflowCard s={s} />
            <AskCard s={s} />
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div>
              <SectionTitle
                aside={
                  stats && (
                    <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-600">
                      <span className="text-emerald-700">{t(`${stats.paid} paid`, `${stats.paid} اتدفعت`)}</span>
                      <span className="text-amber-700">{t(`${stats.held} awaiting approval`, `${stats.held} مستنية موافقتك`)}</span>
                      <span className="text-red-700">{t(`${stats.blocked} blocked`, `${stats.blocked} اتمنعت`)}</span>
                    </div>
                  )
                }
              >
                {t("This month's bills", "فواتير الشهر")}
              </SectionTitle>
              <div className="space-y-3">
                {s.bills.map((b, i) => (
                  <div key={b.billId} id={`bill-${b.billId}`} className="scroll-mt-4">
                  <BillCard
                    bill={b}
                    index={i + 1}
                    busy={!!s.run.busy || pending}
                    readOnly={ro}
                    onApprove={(id) => act(() => api.approve(id))}
                    onReject={(id) => act(() => api.reject(id))}
                    onMandate={setMandateId}
                    onRemove={(id) => act(() => api.removeMerchant(id))}
                  />
                  </div>
                ))}
                {!ro && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <UploadInvoiceButton disabled={!!s.run.busy} onAdded={refresh} />
                    <AddMerchantButton demoScale={s.config.demoScale} disabled={!!s.run.busy} onAdded={refresh} />
                  </div>
                )}
              </div>
            </div>
            <aside>
              <SectionTitle>{t("Activity", "النشاط")}</SectionTitle>
              <ActivityPanel s={s} />
            </aside>
          </section>

          <section>
            <SectionTitle>{t("Owner controls", "تحكم صاحب الشركة")}</SectionTitle>
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <fieldset disabled={ro} className="min-w-0">
                <PolicyEditor s={s} onSaved={refresh} />
              </fieldset>
              <PurchaseOrders s={s} />
            </div>
          </section>

          <footer className="border-t border-slate-200 pt-4 pb-8 text-xs text-slate-500">
            {t(
              "Concept demo for discussion. Runs on Base Sepolia testnet with test USDC only; no real funds move.",
              "ديمو تجريبي للنقاش. شغال على شبكة Base Sepolia للاختبار بعملة USDC تجريبية بس؛ مفيش فلوس حقيقية بتتحرك.",
            )}{" "}
            <span dir="ltr">
              Agent: {s.config.model} · Network {s.config.network} · x402
            </span>
          </footer>
        </main>
      )}

      <MandateModal id={mandateId} onClose={() => setMandateId(null)} />
    </div>
  );
}

function countStatuses(s: DashboardState) {
  const st = s.bills.map((b) => b.entry?.status);
  return {
    heldBills: s.bills.filter((b) => b.entry?.status === "awaiting_approval"),
    paid: st.filter((x) => x === "paid").length,
    held: st.filter((x) => x === "awaiting_approval").length,
    blocked: st.filter((x) => x === "blocked").length,
  };
}
