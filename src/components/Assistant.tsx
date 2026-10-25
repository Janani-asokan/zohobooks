import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RotateCcw, SendHorizontal, Sparkles, X } from 'lucide-react';
import { api } from '@/api/client';

type Turn = { role: 'user' | 'assistant'; content: string; error?: boolean };
const KEY = 'c360.assistant';
const SUGGESTIONS = [
  'How are sales this month compared to last month?',
  'Who owes me money? Show overdue first.',
  'Which items are low on stock?',
  'What are my top 5 selling items this year?',
];

export const useAiEnabled = () =>
  useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/shop/ai/status'), staleTime: 10 * 60_000 }).data?.enabled ?? false;

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

export function AssistantButton() {
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
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

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const next = [...turns.filter((t) => !t.error), { role: 'user' as const, content: text }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const r = await api.post<{ answer: string }>('/shop/ai/ask', { messages: next.slice(-12).map(({ role, content }) => ({ role, content })) });
      setTurns([...next, { role: 'assistant', content: r.answer }]);
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
          {turns.length > 0 && <button className="icon-btn" onClick={() => setTurns([])} aria-label="New chat" title="New chat"><RotateCcw size={16} /></button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="ai-body">
          {turns.length === 0 && (
            <div className="ai-empty">
              <div className="ai-hello"><Sparkles size={22} /></div>
              <p><strong>Ask anything about your business.</strong><br />I look up your invoices, payments, customers and stock. I can’t change anything.</p>
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
          <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()} aria-label="Send"><SendHorizontal size={16} /></button>
        </form>
        <div className="ai-foot small muted">AI can make mistakes. Check important numbers in Reports.</div>
      </aside>
    </div>
  );
}
