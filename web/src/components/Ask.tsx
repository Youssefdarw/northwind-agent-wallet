import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "../api";
import { api } from "../api";
import { Button } from "./ui";
import { MiniMarkdown } from "./Activity";
import { useLang } from "../i18n";

type Turn = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = {
  en: ["What's still waiting on me, and why?", "Will we stay inside the budget this month?", "Why was the cheap parts shop blocked?", "إيه الفواتير اللي مستحقة الأسبوع ده؟"],
  ar: ["إيه اللي لسه مستني موافقتي، وليه؟", "هنفضل جوه الميزانية الشهر ده؟", "ليه محل قطع الغيار الرخيصة اتمنع؟", "How much did we pay Fabrikam this month?"],
};

export function AskCard({ s }: { s: DashboardState }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const enabled = !s.readOnly || s.readOnly.askEnabled;
  const { t, lang } = useLang();

  useEffect(() => {
    // Block body on purpose: newer browsers return a promise from scrollIntoView, and React would treat it as a cleanup.
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns, loading]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setError(null);
    setQ("");
    const history = turns;
    setTurns([...history, { role: "user", text }]);
    setLoading(true);
    try {
      const { answer } = await api.ask(text, history);
      setTurns((t) => [...t, { role: "assistant", text: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTurns(history);
      setQ(text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card flex flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-500">
        <span className="whitespace-nowrap">{t("Ask the agent", "اسأل الوكيل")}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {t("read-only · can't pay or change anything", "للقراية بس · مايقدرش يدفع أو يغيّر حاجة")}
        </span>
      </div>

      <div className="mt-3 max-h-80 min-h-24 flex-1 space-y-3 overflow-y-auto">
        {turns.length === 0 && !loading && (
          <p className="text-sm text-slate-500">
            {t(
              "Ask about this month's bills in English or Arabic. The agent answers from the ledger, the policy and the cash-flow check. It has no tools, so it can explain but never act.",
              "اسأل عن فواتير الشهر بالعربي أو بالإنجليزي. الوكيل بيرد من السجل والسياسة وفحص السيولة. معندوش أي أدوات، فيقدر يشرح بس عمره ما ينفّذ.",
            )}
          </p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} dir="auto" className="ms-8 rounded-lg bg-brand-700 px-3 py-2 text-sm text-white [overflow-wrap:anywhere]">
              {t.text}
            </div>
          ) : (
            <div key={i} dir="auto" className="me-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-200 [overflow-wrap:anywhere]">
              <MiniMarkdown text={t.text} />
            </div>
          ),
        )}
        {loading && (
          <div className="me-4 animate-pulse rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">{t("Thinking…", "بيفكر…")}</div>
        )}
        <div ref={end} />
      </div>

      {enabled ? (
        <>
          {turns.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS[lang].map((x) => (
                <button
                  key={x}
                  dir="auto"
                  onClick={() => ask(x)}
                  disabled={loading}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-50 disabled:opacity-50"
                >
                  {x}
                </button>
              ))}
            </div>
          )}
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input dir="auto" className="input flex-1" placeholder={t("Ask a question…", "اكتب سؤالك…")} value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" disabled={loading || !q.trim()}>
              {t("Ask", "اسأل")}
            </Button>
          </form>
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
          {t("Ask works on the live demo. This is a read-only copy.", "خاصية السؤال شغالة في الديمو الحي بس. دي نسخة للعرض.")}
        </p>
      )}
    </div>
  );
}
