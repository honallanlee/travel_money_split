"use client";
import { Languages } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ZH_HANT } from "./i18n-zh";

export type Lang = "en" | "zh-Hant";
type Vars = Record<string, string | number>;
export type TFn = (key: string, vars?: Vars) => string;

const STORAGE_KEY = "tms:lang";

/** English strings are the keys; missing translations fall back to English. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  let s = lang === "zh-Hant" ? (ZH_HANT[key] ?? key) : key;
  if (lang === "zh-Hant" && !(key in ZH_HANT) && process.env.NODE_ENV !== "production") {
    console.warn(`[i18n] missing zh-Hant: ${JSON.stringify(key)}`);
  }
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  /** BCP-47 locale for dates */
  locale: string;
}

const Ctx = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  t: (k, v) => translate("en", k, v),
  locale: "en-GB",
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (saved === "en" || saved === "zh-Hant") setLangState(saved);
    else if (/^zh-(TW|HK|MO|Hant)/i.test(navigator.language)) setLangState("zh-Hant");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh-Hant" ? "zh-Hant" : "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const value = useMemo<LangCtx>(
    () => ({ lang, setLang, t: (k, v) => translate(lang, k, v), locale: lang === "zh-Hant" ? "zh-TW" : "en-GB" }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);

/** Compact EN / 繁中 switch. */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useT();
  const next: Lang = lang === "en" ? "zh-Hant" : "en";
  return (
    <button
      onClick={() => setLang(next)}
      className={
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 ring-1 ring-line " + (className ?? "")
      }
      aria-label={lang === "en" ? "切換至繁體中文" : "Switch to English"}
    >
      <Languages className="h-4 w-4" />
      {lang === "en" ? "繁中" : "EN"}
    </button>
  );
}
