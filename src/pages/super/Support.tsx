import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Headset, Phone, Settings2, UserCheck, XCircle, AlertTriangle, MessageCircle, Send, Bot, UserRound } from 'lucide-react';
import { ApiError } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { Badge, EmptyState, Field, Modal, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { LIVE, istDay, istTime, topicLabel, type SlotDay, type SupportSettings } from '../../../shared/support';

type Status = 'scheduled' | 'completed' | 'missed' | 'cancelled';
interface Cb {
  id: string; shopId: string; contactName: string; phone: string; topic: string; message: string; slotStart: string; status: Status; staffNotes: string; assignedTo: string | null;
  /** The help chat it was booked from, if any. */
  chat?: Array<{ role: 'user' | 'bot'; text: string }>; source?: 'form' | 'chat';
  shop: { name: string; ownerName: string; email: string; phone: string; city: string; planId: string; licenseEnd: string | null; active: boolean };
}
interface Summary {
  shop: { id: string; name: string; ownerName: string; email: string; phone: string; city: string; plan: string; licenseEnd: string | null; active: boolean; createdAt: string };
  users: Array<{ name: string; email: string; role: string; active: boolean; lastLoginAt: string | null }>;
  features: Array<{ key: string; level: string }>;
  usage: { invoices: number; invoicesThisMonth: number; salesThisMonth: number; lastInvoice: string | null; items: number; customers: number };
  history: Cb[];
}
const TONE: Record<Status, string> = { scheduled: 'blue', completed: 'green', missed: 'amber', cancelled: 'gray' };
const LABEL: Record<Status, string> = { scheduled: 'Booked', completed: 'Done', missed: 'Missed', cancelled: 'Cancelled' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VIEWS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']] as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Customer care console: staff see every shop's call-back, check the shop's account, call, and record what happened. */
export default function SuperSupport() {
  const [view, setView] = useState<(typeof VIEWS)[number][0] | 'live'>('upcoming');
  // Polled while the console is open: keeps this agent "online" for live chat and shows waiting chats on every tab.
  const live = useQuery({ queryKey: ['platform', 'support', 'live'], queryFn: () => api.get<LiveList>('/platform/support/live'), refetchInterval: 5000, refetchIntervalInBackground: true });
  const waiting = live.data?.waiting ?? 0;
  useEffect(() => { const t = document.title.replace(/^\(\d+\) /, ''); document.title = waiting ? `(${waiting}) ${t}` : t; }, [waiting]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const list = useQuery({ queryKey: ['platform', 'support', 'callbacks', view], queryFn: () => api.get<{ callbacks: Cb[]; counts: { upcoming: number; overdue: number; today: number } }>(`/platform/support/callbacks?view=${view}`), refetchInterval: 60_000, enabled: view !== 'live' });
  const open = list.data?.callbacks?.find((c) => c.id === openId) ?? null;
  const c = list.data?.counts;

  return (
    <div className="page">
      <PageHeader title="Customer care" icon={Headset} subtitle="Live chats from shops, and the call-backs they booked. Keep this page open in support hours: shops can only start a chat while an agent is online here."
        actions={<button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Support hours</button>} />
      <div className="tabs">
        <button className={view === 'live' ? 'active' : ''} onClick={() => setView('live')}>
          <MessageCircle size={15} /> Live chats {waiting > 0 ? <span className="badge badge-red">{waiting} waiting</span> : <span className="count">{live.data?.chats.filter((x) => x.status === 'active').length ?? 0}</span>}
        </button>
        {VIEWS.map(([k, l]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {l}{k === 'today' && c ? ` (${c.today})` : k === 'upcoming' && c ? ` (${c.upcoming})` : ''}
          </button>
        ))}
      </div>
      {view === 'live' ? <LiveConsole data={live.data} /> : <>
      {!!c?.overdue && <div className="support-alert"><AlertTriangle size={15} /> {c.overdue} call-back{c.overdue > 1 ? 's are' : ' is'} past the booked time and not yet closed.</div>}

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When (IST)</th><th>Shop</th><th>Contact</th><th>Topic</th><th>Staff</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(list.data?.callbacks ?? []).map((cb) => {
              const late = cb.status === 'scheduled' && new Date(cb.slotStart) < new Date();
              return (
                <tr key={cb.id} className="clickable" onClick={() => setOpenId(cb.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}><strong>{istTime(cb.slotStart)}</strong> <span className="muted">{istDay(cb.slotStart)}</span></td>
                  <td className="strong">{cb.shop.name}<div className="small muted">{cb.shop.city || cb.shop.planId}</div></td>
                  <td>{cb.contactName}<div className="small"><a href={`tel:${cb.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{cb.phone}</a></div></td>
                  <td>{topicLabel(cb.topic)}</td>
                  <td className="muted">{cb.assignedTo ?? '—'}</td>
                  <td><Badge tone={late ? 'red' : TONE[cb.status]}>{late ? 'Overdue' : LABEL[cb.status]}</Badge></td>
                  <td><button className="btn btn-secondary btn-sm">Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data?.callbacks.length === 0 && <EmptyState icon={Headset} title="No call-backs here" text="When a shop books a call-back it shows up in this list." />}
      </div>

      </>}
      {open && <CallbackPanel cb={open} onClose={() => setOpenId(null)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function CallbackPanel({ cb, onClose }: { cb: Cb; onClose: () => void }) {
  const sum = useQuery({ queryKey: ['platform', 'support', 'shop', cb.shopId], queryFn: () => api.get<Summary>(`/platform/support/shops/${cb.shopId}`) });
  const [notes, setNotes] = useState(cb.staffNotes);
  const [moving, setMoving] = useState(false);
  const slots = useQuery({ queryKey: ['platform', 'support', 'slots'], queryFn: () => api.get<{ days: SlotDay[] }>('/platform/support/slots'), enabled: moving });
  const patch = useMut((b: object) => api.patch<Cb>(`/platform/support/callbacks/${cb.id}`, b), [['platform', 'support']], { success: 'Call-back updated' });
  const done = (status: Status) => patch.mutate({ status, staffNotes: notes }, { onSuccess: onClose });
  const s = sum.data;
  const tel = cb.phone.replace(/[^\d+]/g, '');

  return (
    <Modal open title={`${cb.shop.name} · ${istDay(cb.slotStart)}, ${istTime(cb.slotStart)}`} onClose={onClose} size="lg">
      <div className="support-console">
        <div>
          <div className="support-callcard">
            <div>
              <div className="small muted">Call</div>
              <strong>{cb.contactName}</strong>
              <div><a className="support-tel" href={`tel:${tel}`}><Phone size={15} /> {cb.phone}</a></div>
            </div>
            <Badge tone={TONE[cb.status]}>{LABEL[cb.status]}</Badge>
          </div>
          <p className="small" style={{ margin: '10px 0 4px' }}><strong>{topicLabel(cb.topic)}</strong></p>
          <p className="small muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{cb.message || 'No message.'}</p>
          {!!cb.chat?.length && (
            <details className="support-chatlog" open>
              <summary className="small strong">Help chat before booking ({cb.chat.length} messages)</summary>
              <ul>{cb.chat.map((m, i) => <li key={i} className={m.role}><span>{m.role === 'user' ? 'Shop' : 'Bot'}</span><div>{m.text}</div></li>)}</ul>
            </details>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>Taken by: {cb.assignedTo ?? 'nobody yet'}</p>

          <Field label="Call notes (the shop sees these)">
            <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What was the problem, what did you do?" />
          </Field>
          <div className="support-actions">
            {!cb.assignedTo && <button className="btn btn-secondary btn-sm" disabled={patch.isPending} onClick={() => patch.mutate({ assignToMe: true })}><UserCheck size={14} /> Take this call</button>}
            <button className="btn btn-primary btn-sm" disabled={patch.isPending} onClick={() => done('completed')}><CheckCircle2 size={14} /> Done</button>
            <button className="btn btn-secondary btn-sm" disabled={patch.isPending} onClick={() => done('missed')}>No answer</button>
            <button className="btn btn-secondary btn-sm" disabled={patch.isPending} onClick={() => setMoving(!moving)}><CalendarClock size={14} /> Move</button>
            {cb.status === 'scheduled' && <button className="btn btn-ghost btn-sm" disabled={patch.isPending} onClick={() => window.confirm('Cancel this call-back?') && done('cancelled')}><XCircle size={14} /> Cancel</button>}
            {notes !== cb.staffNotes && <button className="btn btn-ghost btn-sm" disabled={patch.isPending} onClick={() => patch.mutate({ staffNotes: notes })}>Save notes</button>}
          </div>
          {moving && (
            <div className="support-times" style={{ marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
              {(slots.data?.days ?? []).flatMap((d) => d.slots).slice(0, 40).map((sl) => (
                <button key={sl.start} type="button" className="support-chip" disabled={patch.isPending} onClick={() => patch.mutate({ slotStart: sl.start, staffNotes: notes }, { onSuccess: onClose })}>
                  {istDay(sl.start)}<span>{istTime(sl.start)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="support-shop">
          <h4>Shop dashboard</h4>
          {!s ? <div className="skeleton" style={{ height: 220 }} /> : (
            <>
              <dl className="support-dl">
                <dt>Owner</dt><dd>{s.shop.ownerName} · {s.shop.phone || '—'}</dd>
                <dt>Email</dt><dd>{s.shop.email}</dd>
                <dt>Plan</dt><dd>{s.shop.plan} {s.shop.active ? '' : <Badge tone="red">Suspended</Badge>}</dd>
                <dt>Licence till</dt><dd>{when(s.shop.licenseEnd)}</dd>
                <dt>Joined</dt><dd>{when(s.shop.createdAt)}</dd>
              </dl>
              <div className="support-stats">
                <div><b>{s.usage.invoicesThisMonth}</b><span>bills this month</span></div>
                <div><b>{money(s.usage.salesThisMonth)}</b><span>sales this month</span></div>
                <div><b>{s.usage.items}</b><span>items</span></div>
                <div><b>{s.usage.customers}</b><span>customers</span></div>
              </div>
              <p className="small muted">Last bill: {when(s.usage.lastInvoice)} · {s.usage.invoices} bills in total</p>
              <h4>Users</h4>
              <ul className="support-list">
                {s.users.map((u) => <li key={u.email} className="small"><strong>{u.name}</strong> · {u.role}{u.active ? '' : ' (off)'}<div className="muted">Last sign-in: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}</div></li>)}
              </ul>
              {s.features.length > 0 && <p className="small muted">Add-ons: {s.features.map((f) => f.key).join(', ')}</p>}
              {s.history.length > 1 && (
                <>
                  <h4>Earlier call-backs</h4>
                  <ul className="support-list">
                    {s.history.filter((h) => h.id !== cb.id).map((h) => <li key={h.id} className="small"><strong>{istDay(h.slotStart)}</strong> · {topicLabel(h.topic)} · {LABEL[h.status]}{h.staffNotes && <div className="muted">{h.staffNotes}</div>}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const cur = useQuery({ queryKey: ['platform', 'support', 'settings'], queryFn: () => api.get<SupportSettings & { phone: string; email: string }>('/platform/support/settings') });
  const [f, setF] = useState<(SupportSettings & { phone: string; email: string }) | null>(null);
  const v = f ?? cur.data;
  const save = useMut((b: SupportSettings & { phone: string; email: string }) => api.put('/platform/support/settings', b), [['platform', 'support'], ['supportSlots']], { success: 'Support hours saved' });
  if (!v) return null;
  const set = (p: Partial<SupportSettings & { phone: string; email: string }>) => setF({ ...v, ...p });
  return (
    <Modal open title="Support hours & call-back slots" onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={save.isPending || v.days.length === 0} onClick={() => save.mutate(v, { onSuccess: onClose })}>Save</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Shops can only book the slots these rules create. Times are India time.</p>
      <Field label="Support days">
        <div className="support-days wrap">
          {DAYS.map((d, i) => { const n = i + 1; const on = v.days.includes(n); return (
            <button key={d} type="button" className={`support-chip ${on ? 'on' : ''}`} onClick={() => set({ days: on ? v.days.filter((x) => x !== n) : [...v.days, n].sort() })}>{d}</button>
          ); })}
        </div>
      </Field>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Opens"><input className="input" type="time" value={v.start} onChange={(e) => set({ start: e.target.value })} /></Field>
        <Field label="Closes"><input className="input" type="time" value={v.end} onChange={(e) => set({ end: e.target.value })} /></Field>
        <Field label="Slot length">
          <select className="select" value={v.slotMinutes} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Field>
        <Field label="Calls per slot" hint="How many staff take calls at once"><input className="input" type="number" min={1} max={50} value={v.capacity} onChange={(e) => set({ capacity: Number(e.target.value) })} /></Field>
        <Field label="Book up to (days ahead)"><input className="input" type="number" min={1} max={60} value={v.bookingDays} onChange={(e) => set({ bookingDays: Number(e.target.value) })} /></Field>
        <Field label="Support phone" hint="Shown in shops’ help chat (“Call now” during hours)"><input className="input" type="tel" value={v.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 44 4000 1234" /></Field>
        <Field label="Support email"><input className="input" type="email" value={v.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder="help@corpus360lite.com" /></Field>
      </div>
    </Modal>
  );
}

/* ======================= Live chats ======================= */

interface LiveChatRow {
  id: string; status: 'waiting' | 'active' | 'closed' | 'missed'; startedBy: string; agentName: string | null; createdAt: string; pickedAt: string | null; closedAt: string | null;
  rating: number | null; shopId: string; shopName: string; shopPhone: string; lastMessage: string | null; unread: number; mine: boolean; botTranscript: Array<{ role: 'user' | 'bot'; text: string }>;
}
interface LiveList { chats: LiveChatRow[]; waiting: number; agentsOnline: string[] }
interface LiveMsg { id: number; sender: 'shop' | 'agent' | 'system'; senderName: string; body: string; at: string }
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };

function LiveConsole({ data }: { data: LiveList | undefined }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = data?.chats ?? [];
  const sel = rows.find((r) => r.id === openId) ?? null;
  return (
    <div className="lc">
      <aside className="card lc-list">
        <div className="small muted" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          Online: {data?.agentsOnline.join(', ') || '—'} · shops can start a chat while someone has this page open in support hours.
        </div>
        {rows.length === 0 ? <EmptyState icon={MessageCircle} title="No chats" text="New chats appear here; the tab title shows how many are waiting." /> : rows.map((r) => (
          <button key={r.id} type="button" className={`lc-item ${openId === r.id ? 'on' : ''}`} onClick={() => setOpenId(r.id)}>
            <div className="row between"><strong>{r.shopName}</strong>
              <span className={`badge ${r.status === 'waiting' ? 'badge-red' : r.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{r.status === 'waiting' ? `Waiting · ${ago(r.createdAt)}` : r.status === 'active' ? (r.mine ? 'You' : r.agentName) : r.status === 'missed' ? 'Missed' : 'Ended'}</span>
            </div>
            <div className="small muted">{r.startedBy}{r.unread && r.status !== 'closed' ? ` · ${r.unread} new` : ''}</div>
            {r.lastMessage && <div className="small lc-last">{r.lastMessage}</div>}
          </button>
        ))}
      </aside>
      <section className="card lc-pane">{sel ? <AgentChat key={sel.id} row={sel} /> : <EmptyState icon={Headset} title="Pick a chat" text="Waiting chats are at the top. Open one to see what the shop asked the help bot, then pick it up." />}</section>
    </div>
  );
}

function AgentChat({ row }: { row: LiveChatRow }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<LiveMsg[]>([]);
  const [status, setStatus] = useState(row.status);
  const [mine, setMine] = useState(row.mine);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const sum = useQuery({ queryKey: ['platform', 'support', 'shop', row.shopId], queryFn: () => api.get<Summary>(`/platform/support/shops/${row.shopId}`) });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get<{ chat: { status: LiveChatRow['status']; mine: boolean }; messages: LiveMsg[] }>(`/platform/support/live/${row.id}?after=${last.current}`);
        if (stop) return;
        setStatus(r.chat.status); setMine(r.chat.mine);
        if (r.messages.length) { last.current = r.messages[r.messages.length - 1]!.id; setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]); }
      } catch { /* next tick */ }
    };
    void tick();
    const t = setInterval(tick, LIVE.pollSeconds * 1000);
    return () => { stop = true; clearInterval(t); };
  }, [row.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs.length]);
  const act = async (path: string, body: object = {}) => { try { return await api.post<any>(`/platform/support/live/${row.id}/${path}`, body); } catch (e) { toast('error', (e as ApiError).message); return null; } };
  const send = async () => {
    const b = text.trim();
    if (!b) return;
    const m = await act('messages', { body: b });
    if (m) { setText(''); last.current = Math.max(last.current, m.id); setMsgs((x) => [...x, m]); }
  };
  const open = status === 'waiting' || status === 'active';
  const s = sum.data;
  return (
    <div className="lc-chat">
      <div className="lc-head">
        <div><strong>{row.shopName}</strong> <span className="small muted">· {row.startedBy}{row.shopPhone ? ` · ${row.shopPhone}` : ''}</span></div>
        <div className="row" style={{ gap: 8 }}>
          {status === 'waiting' && <button className="btn btn-primary btn-sm" onClick={async () => { if (await act('pick')) { setStatus('active'); setMine(true); } }}><UserCheck size={14} /> Pick up</button>}
          {status === 'active' && !mine && <button className="btn btn-secondary btn-sm" onClick={async () => { if (await act('pick', { takeOver: true })) setMine(true); }}>Take over</button>}
          {open && <button className="btn btn-ghost btn-sm" onClick={async () => { if (await act('close')) setStatus('closed'); }}><XCircle size={14} /> End chat</button>}
        </div>
      </div>
      {s && <div className="small muted lc-shop">{s.shop.plan} plan · licence till {when(s.shop.licenseEnd)} · {s.usage.invoicesThisMonth} bills this month · {s.users.length} users · last bill {when(s.usage.lastInvoice)}</div>}
      {row.botTranscript.length > 0 && (
        <details className="support-chatlog">
          <summary className="small strong">What they asked the help bot ({row.botTranscript.length})</summary>
          <ul>{row.botTranscript.map((m, i) => <li key={i} className={m.role}><span>{m.role === 'user' ? 'Shop' : 'Bot'}</span><div>{m.text}</div></li>)}</ul>
        </details>
      )}
      <div className="hc-log lc-log">
        {msgs.map((m) => m.sender === 'system' ? <div key={m.id} className="hc-system">{m.body}</div> : m.sender === 'agent' ? (
          <div key={m.id} className="hc-row me"><div className="hc-bubble me"><div className="small" style={{ opacity: .85 }}>{m.senderName}</div>{m.body}</div><span className="hc-av me"><Headset size={14} /></span></div>
        ) : (
          <div key={m.id} className="hc-row"><span className="hc-av"><UserRound size={14} /></span><div className="hc-bubble"><div className="small strong">{m.senderName}</div><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div></div>
        ))}
        <div ref={end} />
      </div>
      {open ? (
        <form className="hc-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={!mine || status !== 'active'} maxLength={2000}
            placeholder={status === 'waiting' ? 'Pick up the chat to reply' : mine ? 'Type a reply…' : `${row.agentName} is handling this chat`} aria-label="Reply" />
          <button className="btn btn-primary" disabled={!mine || status !== 'active' || !text.trim()} aria-label="Send"><Send size={15} /></button>
        </form>
      ) : <div className="small muted"><Bot size={13} style={{ verticalAlign: -2 }} /> This chat has ended{row.rating ? ` · rated ${row.rating}/5` : ''}.</div>}
    </div>
  );
}
