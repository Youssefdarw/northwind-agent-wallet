import { useRef, useState } from "react";
import type { InvoiceDraft } from "../api";
import { api, short, usd } from "../api";
import { Button, Modal } from "./ui";
import { Spinner } from "./Overview";
import { useLang } from "../i18n";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

type Stage = { kind: "pick" } | { kind: "reading"; fileName: string } | { kind: "review"; draft: InvoiceDraft };

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function UploadInvoiceButton({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [err, setErr] = useState<string | null>(null);
  const { t } = useLang();

  const close = () => {
    setOpen(false);
    setStage({ kind: "pick" });
    setErr(null);
  };

  const onFile = async (file: File) => {
    setErr(null);
    if (file.size > 8 * 1024 * 1024) return setErr(t("File is larger than 8 MB", "الملف أكبر من 8 ميجا"));
    setStage({ kind: "reading", fileName: file.name });
    try {
      const draft = await api.readInvoice({ fileName: file.name, mediaType: file.type, dataBase64: await readAsBase64(file) });
      setStage({ kind: "review", draft });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStage({ kind: "pick" });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-600/40 bg-brand-50/60 px-4 py-4 text-sm font-semibold text-brand-700 transition hover:border-brand-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        📄 {t("Upload an invoice (PDF or photo)", "ارفع فاتورة (PDF أو صورة)")}
      </button>

      <Modal open={open} onClose={close} title={t("Upload an invoice", "رفع فاتورة")}>
        {stage.kind === "pick" && <Picker onFile={onFile} err={err} />}
        {stage.kind === "reading" && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-brand-700">
              <Spinner />
            </span>
            <div className="text-sm font-semibold text-slate-800">
              {t("Claude is reading", "Claude بيقرا")} <span dir="ltr">{stage.fileName}</span>…
            </div>
            <div className="max-w-sm text-xs text-slate-500">
              {t(
                "Extracting the supplier, amounts, line items, PO and payment details, and flagging anything suspicious. Usually 10–30 seconds.",
                "بيطلّع المورد والمبالغ والبنود وأمر الشراء وبيانات الدفع، وبينبّه على أي حاجة مريبة. عادةً من 10 لـ 30 ثانية.",
              )}
            </div>
          </div>
        )}
        {stage.kind === "review" && (
          <Review
            draft={stage.draft}
            onDone={() => {
              close();
              onAdded();
            }}
            onBack={() => setStage({ kind: "pick" })}
          />
        )}
      </Modal>
    </>
  );
}

function Picker({ onFile, err }: { onFile: (f: File) => void; err: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { t } = useLang();
  return (
    <div className="space-y-3">
      <div
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${over ? "border-brand-600 bg-brand-50" : "border-slate-300 hover:border-brand-600 hover:bg-slate-50"}`}
      >
        <div className="text-3xl">📄</div>
        <div className="text-sm font-semibold text-slate-800">{t("Drop an invoice here, or click to choose", "اسحب الفاتورة هنا، أو دوس واختار ملف")}</div>
        <div className="text-xs text-slate-500">{t("PDF, PNG, JPG or WEBP · up to 8 MB · English or Arabic", "PDF أو PNG أو JPG أو WEBP · لحد 8 ميجا · عربي أو إنجليزي")}</div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-slate-500">
        {t("Sample invoices to try are in the project's ", "فيه فواتير تجريبية في فولدر ")}
        <code className="rounded bg-slate-100 px-1">samples/</code>
        {t(
          " folder. The file is sent to the Claude API to be read; nothing is paid until you confirm and the policy approves.",
          " في المشروع. الملف بيتبعت لـ Claude API عشان يتقري؛ ومفيش حاجة بتتدفع غير لما توافق والسياسة توافق.",
        )}
      </p>
      {err && <p className="text-xs font-medium text-red-600">{err}</p>}
    </div>
  );
}

function Review({ draft, onDone, onBack }: { draft: InvoiceDraft; onDone: () => void; onBack: () => void }) {
  const x = draft.extraction;
  const [vendorId, setVendorId] = useState<string>(draft.suggestion.vendorId ?? "__new");
  const [newName, setNewName] = useState(x.vendor_name.replace(/\s*\(.*\)\s*$/, "").slice(0, 60));
  const [newDomain, setNewDomain] = useState(x.vendor_domain ?? "");
  const [allowlist, setAllowlist] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vendor = draft.vendors.find((v) => v.id === vendorId);
  const walletChanged = !!vendor && !!x.payment_wallet_address && x.payment_wallet_address.toLowerCase() !== vendor.payTo.toLowerCase();
  const notUsd = x.currency.toUpperCase() !== "USD";
  const rtl = x.document_language === "ar";
  const { t, ar } = useLang();

  const add = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.addInvoice(draft.id, vendorId === "__new" ? { newVendor: { name: newName, domain: newDomain, allowlist } } : { vendorId });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 rtl:tracking-normal">
            {t("What Claude read from", "اللي Claude قراه من")} <span dir="ltr">{draft.fileName}</span>
          </div>
          <div className="mt-0.5 text-lg font-bold text-slate-900" dir="auto">
            {x.vendor_name}
          </div>
          <div className="text-xs text-slate-500">
            {x.vendor_domain ?? t("no domain printed", "مفيش دومين")} · {t("invoice", "فاتورة")} {x.invoice_number ?? "—"} · {x.invoice_date ?? t("no date", "من غير تاريخ")}
            {x.due_date && ` · ${t("due", "مستحقة")} ${x.due_date}`}
          </div>
        </div>
        <div className="text-end">
          <div className="text-2xl font-bold tabular-nums text-slate-900">
            {x.total_amount === null ? "—" : notUsd ? `${x.total_amount.toLocaleString()} ${x.currency}` : usd(x.total_amount)}
          </div>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {rtl && <Chip>العربية</Chip>}
            {x.is_recurring_subscription && <Chip>{t("Subscription", "اشتراك")}</Chip>}
            {x.po_number && <Chip>PO {x.po_number}</Chip>}
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-2">
        <p dir="ltr" className={`text-left ${ar ? "sm:order-2" : ""}`}>
          {x.summary_en}
        </p>
        <p dir="rtl" className="text-right">
          {x.summary_ar}
        </p>
      </div>

      {x.line_items.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-start text-[10px] uppercase tracking-wider text-slate-400 rtl:tracking-normal">
            <tr>
              <th className="pb-1 text-start font-semibold">{t("Item", "البند")}</th>
              <th className="pb-1 ps-3 text-end font-semibold">{t("Qty", "الكمية")}</th>
              <th className="pb-1 ps-3 text-end font-semibold">{t("Unit", "سعر الوحدة")}</th>
              <th className="pb-1 ps-3 text-end font-semibold">{t("Amount", "المبلغ")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {x.line_items.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pe-2 text-slate-700" dir="auto">
                  {l.description}
                </td>
                <td className="py-1 ps-3 text-end tabular-nums text-slate-600">{l.quantity ?? ""}</td>
                <td className="py-1 ps-3 text-end tabular-nums text-slate-600">{l.unit_price?.toLocaleString() ?? ""}</td>
                <td className="py-1 text-end font-medium tabular-nums text-slate-800">{l.amount?.toLocaleString() ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {x.suspicious_instructions.length > 0 && (
        <Box tone="red" title={t("⚠ Text aimed at an AI or the payer (copied, not followed)", "⚠ كلام موجّه للذكاء الاصطناعي أو للي بيدفع (اتنسخ، ومش هيتنفّذ)")}>
          {x.suspicious_instructions.map((txt, i) => (
            <p key={i} className="font-mono [overflow-wrap:anywhere]" dir="auto">
              “{txt}”
            </p>
          ))}
        </Box>
      )}
      {(x.review_notes.length > 0 || draft.computed.length > 0) && (
        <Box tone="amber" title={t("Worth double-checking", "يستاهل تتأكد منه")}>
          {draft.computed.map((txt, i) => (
            <p key={`c${i}`}>
              <b>{t("Checked by code:", "فحص بالكود:")}</b> <span dir="ltr">{txt}</span>
            </p>
          ))}
          {x.review_notes.map((txt, i) => (
            <p key={i} dir="auto">
              <b>Claude:</b> {txt}
            </p>
          ))}
        </Box>
      )}

      {/* Supplier match: the owner decides */}
      <div className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">{t("Who is this invoice from?", "الفاتورة دي من مين؟")}</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="input mt-1">
            {draft.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.domain}) · {t("supplier on file", "مورد مسجّل")}
              </option>
            ))}
            <option value="__new">{t("New supplier…", "مورد جديد…")}</option>
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">
            {t("Suggested by matching name and domain: ", "اقتراح بمطابقة الاسم والدومين: ")}
            <span dir="ltr">{draft.suggestion.why}</span>. {t("You decide; the AI doesn't.", "القرار ليك إنت، مش للذكاء الاصطناعي.")}
          </span>
        </label>

        {vendor && (
          <div className="mt-2 text-xs">
            {walletChanged ? (
              <div className="rounded-md bg-red-50 p-2 text-red-800 ring-1 ring-inset ring-red-200">
                {ar ? (
                  <>
                    <b>⚠ تغيير محفظة:</b> الفاتورة عايزة الفلوس تروح على <code dir="ltr">{short(x.payment_wallet_address!, 6)}</code>، بس محفظة {vendor.name} المسجلة هي{" "}
                    <code dir="ltr">{short(vendor.payTo, 6)}</code>. لو ضفتها، السياسة هتمنع الدفعة دي. دي أشهر حيلة نصب بانتحال صفة المورد: اتأكد بالتليفون قبل ما
                    تغير أي حاجة.
                  </>
                ) : (
                  <>
                    <b>⚠ Wallet change:</b> the invoice asks to be paid at <code>{short(x.payment_wallet_address!, 6)}</code>, but {vendor.name}'s wallet on file is{" "}
                    <code>{short(vendor.payTo, 6)}</code>. If you add it, the policy will block this payment. That's the classic supplier-impersonation fraud: verify by
                    phone before changing anything.
                  </>
                )}
              </div>
            ) : (
              <div className="text-slate-600">
                {t(`Will be paid to ${vendor.name}'s wallet on file `, `هتتدفع على محفظة ${vendor.name} المسجلة `)}
                <code className="text-slate-500" dir="ltr">
                  {short(vendor.payTo, 6)}
                </code>
                {t(", and checked against its history and purchase orders.", "، وهتتراجع على تاريخ الدفع وأوامر الشراء.")}
              </div>
            )}
          </div>
        )}

        {vendorId === "__new" && (
          <div className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("Supplier name", "اسم المورد")} className="input" dir="auto" />
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="supplier.example" className="input" dir="ltr" />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 accent-brand-700" checked={allowlist} onChange={(e) => setAllowlist(e.target.checked)} />
              <span className="text-slate-600">
                <b className="text-slate-800">{t("Add to the allowlist.", "ضيفه لقائمة المعتمدين.")}</b>{" "}
                {t(
                  "Off by default: a supplier you've never paid shouldn't become trusted just because an invoice arrived.",
                  "مقفولة من الأول: مورد عمرك ما دفعتله مينفعش يبقى موثوق لمجرد إن فاتورة وصلت.",
                )}
              </span>
            </label>
            {x.payment_wallet_address && (
              <p className="text-[11px] text-slate-500">
                {t("The invoice lists wallet ", "الفاتورة فيها محفظة ")}
                <span dir="ltr">{short(x.payment_wallet_address, 6)}</span>
                {t(". In this demo, new suppliers get a generated test wallet instead.", ". في الديمو ده، الموردين الجداد بياخدوا محفظة اختبار النظام بيعملها.")}
              </p>
            )}
          </div>
        )}
      </div>

      {notUsd && (
        <p className="text-xs font-medium text-red-600">
          {t(`This invoice is in ${x.currency}. The demo pays USD invoices only.`, `الفاتورة دي بالـ ${x.currency}. الديمو بيدفع فواتير بالدولار بس.`)}
        </p>
      )}
      {err && <p className="text-xs font-medium text-red-600">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <span className="rtl:-scale-x-100">←</span> {t("Upload a different file", "ارفع ملف تاني")}
        </Button>
        <Button disabled={saving || notUsd || x.total_amount === null} onClick={add}>
          {saving ? t("Adding…", "بيضيف…") : t("Add to this month's bills", "ضيفها لفواتير الشهر")}
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        {t("Adding it doesn't pay it. The agent proposes it on the next run, and the policy decides.", "إضافتها مش معناها إنها اتدفعت. الوكيل بيقترحها في التشغيل الجاي، والسياسة هي اللي بتقرر.")}
      </p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{children}</span>;
}

function Box({ tone, title, children }: { tone: "red" | "amber"; title: string; children: React.ReactNode }) {
  const cls = tone === "red" ? "bg-red-50 text-red-900 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200";
  return (
    <div className={`space-y-1 rounded-lg p-3 text-xs ring-1 ring-inset ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider rtl:tracking-normal">{title}</div>
      {children}
    </div>
  );
}
