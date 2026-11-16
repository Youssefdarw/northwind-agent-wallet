/**
 * English / Arabic for the dashboard UI.
 *
 * Strings sit next to their translation where they're used: t("Paid", "مدفوعة").
 * The choice is remembered per browser and flips the page to right-to-left.
 * Text written by the agent, merchants or Claude is shown as written (dir="auto").
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";
const KEY = "nw-agent-wallet-lang";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

function initialLang(): Lang {
  // A link can choose the language: ?lang=ar or ?lang=en (handy for sharing).
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "ar" || fromUrl === "en") return fromUrl;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  const ar = lang === "ar";
  /** Pick the string for the current language. */
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  /** Locale for dates: Arabic month names, Western digits (as Egyptian invoices use). */
  const locale = ar ? "ar-EG-u-nu-latn" : "en-GB";
  return { lang, ar, t, setLang, locale };
}

/** "3 bills" / "3 فواتير" with a simple Arabic plural (1, 2, 3–10, 11+). */
export function countAr(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
