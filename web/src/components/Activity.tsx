import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "../api";
import { time } from "../api";
import { useLang } from "../i18n";

const LIVE_STYLE = {
  agent: "text-brand-700",
  tool: "text-violet-700",
  progress: "text-slate-500",
  error: "text-red-600 font-medium",
  system: "text-slate-900 font-semibold",
} as const;

const EVENT_STYLE = {
  agent: "bg-brand-50 text-brand-700",
  tool: "bg-violet-50 text-violet-700",
  policy: "bg-amber-50 text-amber-800",
  payment: "bg-emerald-50 text-emerald-700",
  approval: "bg-sky-50 text-sky-700",
  system: "bg-slate-100 text-slate-600",
} as const;

const TOOL_LABEL: Record<string, [string, string]> = {
  list_bills: ["Read the bill inbox", "قرا الفواتير"],
  get_budget_status: ["Checked the budget and limits", "راجع الميزانية والحدود"],
  propose_payment: ["Proposed paying", "اقترح يدفع"],
  request_approval: ["Asked you to approve", "طلب موافقتك على"],
};

const KIND_AR: Record<string, string> = { agent: "الوكيل", tool: "أداة", policy: "السياسة", payment: "دفع", approval: "موافقة", system: "النظام" };

/** Audit events store tool calls as name({json}). Turn them into a sentence. */
function ToolEvent({ text, nameOf, t }: { text: string; nameOf: (id: string) => string; t: (en: string, ar: string) => string }) {
  const m = text.match(/^(\w+)\((\{[\s\S]*\})\)$/);
  if (!m) return <>{text}</>;
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(m[2]!);
  } catch {
    return <>{text}</>;
  }
  const label = TOOL_LABEL[m[1]!];
  const bill = typeof input.bill_id === "string" ? nameOf(input.bill_id) : null;
  const words = typeof input.reasoning === "string" ? input.reasoning : typeof input.note === "string" ? input.note : null;
  return (
    <>
      <span className="font-medium text-slate-900">{label ? t(label[0], label[1]) : m[1]}</span>
      {bill && <span className="font-medium text-slate-900"> {bill}</span>}
      {words && (
        <span className="mt-0.5 block italic text-slate-600" dir="auto">
          "{words}"
        </span>
      )}
    </>
  );
}

/** Live tool lines look like name(arg, …) · "reasoning". Swap the function name for words. */
function liveTool(text: string, nameOf: (id: string) => string, t: (en: string, ar: string) => string) {
  const m = text.match(/^(\w+)\(([^)]*)\)([\s\S]*)$/);
  const label = m && TOOL_LABEL[m[1]!];
  if (!m || !label) return text;
  const args = m[2]!.split(", ").filter(Boolean);
  const bill = args[0] ? nameOf(args[0]) : "";
  return `${t(label[0], label[1])}${bill ? ` ${bill}` : ""}${m[3] ?? ""}`;
}

export function ActivityPanel({ s }: { s: DashboardState }) {
  const { t, ar } = useLang();
  const [picked, setPicked] = useState<"live" | "audit" | null>(null);
  // After a server restart the live log is empty but the audit trail persists: show that.
  const tab = picked ?? (s.liveLog.length === 0 && s.events.length > 0 ? "audit" : "live");
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = tab === "live" ? s.liveLog.length : s.events.length;
  const nameOf = (id: string) => s.bills.find((b) => b.billId === id)?.merchant ?? id;

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count, tab]);

  return (
    <div className="card flex h-[min(760px,calc(100vh-6rem))] min-h-[420px] flex-col lg:sticky lg:top-4">
      <div className="flex items-center gap-1 border-b border-slate-200 px-3 pt-3">
        {(
          [
            ["live", t("Agent log", "سجل الوكيل")],
            ["audit", t("Audit trail", "سجل المراجعة")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPicked(id)}
            className={`-mb-px border-b-2 px-3 pb-2 text-sm font-semibold transition ${tab === id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {label}
            <span className="ms-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{id === "live" ? s.liveLog.length : s.events.length}</span>
          </button>
        ))}
        {s.run.mode === "compromised" && (
          <span className="ms-auto mb-2 rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 rtl:tracking-normal">
            {t("Red-team run", "تشغيل الاختبار الهجومي")}
          </span>
        )}
      </div>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-y-auto p-3 text-[12.5px] leading-relaxed"
      >
        {tab === "live" &&
          (s.liveLog.length === 0 ? (
            <Empty>
              {t(
                "Press “Run this month's bills” to watch the agent work. Its reasoning, tool calls and each payment show up here live.",
                "دوس “شغّل فواتير الشهر” وتابع الوكيل وهو شغال. تفكيره وأدواته وكل دفعة هتظهر هنا لحظة بلحظة.",
              )}
            </Empty>
          ) : (
            <ul className="space-y-1.5">
              {s.liveLog.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-slate-400">{time(l.at)}</span>
                  <span dir="auto" className={`min-w-0 [overflow-wrap:anywhere] ${LIVE_STYLE[l.kind]}`}>
                    {l.kind === "agent" && <span className="me-1 font-semibold">{t("Agent:", "الوكيل:")}</span>}
                    {l.kind === "tool" ? liveTool(l.text, nameOf, t) : l.text}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {tab === "audit" &&
          (s.events.length === 0 ? (
            <Empty>
              {t(
                "Every policy decision, mandate and payment is recorded here, and kept across restarts.",
                "كل قرار للسياسة وكل تفويض وكل دفعة بيتسجلوا هنا، وبيفضلوا حتى لو السيرفر اتقفل وفتح.",
              )}
            </Empty>
          ) : (
            <ul className="space-y-2.5">
              {s.events.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-slate-400">{time(e.at)}</span>
                  <span className={`h-fit shrink-0 rounded px-1.5 text-[10px] font-bold uppercase leading-5 rtl:tracking-normal ${EVENT_STYLE[e.kind]}`}>
                    {ar ? KIND_AR[e.kind] : e.kind}
                  </span>
                  <div dir="auto" className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                    {e.kind === "tool" ? (
                      <ToolEvent text={e.message} nameOf={nameOf} t={t} />
                    ) : e.kind === "agent" ? (
                      <div className="space-y-0.5">
                        <MiniMarkdown text={e.message} />
                      </div>
                    ) : (
                      <>
                        {e.billId && <span className="font-semibold text-slate-900">{nameOf(e.billId)}: </span>}
                        {e.message}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </div>

      {s.run.summary && s.run.status === "done" && (
        <div className="border-t border-slate-200 bg-brand-50/60 p-3 text-xs text-slate-700">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-brand-700 rtl:tracking-normal">{t("Agent's summary", "ملخص الوكيل")}</div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto" dir="auto">
            <MiniMarkdown text={s.run.summary} />
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">{children}</div>;
}

/** Renders the agent's summary: **bold**, [text](url) links, "- " bullets. Everything else stays plain text. */
export function MiniMarkdown({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((part, i) => {
      const bold = part.match(/^\*\*([^*]+)\*\*$/);
      if (bold) return <strong key={i}>{bold[1]}</strong>;
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link)
        return (
          <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
            {link[1]}
          </a>
        );
      return part;
    });
  return (
    <>
      {text
        .split("\n")
        .filter((l) => l.trim())
        .map((l, i) => {
          const bullet = l.match(/^\s*[-*]\s+(.*)$/);
          return bullet ? (
            <p key={i} className="ps-3 -indent-3">
              • {inline(bullet[1]!)}
            </p>
          ) : (
            <p key={i}>{inline(l.replace(/^#+\s*/, ""))}</p>
          );
        })}
    </>
  );
}
