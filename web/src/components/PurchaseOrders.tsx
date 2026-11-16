import type { DashboardState } from "../api";
import { usd } from "../api";
import { useLang } from "../i18n";

/** Reference data the smart checks compare invoices against. */
export function PurchaseOrders({ s }: { s: DashboardState }) {
  const { t } = useLang();
  const nameOf = (id: string) => s.bills.find((b) => b.billId === id)?.merchant ?? id;
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-slate-900">{t("Purchase orders", "أوامر الشراء")}</h3>
      <p className="mt-1 text-xs text-slate-500">
        {t(
          "Invoices that cite a PO are checked against it by code: right supplier, and not more than what's left on the PO. Last months' payments are used to spot duplicates and price jumps.",
          "أي فاتورة فيها رقم أمر شراء الكود بيراجعها عليه: نفس المورد، ومش أكتر من الباقي في الأمر. ومدفوعات الشهور اللي فاتت بتتستخدم عشان نلاقي التكرار وزيادة الأسعار.",
        )}
      </p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-400 rtl:tracking-normal">
          <tr>
            <th className="pb-1 text-start font-semibold">{t("PO", "أمر الشراء")}</th>
            <th className="pb-1 text-start font-semibold">{t("Supplier", "المورد")}</th>
            <th className="pb-1 text-start font-semibold">{t("For", "عشان")}</th>
            <th className="pb-1 text-end font-semibold">{t("Amount", "المبلغ")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {s.purchaseOrders.map((po) => {
            const bills = s.bills.filter((b) => b.poNumber?.toLowerCase() === po.number.toLowerCase());
            return (
              <tr key={po.number} className="align-top">
                <td className="py-1.5 pe-2 font-mono font-semibold whitespace-nowrap text-slate-700">{po.number}</td>
                <td className="py-1.5 pe-2 text-slate-700">{nameOf(po.merchantId)}</td>
                <td className="py-1.5 pe-2 text-slate-600" dir="auto">
                  {po.description}
                  {bills.length > 0 && <div className="text-[11px] text-slate-400">
                      {t("Invoices this month: ", "فواتير الشهر: ")}
                      <span dir="ltr">{bills.map((b) => b.invoiceNumber).join(", ")}</span>
                    </div>}
                </td>
                <td className="py-1.5 text-end font-medium tabular-nums text-slate-800">{usd(po.amountUsd, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
