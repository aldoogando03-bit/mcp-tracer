import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { CONTENT, type Content, type Lang } from "./content";

const STORAGE_KEY = "mcp-tracer-lang";

type LangState = { lang: Lang; t: Content; setLang: (lang: Lang) => void };

const LangContext = createContext<LangState | null>(null);

/** ?lang=es in the URL wins, then the saved choice, then English. */
function initialLang(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "en" || fromUrl === "es") return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "es") return saved;
  } catch {
    /* storage can be unavailable (private mode); fall through */
  }
  return "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  return <LangContext.Provider value={{ lang, t: CONTENT[lang], setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}
