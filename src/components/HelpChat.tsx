import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Loader2, Mail, Phone, Send, UserRound, Headset, CalendarClock } from 'lucide-react';
import { api } from '@/api/client';
import { istDay, istTime } from '../../shared/support';
import { STARTERS } from '../../shared/supportBot';

export interface BotReply { text: string; table?: { columns: string[]; rows: string[][] }; links?: Array<{ label: string; to: string }>; suggestions?: string[]; escalate?: boolean; by: 'bot' | 'ai' }
export type ChatMsg = { role: 'user'; text: string } | ({ role: 'bot' } & BotReply);
export interface SupportContact { phone: string; email: string; days: number[]; start: string; end: string; openNow: boolean; nextSlot: string | null; canBook: boolean }

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (t: string) => istTime(`2026-01-01T${t}:00+05:30`);

/**
 * Help chat: answers from the shop's own data and how-to answers first; when that doesn't solve it, "Talk to a
 * person" shows the support team's phone, email and hours, and a call-back that carries this conversation.
 */
export function HelpChat({ contact, onBook }: { contact: SupportContact | undefined; onBook: (chat: Array<{ role: 'user' | 'bot'; text: string }>) => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: 'bot', by: 'bot', text: 'Hi! I can check stock, a bill, what a customer owes, or show you how to do something. What do you need?', suggestions: STARTERS }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [msgs, human]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    if (/^(that solved it|solved|thanks)/i.test(question)) { setMsgs((m) => [...m, { role: 'user', text: question }, { role: 'bot', by: 'bot', text: 'Glad that helped. Anything else?' }]); return; }
    const next: ChatMsg[] = [...msgs, { role: 'user', text: question }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const history = next.slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.text.slice(0, 1000) }));
      while (history.length && history[0]!.role !== 'user') history.shift();
      const r = await api.post<BotReply>('/shop/support/chat', { messages: history });
      setMsgs((m) => [...m, { role: 'bot', ...r }]);
      if (r.escalate && /person|agent|human|call/i.test(question)) setHuman(true);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', by: 'bot', text: `Sorry, I couldn’t answer just now (${(e as Error).message}). You can talk to our support team below.`, escalate: true }]);
    } finally {
      setBusy(false);
    }
  };
  const transcript = () => msgs.slice(1).map((m) => ({ role: m.role, text: m.role === 'bot' && m.table ? `${m.text}\n${m.table.rows.map((r) => r.join(' · ')).join('\n')}` : m.text }));
  const lastBot = [...msgs].reverse().find((m) => m.role === 'bot') as ({ role: 'bot' } & BotReply) | undefined;

  return (
    <div className="hc">
      <div className="hc-log" aria-live="polite">
        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="hc-row me"><div className="hc-bubble me">{m.text}</div><span className="hc-av me"><UserRound size={14} /></span></div>
        ) : (
          <div key={i} className="hc-row">
            <span className="hc-av"><Bot size={14} /></span>
            <div className="hc-bubble">
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              {m.table && (
                <div className="table-wrap hc-table"><table className="table">
                  <thead><tr>{m.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{m.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className={k ? 'num' : 'strong'}>{c}</td>)}</tr>)}</tbody>
                </table></div>
              )}
              {!!m.links?.length && <div className="hc-links">{m.links.map((l) => <Link key={l.to + l.label} className="btn btn-soft btn-sm" to={l.to}>{l.label} →</Link>)}</div>}
              {m.by === 'ai' && <div className="small muted" style={{ marginTop: 4 }}>Answered by the AI assistant</div>}
            </div>
          </div>
        ))}
        {busy && <div className="hc-row"><span className="hc-av"><Bot size={14} /></span><div className="hc-bubble"><Loader2 size={14} className="spin" /> Looking that up…</div></div>}
        {human && <PersonPanel contact={contact} onBook={() => onBook(transcript())} />}
        <div ref={end} />
      </div>
      {lastBot?.suggestions && !busy && <div className="hc-chips">{lastBot.suggestions.map((s) => <button key={s} type="button" className="filter-chip" onClick={() => (/talk to a person/i.test(s) ? (setMsgs((m) => [...m, { role: 'user', text: s }]), setHuman(true)) : ask(s))}>{s}</button>)}</div>}
      <form className="hc-input" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about stock, a bill, a customer, or how to do something…" aria-label="Ask the help bot" maxLength={1000} />
        <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label="Send"><Send size={15} /></button>
      </form>
      <div className="hc-foot">
        <span className="small muted">Not solved?</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHuman(true); setMsgs((m) => (m[m.length - 1]?.role === 'user' && m[m.length - 1]!.text === 'Talk to a person' ? m : [...m, { role: 'user', text: 'Talk to a person' }])); }}>
          <Headset size={14} /> Talk to a person
        </button>
      </div>
    </div>
  );
}

/** The support team: open now or not, call / email, and a call-back with this chat attached. */
function PersonPanel({ contact, onBook }: { contact: SupportContact | undefined; onBook: () => void }) {
  if (!contact) return null;
  const tel = contact.phone.replace(/[^\d+]/g, '');
  const hours = `${contact.days.map((d) => DAYS[d]).join(', ')} · ${hhmm(contact.start)} – ${hhmm(contact.end)}`;
  return (
    <div className="hc-person" role="region" aria-label="Talk to our support team">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <strong><Headset size={15} style={{ verticalAlign: -2 }} /> Our support team</strong>
        <span className={`badge ${contact.openNow ? 'badge-green' : 'badge-gray'}`}>{contact.openNow ? 'Open now' : 'Closed now'}</span>
      </div>
      <div className="small muted">{hours} (India time)</div>
      <div className="hc-person-actions">
        {tel && contact.openNow && <a className="btn btn-primary btn-sm" href={`tel:${tel}`}><Phone size={14} /> Call now · {contact.phone}</a>}
        {tel && !contact.openNow && <span className="small">Phone: {contact.phone} (during hours)</span>}
        {contact.email && <a className="btn btn-secondary btn-sm" href={`mailto:${contact.email}`}><Mail size={14} /> {contact.email}</a>}
        {contact.canBook ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBook}><CalendarClock size={14} /> Book a call-back{contact.nextSlot ? ` · next free ${istDay(contact.nextSlot)}, ${istTime(contact.nextSlot)}` : ''}</button>
        ) : <span className="small muted">Only the owner can book a call-back; ask them, or call us.</span>}
      </div>
      {contact.canBook && <div className="small muted">This chat goes with the call-back, so you won’t have to explain again.</div>}
    </div>
  );
}
