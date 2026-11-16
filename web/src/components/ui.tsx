import { useEffect, type ReactNode } from "react";
import type { BillStatus } from "../api";
import { useLang } from "../i18n";

const STATUS_AR: Record<BillStatus, string> = {
  not_started: "لسه",
  paying: "بيتدفع…",
  paid: "اتدفعت",
  partially_paid: "اتدفع جزء",
  awaiting_approval: "مستنية موافقتك",
  blocked: "اتمنعت",
  rejected: "اترفضت",
  failed: "فشلت",
};

const STATUS: Record<BillStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  not_started: { label: "Not started", cls: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
  paying: { label: "Paying…", cls: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", pulse: true },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  partially_paid: { label: "Partially paid", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  awaiting_approval: { label: "Awaiting approval", cls: "bg-amber-50 text-amber-800 ring-amber-300", dot: "bg-amber-500", pulse: true },
  blocked: { label: "Blocked", cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  rejected: { label: "Rejected", cls: "bg-slate-100 text-slate-600 ring-slate-300", dot: "bg-slate-500" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
};

export function StatusPill({ status }: { status: BillStatus }) {
  const s = STATUS[status];
  const { ar } = useLang();
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${s.cls}`}>
      <span className="relative flex h-2 w-2">
        {s.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${s.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
      </span>
      {ar ? STATUS_AR[status] : s.label}
    </span>
  );
}

export function Logo() {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
        <rect width="40" height="40" rx="9" className="fill-brand-800" />
        <circle cx="20" cy="21.5" r="11" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="52 17" transform="rotate(130 20 21.5)" />
        <path d="M20 21.5l6.5-6.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="20" cy="21.5" r="2.6" fill="#fff" />
      </svg>
      <div className="leading-tight">
        <div className="text-[17px] font-bold tracking-tight text-white">
          Northwind<span className="text-accent-400"> Industrial</span>
        </div>
        <div className="text-xs font-medium uppercase tracking-[0.14em] text-brand-100/70 rtl:tracking-normal">{t("Agent Wallet", "محفظة الوكيل الذكي")}</div>
      </div>
    </div>
  );
}

export function ExtLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`font-medium text-brand-600 hover:text-brand-800 hover:underline ${className}`}>
      {children}
      <span aria-hidden className="ms-0.5 inline-block text-[0.85em] rtl:-scale-x-100">↗</span>
    </a>
  );
}

type BtnVariant = "primary" | "danger" | "ghost" | "approve" | "outline";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  approve: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
  outline: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${className}`}
    />
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="card w-full max-w-3xl [overflow-wrap:anywhere]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close / إغلاق">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 rtl:tracking-normal">{children}</h2>
      {aside}
    </div>
  );
}

/** EN | العربية switch for the whole dashboard. */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-lg bg-white/10 p-0.5 ring-1 ring-inset ring-white/15" role="radiogroup" aria-label="Language / اللغة">
      {(
        [
          ["en", "EN"],
          ["ar", "العربية"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={lang === id}
          lang={id}
          onClick={() => setLang(id)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${lang === id ? "bg-white text-brand-800 shadow-sm" : "text-brand-100/80 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
