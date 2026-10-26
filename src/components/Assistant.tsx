import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mic, MicOff, RotateCcw, SendHorizontal, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { usePrefs } from '@/context/PrefsContext';
import { api } from '@/api/client';

type Turn = { role: 'user' | 'assistant'; content: string; error?: boolean };
const KEY = 'c360.assistant';
const SUGGESTIONS = [
  'How are sales this month compared to last month?',
  'Who owes me money? Show overdue first.',
  'Which items are low on stock?',
  'What are my top 5 selling items this year?',
];

const useAiStatusQuery = () => useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/shop/ai/status'), staleTime: 10 * 60_000 });
// Voice: speech-to-text (Chrome, Edge, Safari) and read-aloud answers, in the app's language.
const Recog = (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) as any;
const VOICE_LANG: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };
/** Markdown → something pleasant to hear: no symbols, tables read row by row. */
const speakable = (md: string) => md.replace(/\|/g, ', ').replace(/[*#`>_-]{1,3}/g, ' ').replace(/₹/g, 'rupees ').replace(/\s+/g, ' ').trim();
function speak(text: string, lang: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text).slice(0, 1200));
  u.lang = lang;
  const v = window.speechSynthesis.getVoices().find((x) => x.lang === lang) ?? window.speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}

export const useAiEnabled = () => useAiStatusQuery().data?.enabled ?? false;
/** undefined while the server hasn't answered yet. */
export const useAiStatus = () => useAiStatusQuery().data?.enabled;

/** **bold** and `code` inside a line. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>);
}

/** The small subset of Markdown the assistant writes: paragraphs, bullet/numbered lists, tables, headings. */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]!)) rows.push(lines[i]!.trim().slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        <div key={i} className="ai-table"><table className="table">
          {head && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>}
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={/^[₹\d,.\s-]+$/.test(c) ? 'num' : ''}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      i--;
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={i}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</List>);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(<p key={i} className="ai-h">{inline(l.replace(/^#+\s/, ''))}</p>);
    } else if (l.trim()) {
      out.push(<p key={i}>{inline(l)}</p>);
    }
  }
  return <>{out}</>;
}

/** Opens the Ask AI panel from anywhere (e.g. the dashboard banner). */
export const openAssistant = () => window.dispatchEvent(new Event('c360:ask-ai'));

export function AssistantButton() {
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('c360:ask-ai', show);
    return () => window.removeEventListener('c360:ask-ai', show);
  }, []);
  if (!enabled) return null;
  return (
    <>
      <button className="ai-btn" onClick={() => setOpen(true)} aria-label="Ask AI" title="Ask AI about your business">
        <Sparkles size={16} /><span className="desktop-only">Ask AI</span>
      </button>
      {/* Portal: the top bar's backdrop filter would otherwise trap the fixed panel inside it. */}
      {open && createPortal(<AssistantPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; } });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-20))); } catch { /* private mode */ } }, [turns]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { lang } = usePrefs();
  const vlang = VOICE_LANG[lang] ?? 'en-IN';
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(() => { try { return localStorage.getItem('c360.ai.speak') === '1'; } catch { return false; } });
  const rec = useRef<any>(null);
  useEffect(() => () => { rec.current?.stop(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);
  const toggleVoiceOut = () => { const v = !voiceOut; setVoiceOut(v); try { localStorage.setItem('c360.ai.speak', v ? '1' : '0'); } catch { /* private mode */ } if (!v && 'speechSynthesis' in window) window.speechSynthesis.cancel(); };
  const listen = () => {
    if (!Recog) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new Recog();
    r.lang = vlang; r.interimResults = true; r.continuous = false;
    let said = '';
    r.onresult = (e: any) => { said = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(' '); setDraft(said); };
    r.onend = () => { setListening(false); if (said.trim()) void ask(said, true); };
    rec.current = r; setListening(true); r.start();
  };
  const ask = async (q: string, spoken = false) => {
    const text = q.trim();
    if (!text || busy) return;
    const next = [...turns.filter((t) => !t.error), { role: 'user' as const, content: text }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const r = await api.post<{ answer: string }>('/shop/ai/ask', { messages: next.slice(-12).map(({ role, content }) => ({ role, content })) });
      setTurns([...next, { role: 'assistant', content: r.answer }]);
      if (voiceOut || spoken) speak(r.answer, vlang);
    } catch (e) {
      setTurns([...next, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <div className="ai-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ai-panel" role="dialog" aria-modal="true" aria-label="Ask AI">
        <header className="ai-head">
          <span className="ai-badge"><Sparkles size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ai-title">Ask AI</div>
            <div className="small muted">Answers from your live sales, dues and stock</div>
          </div>
          {'speechSynthesis' in window && <button className={`icon-btn ${voiceOut ? 'on' : ''}`} onClick={toggleVoiceOut} aria-label={voiceOut ? 'Stop reading answers aloud' : 'Read answers aloud'} title={voiceOut ? 'Reading answers aloud' : 'Read answers aloud'}>{voiceOut ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>}
          {turns.length > 0 && <button className="icon-btn" onClick={() => setTurns([])} aria-label="New chat" title="New chat"><RotateCcw size={16} /></button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="ai-body">
          {turns.length === 0 && (
            <div className="ai-empty">
              <div className="ai-hello"><Sparkles size={22} /></div>
              <p><strong>Ask anything about your business.</strong><br />Type, or tap the mic and just say it. I look up your invoices, payments, customers and stock. I can’t change anything.</p>
              <div className="ai-chips">{SUGGESTIONS.map((s) => <button key={s} className="ai-chip" onClick={() => ask(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`ai-msg ${t.role}${t.error ? ' error' : ''}`}>
              {t.role === 'assistant' ? <Markdown text={t.content} /> : t.content}
            </div>
          ))}
          {busy && <div className="ai-msg assistant ai-typing"><Loader2 size={15} className="spin" /> Looking at your data…</div>}
          <div ref={end} />
        </div>
        <form className="ai-input" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
          <textarea ref={input} rows={1} value={draft} maxLength={1000} placeholder="Ask about sales, dues or stock…"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
          {Recog && <button type="button" className={`icon-btn qb-mic ${listening ? 'on' : ''}`} onClick={listen} aria-label={listening ? 'Stop listening' : 'Ask by voice'} title="Ask by voice">{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>}
          <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()} aria-label="Send"><SendHorizontal size={16} /></button>
        </form>
        {listening && <div className="small qb-listening" style={{ padding: '0 16px' }}><span className="qb-dot" /> Listening… ask your question, then pause. The answer is read aloud.</div>}
        <div className="ai-foot small muted">AI can make mistakes. Check important numbers in Reports.</div>
      </aside>
    </div>
  );
}
