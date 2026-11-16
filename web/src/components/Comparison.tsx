import type { BillView } from "../api";
import { usd } from "../api";
import { ExtLink } from "./ui";
import { useLang } from "../i18n";

/**
 * Fabrikam invoice: bank wire vs stablecoin rails. The figures are Sempo's own public
 * claims (sempo.xyz), shown as claims, not as measurements by this demo.
 */
export function ComparisonPanel({ parts }: { parts?: BillView }) {
  const amount = parts?.amountUsd ?? 4850;
  const tx = parts?.entry?.payments[0];
  const { t } = useLang();
  return (
    <div className="card overflow-hidden">
      <div className="p-5 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{t("Paying Fabrikam (UK): bank wire vs USDC", "الدفع لـ Fabrikam (إنجلترا): تحويل بنكي ولا USDC")}</h3>
          <span className="text-xs text-slate-500">
            {t("Invoice", "فاتورة")} {parts?.invoiceNumber ?? "TEST-PRT-0003"}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t(
            `What a ${usd(amount, 0)} cross-border supplier payment from Egypt could cost and how long it takes.`,
            `دفعة ${usd(amount, 0)} لمورد برّه مصر ممكن تتكلف كام وتاخد قد إيه.`,
          )}
        </p>
      </div>

      <div className="grid sm:grid-cols-2">
        <Column
          title={t("Bank wire", "تحويل بنكي")}
          tone="slate"
          labels={[t("Speed", "السرعة"), t("Tracking", "المتابعة")]}
          cost={`${usd(amount * 0.08, 0)} – ${usd(amount * 0.12, 0)}`}
          costNote={t("8–12% in total fees and FX margins", "8–12% رسوم وفروق عملة")}
          speed={t("2–5 business days", "2–5 أيام عمل")}
          extra={t("Limited visibility while in transit", "مش واضح هو فين وهو في الطريق")}
        />
        <Column
          title={t("USDC on-chain", "USDC على البلوكتشين")}
          tone="brand"
          cost={`≈ ${usd(amount * 0.001)}`}
          costNote={t("~0.1% on-chain network fees", "حوالي 0.1% رسوم الشبكة")}
          speed={t("Seconds to minutes, 24/7", "ثواني لدقايق، 24/7")}
          extra={
            tx ? (
              <ExtLink href={tx.explorerUrl}>{t("This demo's Fabrikam payment on BaseScan", "دفعة Fabrikam في الديمو ده على BaseScan")}</ExtLink>
            ) : (
              t("Every payment is publicly verifiable on-chain", "كل دفعة تقدر تتأكد منها علنًا على البلوكتشين")
            )
          }
          labels={[t("Speed", "السرعة"), t("Tracking", "المتابعة")]}
        />
      </div>

      <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-[11.5px] leading-relaxed text-amber-900">
        <span className="font-semibold">{t("Figures as claimed by Sempo", "الأرقام دي حسب كلام Sempo")}</span> {t("on", "على")}{" "}
        <ExtLink href="https://sempo.xyz">sempo.xyz</ExtLink>{" "}
        {t(
          `(checked Nov 2026), not measured by this demo. They aren't strictly like-for-like: the bank figure includes FX margins, while ~0.1% covers on-chain network fees only (off-ramp and FX costs to EGP/GBP would be extra). Sempo's page refers to "stablecoin infrastructure" and doesn't name USDC specifically.`,
          `(اتراجعت نوفمبر 2026)، والديمو ده مقاسهاش. المقارنة مش بالظبط نفس الحاجة: رقم البنك فيه فروق العملة، و0.1% دي رسوم الشبكة بس (التحويل لجنيه أو إسترليني عليه تكلفة زيادة). صفحة Sempo بتقول "بنية تحتية للعملات المستقرة" ومش بتسمّي USDC بالاسم.`,
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  tone,
  cost,
  costNote,
  speed,
  extra,
  labels,
}: {
  title: string;
  tone: "slate" | "brand";
  cost: string;
  costNote: string;
  speed: string;
  extra: React.ReactNode;
  labels: [string, string];
}) {
  const brand = tone === "brand";
  return (
    <div className={`border-t border-slate-100 p-5 sm:border-t-0 ${brand ? "bg-brand-50/60 sm:border-s" : ""}`}>
      <div className={`text-xs font-bold uppercase tracking-wider rtl:tracking-normal ${brand ? "text-brand-700" : "text-slate-500"}`}>{title}</div>
      <div dir="ltr" className={`mt-2 text-2xl font-bold tabular-nums rtl:text-right ${brand ? "text-brand-800" : "text-slate-800"}`}>{cost}</div>
      <div className="text-xs text-slate-500">{costNote}</div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-500">{labels[0]}</dt>
          <dd className="font-semibold text-slate-800">{speed}</dd>
        </div>
        <div className="flex gap-2 text-xs">
          <dt className="w-16 shrink-0 text-slate-500">{labels[1]}</dt>
          <dd className="text-slate-700">{extra}</dd>
        </div>
      </dl>
    </div>
  );
}
