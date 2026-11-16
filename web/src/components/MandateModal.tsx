import { useEffect, useState } from "react";
import type { MandateView } from "../api";
import { api, dateTime, usd, ruleName, STATIC } from "../api";
import { useLang } from "../i18n";
import { ExtLink, Modal } from "./ui";

const EXPLORER = "https://sepolia.basescan.org";

export function MandateModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [m, setM] = useState<MandateView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const { t, ar, locale } = useLang();
  const dt = (v: string | number) => dateTime(v, locale);

  useEffect(() => {
    setM(null);
    setErr(null);
    setRaw(false);
    if (id) api.mandate(id).then(setM, (e) => setErr(String(e.message ?? e)));
  }, [id]);

  const b = m?.body;
  const now = Date.now() / 1000;
  const paid = m?.attempts.filter((a) => a.status === "paid").length ?? 0;

  return (
    <Modal open={!!id} onClose={onClose} title={t("Payment mandate (AP2-inspired)", "تفويض الدفع (مستوحى من AP2)")}>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!m && !err && <p className="text-sm text-slate-500">{t("Loading…", "بيحمّل…")}</p>}
      {m && b && (
        <div className="space-y-4 text-sm">
          <div className={`flex items-start gap-3 rounded-lg p-3 ring-1 ring-inset ${m.signatureValid ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200"}`}>
            <span className={`text-xl ${m.signatureValid ? "text-emerald-600" : "text-red-600"}`}>{m.signatureValid ? "✓" : "✗"}</span>
            <div className="min-w-0 text-xs">
              <div className={`text-sm font-semibold ${m.signatureValid ? "text-emerald-800" : "text-red-800"}`}>
                {m.signatureValid
                  ? STATIC
                    ? t("Signature verified when this copy was made", "التوقيع اتراجع وقت عمل النسخة دي")
                    : t("Signature verified just now", "التوقيع اتراجع دلوقتي حالاً")
                  : t("Signature does NOT match the company key", "التوقيع مش مطابق لمفتاح الشركة")}
              </div>
              <div className="mt-0.5 text-slate-600">
                {t("EIP-712 signature recovered to ", "توقيع EIP-712 بيرجع للعنوان ")}
                <code className="break-all" dir="ltr">
                  {m.recoveredSigner ?? "—"}
                </code>
                {t(
                  ", the company signer key (separate from the treasury key that moves funds).",
                  "، وده مفتاح التوقيع بتاع الشركة (منفصل عن مفتاح الخزنة اللي بيحرّك الفلوس).",
                )}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {t(
              "A mandate is the owner's signed permission for one specific payment. It's issued only after the policy engine approves, and the payment executor refuses to pay anything that doesn't match it exactly: merchant, wallet, amount, chain, token, and expiry.",
              "التفويض هو إذن موقّع من صاحب الشركة لدفعة واحدة بعينها. مبيطلعش غير بعد ما محرك السياسة يوافق، ومنفّذ الدفع بيرفض يدفع أي حاجة مش مطابقة له بالظبط: المورد، المحفظة، المبلغ، الشبكة، العملة، ووقت الانتهاء.",
            )}
          </p>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Row k={t("Merchant", "المورد")} v={`${b.merchantName} (${b.merchantId})`} />
            <Row k={t("Invoice", "الفاتورة")} v={b.invoiceNumber} />
            <Row k={b.maxUses > 1 ? t("Price per call", "سعر الطلب") : t("Invoice amount", "مبلغ الفاتورة")} v={usd(Number(b.invoiceAmountUsd))} />
            <Row
              k={t("On-chain amount", "المبلغ على البلوكتشين")}
              v={`${(Number(b.amountAtomic) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} test USDC × ${t(`up to ${b.maxUses} payment${b.maxUses > 1 ? "s" : ""}`, `لحد ${b.maxUses} ${b.maxUses > 1 ? "دفعات" : "دفعة"}`)}`}
            />
            <Row k={t("Pay to", "الدفع لـ")} v={<ExtLink href={`${EXPLORER}/address/${b.payTo}`} className="break-all font-mono text-xs">{b.payTo}</ExtLink>} />
            <Row k={t("Token", "العملة")} v={<ExtLink href={`${EXPLORER}/token/${b.asset}`} className="break-all font-mono text-xs">USDC {b.asset.slice(0, 10)}…</ExtLink>} />
            <Row k={t("Network", "الشبكة")} v={`${b.network} (Base Sepolia)`} />
            <Row k={t("Resource", "المورد على الشبكة")} v={<code className="break-all text-xs">{b.resource}</code>} />
            <Row k={t("Policy version", "إصدار السياسة")} v={`v${b.policyVersion}`} />
            <Row
              k={t("Approval", "الموافقة")}
              v={b.approval === "human" ? t("Approved by owner", "وافق عليها صاحب الشركة") : t("Auto-approved by policy", "موافقة تلقائية من السياسة")}
            />
            <Row k={t("Issued", "اتعمل")} v={dt(b.issuedAt)} />
            <Row k={t("Expires", "بينتهي")} v={`${dt(b.expiresAt)}${b.expiresAt < now ? t(" (expired)", " (انتهى)") : ""}`} />
            <Row k={t("Used", "اتستخدم")} v={t(`${m.uses} of ${b.maxUses} (${paid} paid attempt${paid === 1 ? "" : "s"})`, `${m.uses} من ${b.maxUses} (${paid} محاولة مدفوعة)`)} />
            <Row k={t("Demo scale", "مقياس الديمو")} v={`×${b.demoScale}`} />
          </dl>

          <div>
            <div className="text-xs font-semibold text-slate-500">
              {t("Purpose (the agent's own words: stored for audit, never read by any rule)", "الغرض (بكلام الوكيل نفسه: محفوظ للمراجعة، ومفيش قاعدة بتقراه)")}
            </div>
            <p className="mt-1 rounded-lg bg-slate-50 p-2.5 text-xs italic text-slate-700" dir="auto">
              "{b.purpose}"
            </p>
          </div>

          {m.decision && (
            <div>
              <div className="text-xs font-semibold text-slate-500">{t("Policy decision that authorized it", "قرار السياسة اللي سمح بيه")}</div>
              <ul className="mt-1 space-y-0.5 rounded-lg bg-slate-50 p-2.5 text-xs">
                {m.decision.checks.map((c) => (
                  <li key={c.rule} className="flex gap-2">
                    <span className={c.passed ? "text-emerald-600" : "text-red-600"}>{c.passed ? "✓" : "✗"}</span>
                    <span className="w-56 shrink-0 text-slate-700">{ruleName(c.rule, ar)}</span>
                    <span className="text-slate-500" dir="ltr">
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m.attempts.some((a) => a.status !== "paid") && (
            <div className="text-xs">
              <div className="font-semibold text-slate-500">{t("Attempts that didn't settle", "محاولات متمّتش")}</div>
              <ul className="mt-1 space-y-0.5">
                {m.attempts
                  .filter((a) => a.status !== "paid")
                  .map((a, i) => (
                    <li key={i} className="text-slate-600">
                      {dt(a.at)} · {a.status}
                      {a.authorization && ` · authorization ${a.authorization.state.replace("_", " ")}`}
                      {a.reason && ` · ${a.reason}`}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <code className="truncate text-[11px] text-slate-400" title={m.signature} dir="ltr">
              sig {m.signature.slice(0, 26)}…
            </code>
            <button onClick={() => setRaw((v) => !v)} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
              {raw ? t("Hide raw signed JSON", "اخفي JSON الموقّع") : t("Show raw signed JSON", "اعرض JSON الموقّع")}
            </button>
          </div>
          {raw && (
            <pre dir="ltr" className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify({ body: m.body, signature: m.signature }, null, 2)}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 rtl:tracking-normal">{k}</dt>
      <dd className="text-slate-800">{v}</dd>
    </div>
  );
}
