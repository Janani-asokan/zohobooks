import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type Lang, type TKey } from '@/i18n';

export type Theme = 'light' | 'dark' | 'system';

interface Prefs {
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey | string, fallback?: string) => string;
}

const PrefsContext = createContext<Prefs | null>(null);

const read = <T extends string>(k: string, d: T): T => {
  try {
    return (localStorage.getItem(k) as T) || d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked — preference lasts for this tab only */
  }
};

/** Per-viewer UI preferences (theme, language). Stored locally; not account data. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => read('ledgerly.theme', 'light'));
  const [lang, setLangState] = useState<Lang>(() => read('ledgerly.lang', 'en'));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setTheme = useCallback((t: Theme) => { setThemeState(t); write('ledgerly.theme', t); }, []);
  const setLang = useCallback((l: Lang) => { setLangState(l); write('ledgerly.lang', l); }, []);
  const t = useCallback((key: TKey | string, fallback?: string) => translate(lang, key, fallback), [lang]);

  const value = useMemo(() => ({ theme, setTheme, lang, setLang, t }), [theme, setTheme, lang, setLang, t]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider');
  return ctx;
}
