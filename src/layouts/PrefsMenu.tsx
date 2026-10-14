import { Monitor, Moon, Sun } from 'lucide-react';
import { usePrefs, type Theme } from '@/context/PrefsContext';
import { LANGS } from '@/i18n';

/** Theme + language controls shown inside the profile dropdown. */
export function PrefsMenu() {
  const { theme, setTheme, lang, setLang, t } = usePrefs();
  const opts: Array<[Theme, typeof Sun, string]> = [
    ['light', Sun, t('theme.light')],
    ['dark', Moon, t('theme.dark')],
    ['system', Monitor, t('theme.system')],
  ];
  return (
    <div style={{ padding: '6px 10px 8px' }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('shell.theme')}</div>
      <div className="segmented" style={{ width: '100%' }}>
        {opts.map(([v, I, l]) => (
          <button key={v} type="button" className={theme === v ? 'active' : ''} onClick={() => setTheme(v)} style={{ flex: 1, justifyContent: 'center', padding: '6px 8px' }} aria-pressed={theme === v}>
            <I size={14} /> {l}
          </button>
        ))}
      </div>
      <div className="small muted" style={{ margin: '10px 0 6px' }}>{t('shell.language')}</div>
      <select className="select" style={{ height: 34 }} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{l.native}{l.id !== 'en' ? ` — ${l.label}` : ''}</option>)}
      </select>
    </div>
  );
}
