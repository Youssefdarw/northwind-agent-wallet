import { useEffect, useState } from "react";
import type { DashboardState } from "../api";
import { api, dateTime, short } from "../api";
import { Button } from "./ui";
import { useLang } from "../i18n";

interface Form {
  monthlyBudgetUsd: string;
  autoApproveLimitUsd: string;
  maxPricePerCallUsd: string;
  allowlistIds: string[];
}

const fromPolicy = (s: DashboardState): Form => ({
  monthlyBudgetUsd: String(s.policy.monthlyBudgetUsd),
  autoApproveLimitUsd: String(s.policy.autoApproveLimitUsd),
  maxPricePerCallUsd: String(s.policy.maxPricePerCallUsd),
  allowlistIds: s.policy.allowlist.map((e) => e.merchantId),
});

export function PolicyEditor({ s, onSaved }: { s: DashboardState; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => fromPolicy(s));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { t, locale } = useLang();
  const base = fromPolicy(s);
  const dirty = JSON.stringify({ ...form, allowlistIds: [...form.allowlistIds].sort() }) !== JSON.stringify({ ...base, allowlistIds: [...base.allowlistIds].sort() });

  // Pick up external changes (reset, another tab) when there are no local edits.
  useEffect(() => {
    if (!dirty) setForm(fromPolicy(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.policy.version, s.policy.updatedAt]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const p = await api.savePolicy({
        monthlyBudgetUsd: Number(form.monthlyBudgetUsd),
        autoApproveLimitUsd: Number(form.autoApproveLimitUsd),
        maxPricePerCallUsd: Number(form.maxPricePerCallUsd),
        allowlistIds: form.allowlistIds,
      });
      setMsg({ ok: true, text: t(`Saved as policy v${p.version}. New payments are checked against it.`, `اتحفظت كسياسة v${p.version}. الدفعات الجديدة هتتراجع عليها.`) });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setForm((f) => ({ ...f, allowlistIds: f.allowlistIds.includes(id) ? f.allowlistIds.filter((x) => x !== id) : [...f.allowlistIds, id] }));

  const payTo = (id: string) => s.policy.allowlist.find((e) => e.merchantId === id)?.payTo;
  const busy = !!s.run.busy;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{t("Spending policy", "سياسة الصرف")}</h3>
        <span className="text-xs text-slate-500">
          v{s.policy.version} · {t("updated", "اتعدلت")} {dateTime(s.policy.updatedAt, locale)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {t(
          "Checked by deterministic code before anything is signed. The AI can read these limits but has no tool to change them.",
          "كود ثابت بيراجعها قبل أي توقيع. الذكاء الاصطناعي يقدر يقرا الحدود دي بس معندوش أي أداة يغيّرها بيها.",
        )}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MoneyField label={t("Monthly budget", "ميزانية الشهر")} value={form.monthlyBudgetUsd} onChange={(v) => setForm({ ...form, monthlyBudgetUsd: v })} />
        <MoneyField label={t("Auto-approve limit / payment", "حد الموافقة التلقائية / دفعة")} value={form.autoApproveLimitUsd} onChange={(v) => setForm({ ...form, autoApproveLimitUsd: v })} />
        <MoneyField label={t("Max price / API call", "أقصى سعر / طلب API")} value={form.maxPricePerCallUsd} step="0.01" onChange={(v) => setForm({ ...form, maxPricePerCallUsd: v })} />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-slate-600">{t("Allowlisted merchants", "الموردين المعتمدين")}</div>
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {s.bills.filter((b) => !b.vendorId).map((b) => {
            const on = form.allowlistIds.includes(b.billId);
            const addr = payTo(b.billId);
            return (
              <li key={b.billId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="accent-brand-700" checked={on} onChange={() => toggle(b.billId)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{b.merchant}</span>
                    <span className="ms-2 text-xs text-slate-500" dir="ltr">
                      {b.domain}
                    </span>
                  </span>
                  <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">{addr ? short(addr) : on ? t("pending save", "مستني الحفظ") : t("not allowed", "مش مسموح")}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[11px] text-slate-400">
          {t(
            "Each entry is pinned to the merchant's known wallet, so a lookalike invoice with a different pay-to address is still blocked.",
            "كل مورد مربوط بمحفظته المعروفة، فلو جت فاتورة شبهها بعنوان دفع مختلف برضه هتتمنع.",
          )}
        </p>
      </div>

      {s.readOnly ? (
        <p className="mt-4 text-xs text-slate-500">
          {t("Read-only copy: the owner edits these limits on their own machine. Network: Base Sepolia (locked).", "نسخة للعرض: صاحب الشركة بيعدّل الحدود دي على جهازه. الشبكة: Base Sepolia (مقفولة).")}
        </p>
      ) : (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={!dirty || saving || busy} onClick={save}>
          {saving ? t("Saving…", "بيحفظ…") : t("Save policy", "احفظ السياسة")}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setForm(base)}>
            {t("Discard", "تجاهل")}
          </Button>
        )}
        <span className="text-xs text-slate-500">{t("Network: Base Sepolia (locked)", "الشبكة: Base Sepolia (مقفولة)")}</span>
      </div>
      )}
      {busy && dirty && <p className="mt-2 text-xs text-amber-700">{t("Policy can't change while the agent is running.", "مينفعش تغيّر السياسة والوكيل شغال.")}</p>}
      {msg && <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}

function MoneyField({ label, value, onChange, step = "1" }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="mt-1 flex items-center rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-brand-600">
        <span className="ps-3 text-sm text-slate-400">$</span>
        <input
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg bg-transparent px-2 py-2 text-sm font-semibold tabular-nums text-slate-900 outline-none"
        />
      </div>
    </label>
  );
}
