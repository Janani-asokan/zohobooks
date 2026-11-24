import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Headset, Phone, Settings2, UserCheck, XCircle, AlertTriangle, MessageCircle, Send, Bot, UserRound, Bell, BellOff, Sparkles, Mail } from 'lucide-react';
import { playChime, unlockChime } from '@/lib/chime';
import { useLeadSummary } from '@/components/super/LeadAlert';
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
  // ?view=leads (from the new-leads alert or the lead email) opens that tab.
  const [view, setView] = useState<(typeof VIEWS)[number][0] | 'live' | 'whatsapp' | 'leads'>(() => (new URLSearchParams(window.location.search).get('view') === 'leads' ? 'leads' : 'upcoming'));
  // Polled while the console is open: keeps this agent "online" for live chat and shows waiting chats on every tab.
  const live = useQuery({ queryKey: ['platform', 'support', 'live'], queryFn: () => api.get<LiveList>('/platform/support/live'), refetchInterval: 5000, refetchIntervalInBackground: true });
  const waiting = live.data?.waiting ?? 0;
  useEffect(() => { const t = document.title.replace(/^\(\d+\) /, ''); document.title = waiting ? `(${waiting}) ${t}` : t; }, [waiting]);

  // Sound (and a desktop notification when the tab isn't in view) for a new waiting chat, and a softer sound for a
  // new message in a chat this agent is handling. Browsers allow sound only after a click, so any click unlocks it.
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('corpus.support.sound') !== 'off'; } catch { return true; } });
  useEffect(() => { const on = () => unlockChime(); window.addEventListener('pointerdown', on, { once: true }); return () => window.removeEventListener('pointerdown', on); }, []);
  const seen = useRef<{ waiting: Set<string>; unread: Map<string, number> } | null>(null);
  useEffect(() => {
    const chats = live.data?.chats;
    if (!chats) return;
    const nowWaiting = new Set(chats.filter((x) => x.status === 'waiting').map((x) => x.id));
    const unread = new Map(chats.filter((x) => x.mine && x.status === 'active').map((x) => [x.id, x.unread]));
    const prev = seen.current;
    seen.current = { waiting: nowWaiting, unread };
    if (!prev || !sound) return; // the first load is what was already there: no sound
    const fresh = chats.filter((x) => x.status === 'waiting' && !prev.waiting.has(x.id));
    if (fresh.length) {
      playChime('new');
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('New support chat', { body: `${fresh[0]!.shopName}: ${fresh[0]!.lastMessage ?? 'waiting for an agent'}`, tag: 'support-chat' }); } catch { /* not allowed here */ }
      }
    } else if ([...unread].some(([id, n]) => n > (prev.unread.get(id) ?? 0))) playChime('message');
  }, [live.data, sound]);
  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    try { localStorage.setItem('corpus.support.sound', on ? 'on' : 'off'); } catch { /* private window */ }
    if (on) {
      unlockChime();
      setTimeout(() => playChime('new'), 50); // a test so the agent hears it works
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    }
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const list = useQuery({ queryKey: ['platform', 'support', 'callbacks', view], queryFn: () => api.get<{ callbacks: Cb[]; counts: { upcoming: number; overdue: number; today: number } }>(`/platform/support/callbacks?view=${view}`), refetchInterval: 60_000, enabled: view !== 'live' && view !== 'whatsapp' && view !== 'leads' });
  const leads = useQuery({ queryKey: ['platform', 'support', 'leads', 'new'], queryFn: () => api.get<LeadList>('/platform/support/leads'), refetchInterval: 60_000 });
  const open = list.data?.callbacks?.find((c) => c.id === openId) ?? null;
  const wa = useQuery({ queryKey: ['platform', 'support', 'whatsapp', 'open'], queryFn: () => api.get<WaList>('/platform/support/whatsapp'), refetchInterval: 30_000 });
  const inbox = useQuery({ queryKey: ['platform', 'support', 'wa-inbox', 'open'], queryFn: () => api.get<WaInboxList>('/platform/support/wa'), refetchInterval: 5000, refetchIntervalInBackground: true });
  // A chime when a new WhatsApp message arrives (same sound setting as live chats).
  const unreadBefore = useRef<number | null>(null);
  useEffect(() => {
    const n = inbox.data?.unread;
    if (n === undefined) return;
    if (unreadBefore.current !== null && n > unreadBefore.current && sound) playChime('new');
    unreadBefore.current = n;
  }, [inbox.data?.unread, sound]);
  const c = list.data?.counts;

  return (
    <div className="page">
      <PageHeader title="Customer care" icon={Headset} subtitle="Live chats from shops, and the call-backs they booked. Keep this page open in support hours: shops can only start a chat while an agent is online here."
        actions={<>
          <button className={`btn ${sound ? 'btn-secondary' : 'btn-ghost'}`} onClick={toggleSound} title={sound ? 'A chime plays when a chat arrives. Click to mute.' : 'Muted. Click to hear a chime when a chat arrives.'} aria-pressed={sound}>
            {sound ? <Bell size={15} /> : <BellOff size={15} />} Sound {sound ? 'on' : 'off'}
          </button>
          <button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Hours & contacts</button>
        </>} />
      <div className="tabs">
        <button className={view === 'live' ? 'active' : ''} onClick={() => setView('live')}>
          <MessageCircle size={15} /> Live chats {waiting > 0 ? <span className="badge badge-red">{waiting} waiting</span> : <span className="count">{live.data?.chats.filter((x) => x.status === 'active').length ?? 0}</span>}
        </button>
        <button className={view === 'whatsapp' ? 'active' : ''} onClick={() => setView('whatsapp')}>
          <MessageCircle size={15} /> WhatsApp {inbox.data?.configured
            ? (inbox.data.unread ? <span className="badge badge-red">{inbox.data.unread} new</span> : null)
            : (wa.data?.counts.open ? <span className="badge badge-amber">{wa.data.counts.open} open</span> : null)}
        </button>
        <button className={view === 'leads' ? 'active' : ''} onClick={() => setView('leads')}>
          <Sparkles size={15} /> Sales leads {leads.data?.counts.new ? <span className="badge badge-amber">{leads.data.counts.new} new</span> : null}
        </button>
        {VIEWS.map(([k, l]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {l}{k === 'today' && c ? ` (${c.today})` : k === 'upcoming' && c ? ` (${c.upcoming})` : ''}
          </button>
        ))}
      </div>
      {view === 'live' ? <LiveConsole data={live.data} /> : view === 'whatsapp' ? <WhatsAppTab inbox={inbox.data} /> : view === 'leads' ? <LeadsTab /> : <>
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

type Contacts = { phone: string; email: string; whatsapp: string; salesPhone: string; salesEmail: string; salesWhatsapp: string };
function SettingsModal({ onClose }: { onClose: () => void }) {
  const cur = useQuery({ queryKey: ['platform', 'support', 'settings'], queryFn: () => api.get<SupportSettings & Contacts>('/platform/support/settings') });
  const [f, setF] = useState<(SupportSettings & Contacts) | null>(null);
  const v = f ?? cur.data;
  const save = useMut((b: SupportSettings & Contacts) => api.put('/platform/support/settings', b), [['platform', 'support'], ['supportSlots']], { success: 'Support hours saved' });
  if (!v) return null;
  const set = (p: Partial<SupportSettings & Contacts>) => setF({ ...v, ...p });
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
        <Field label="Support WhatsApp" hint="With country code. Shops’ “WhatsApp us” opens a chat with this number; answer from the WhatsApp Business app."><input className="input" type="tel" value={v.whatsapp ?? ''} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="+91 98400 12345" /></Field>
      </div>
      <h4 style={{ margin: '18px 0 4px' }}>Sales team</h4>
      <p className="small muted" style={{ marginTop: 0 }}>Help on the website, and Help for shops on the trial or whose license ended, leads here. Leave a field empty to use the support contact above.</p>
      <div className="form-grid">
        <Field label="Sales phone"><input className="input" type="tel" value={v.salesPhone ?? ''} onChange={(e) => set({ salesPhone: e.target.value })} placeholder="+91 44 4000 5678" /></Field>
        <Field label="Sales email" hint="New “call me back” requests are emailed here"><input className="input" type="email" value={v.salesEmail ?? ''} onChange={(e) => set({ salesEmail: e.target.value })} placeholder="sales@corpus360lite.com" /></Field>
        <Field label="Sales WhatsApp" hint="With country code"><input className="input" type="tel" value={v.salesWhatsapp ?? ''} onChange={(e) => set({ salesWhatsapp: e.target.value })} placeholder="+91 98400 67890" /></Field>
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

/* ---------- WhatsApp contacts ---------- */

interface WaContact {
  id: string; shopId: string; shop: { name: string; ownerName: string; phone: string; city: string };
  contactName: string; userEmail: string; question: string; chat: Array<{ role: 'user' | 'bot'; text: string }>;
  status: 'open' | 'done'; handledBy: string | null; staffNotes: string; createdAt: string; doneAt: string | null; shopWhatsapp: string;
}
interface WaList { contacts: WaContact[]; counts: { open: number; today: number } }

/** Shops that tapped "WhatsApp us". Their message arrives on the team's WhatsApp; this list says who, and what the bot already tried. */
function WhatsAppList() {
  const [view, setView] = useState<'open' | 'done'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['platform', 'support', 'whatsapp', view], queryFn: () => api.get<WaList>(`/platform/support/whatsapp?view=${view}`), refetchInterval: 30_000 });
  const cur = list.data?.contacts.find((x) => x.id === openId) ?? null;
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>The message itself arrives on your support WhatsApp. Reply there, then mark it handled here so the team knows it’s done.</p>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={view === 'open' ? 'active' : ''} onClick={() => setView('open')}>Open{list.data && view === 'open' ? ` (${list.data.counts.open})` : ''}</button>
        <button className={view === 'done' ? 'active' : ''} onClick={() => setView('done')}>Handled</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When (IST)</th><th>Shop</th><th>Person</th><th>About</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(list.data?.contacts ?? []).map((w) => (
              <tr key={w.id} className="clickable" onClick={() => setOpenId(w.id)}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{istTime(w.createdAt)}</strong> <span className="muted">{istDay(w.createdAt)}</span></td>
                <td className="strong">{w.shop.name}<div className="small muted">{w.shop.city}</div></td>
                <td>{w.contactName}{w.userEmail && <div className="small muted">{w.userEmail}</div>}</td>
                <td className="small" style={{ maxWidth: 320 }}>{w.question || <span className="muted">No question typed</span>}</td>
                <td><Badge tone={w.status === 'open' ? 'amber' : 'green'}>{w.status === 'open' ? 'Open' : `Handled${w.handledBy ? ` · ${w.handledBy}` : ''}`}</Badge></td>
                <td><button className="btn btn-secondary btn-sm">Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.contacts.length === 0 && <EmptyState icon={MessageCircle} title={view === 'open' ? 'No open WhatsApp requests' : 'Nothing handled yet'} text="When a shop taps “WhatsApp us” in Help, it shows up here." />}
      </div>
      {cur && <WhatsAppPanel w={cur} onClose={() => setOpenId(null)} />}
    </>
  );
}

function WhatsAppPanel({ w, onClose }: { w: WaContact; onClose: () => void }) {
  const [notes, setNotes] = useState(w.staffNotes);
  const save = useMut((b: { status?: 'open' | 'done'; staffNotes?: string }) => api.patch(`/platform/support/whatsapp/${w.id}`, b), [['platform', 'support', 'whatsapp']], { success: 'Saved' });
  return (
    <Modal open onClose={onClose} title={`${w.shop.name} · WhatsApp`} subtitle={`${w.contactName} · ${istDay(w.createdAt)}, ${istTime(w.createdAt)}`}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        {w.status === 'open'
          ? <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ status: 'done', staffNotes: notes }, { onSuccess: onClose })}><CheckCircle2 size={15} /> Mark handled</button>
          : <button className="btn btn-secondary" disabled={save.isPending} onClick={() => save.mutate({ status: 'open', staffNotes: notes }, { onSuccess: onClose })}>Reopen</button>}
      </>}>
      <dl className="kv">
        <dt>Shop</dt><dd>{w.shop.name}{w.shop.city ? ` · ${w.shop.city}` : ''}</dd>
        <dt>Owner</dt><dd>{w.shop.ownerName}</dd>
        <dt>Shop phone</dt><dd>{w.shop.phone || '—'}{w.shopWhatsapp && <> · <a href={`https://wa.me/${w.shopWhatsapp}`} target="_blank" rel="noreferrer">Open in WhatsApp</a></>}</dd>
        <dt>Asked</dt><dd>{w.question || '—'}</dd>
      </dl>
      {w.chat.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>What the help bot already tried ({w.chat.length} messages)</summary>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {w.chat.map((m, i) => <div key={i} className="small"><strong>{m.role === 'user' ? w.contactName : 'Bot'}:</strong> {m.text}</div>)}
          </div>
        </details>
      )}
      <Field label="Notes for the team"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was the problem, what did you do?" /></Field>
    </Modal>
  );
}

/* ---------- Sales leads ---------- */

type LeadStatus = 'new' | 'contacted' | 'won' | 'lost';
interface Lead {
  id: string; name: string; phone: string; email: string; business: string; city: string; message: string; source: string; page: string;
  shopId: string | null; shopName: string | null; planId: string | null; status: LeadStatus; staffNotes: string; handledBy: string | null; createdAt: string; whatsapp: string;
}
interface LeadList { leads: Lead[]; counts: { new: number; today: number; won: number } }
const LEAD_TABS: Array<[LeadStatus, string]> = [['new', 'New'], ['contacted', 'Contacted'], ['won', 'Won'], ['lost', 'Lost']];
const LEAD_TONE: Record<LeadStatus, string> = { new: 'amber', contacted: 'blue', won: 'green', lost: 'gray' };
const SOURCE_LABEL: Record<string, string> = { landing: 'Website', login: 'Sign-in page', signup: 'Sign-up page', legal: 'Policy pages', app: 'In the app (trial / unpaid)' };

/** "Talk to sales" requests from visitors and from shops that haven't paid: call them, then record how it went. */
function LeadsTab() {
  const summary = useLeadSummary();
  const [view, setView] = useState<LeadStatus>('new');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['platform', 'support', 'leads', view], queryFn: () => api.get<LeadList>(`/platform/support/leads?view=${view}`), refetchInterval: 60_000 });
  const cur = list.data?.leads.find((x) => x.id === openId) ?? null;
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>People who tapped Help → Talk to sales on the website, and shops on the trial or whose license ended. Call them, then move each lead along.</p>
      {summary.data?.emailIssue ? (
        <div className="notice-bar" role="alert" style={{ background: "#fff7e6", color: "#7a5310", border: "1px solid #f3d9a4" }}><AlertTriangle size={16} /> <span><strong>Lead emails aren’t reaching anyone.</strong> {summary.data.emailIssue} New leads still show here, with a sound and a pop-up while this console is open.</span></div>
      ) : summary.data?.recipients.length ? <p className="small muted">New leads are emailed to {summary.data.recipients.join(', ')}. Leads not marked contacted within 2 hours get a reminder.</p> : null}
      <div className="segmented" style={{ marginBottom: 12 }}>
        {LEAD_TABS.map(([k, l]) => <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{l}{k === 'new' && list.data ? ` (${list.data.counts.new})` : ''}</button>)}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When (IST)</th><th>Who</th><th>Business</th><th>From</th><th>Wants to know</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(list.data?.leads ?? []).map((l) => (
              <tr key={l.id} className="clickable" onClick={() => setOpenId(l.id)}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{istTime(l.createdAt)}</strong> <span className="muted">{istDay(l.createdAt)}</span></td>
                <td className="strong">{l.name}<div className="small muted">{l.phone || l.email}</div></td>
                <td>{l.business || l.shopName || '—'}{l.city && <div className="small muted">{l.city}</div>}</td>
                <td className="small">{SOURCE_LABEL[l.source] ?? l.source}{l.planId && <div className="muted">Plan: {l.planId}</div>}</td>
                <td className="small" style={{ maxWidth: 300 }}>{l.message || <span className="muted">—</span>}</td>
                <td><Badge tone={LEAD_TONE[l.status]}>{LEAD_TABS.find(([k]) => k === l.status)?.[1]}{l.handledBy ? ` · ${l.handledBy}` : ''}</Badge></td>
                <td><button className="btn btn-secondary btn-sm">Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.leads.length === 0 && <EmptyState icon={Sparkles} title={view === 'new' ? 'No new leads' : 'Nothing here yet'} text="When someone taps Help → Talk to sales and leaves their number, it shows up here." />}
      </div>
      {cur && <LeadPanel l={cur} onClose={() => setOpenId(null)} />}
    </>
  );
}

function LeadPanel({ l, onClose }: { l: Lead; onClose: () => void }) {
  const [notes, setNotes] = useState(l.staffNotes);
  const save = useMut((b: { status?: LeadStatus; staffNotes?: string }) => api.patch(`/platform/support/leads/${l.id}`, b), [['platform', 'support', 'leads']], { success: 'Saved' });
  const tel = l.phone.replace(/[^\d+]/g, '');
  const move = (status: LeadStatus) => save.mutate({ status, staffNotes: notes }, { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={l.business || l.shopName || l.name} subtitle={`${l.name} · ${istDay(l.createdAt)}, ${istTime(l.createdAt)}`}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        {l.status !== 'lost' && <button className="btn btn-ghost" disabled={save.isPending} onClick={() => move('lost')}>Not interested</button>}
        {l.status === 'new' && <button className="btn btn-secondary" disabled={save.isPending} onClick={() => move('contacted')}>Contacted</button>}
        {l.status !== 'won' && <button className="btn btn-primary" disabled={save.isPending} onClick={() => move('won')}><CheckCircle2 size={15} /> Won</button>}
      </>}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {tel && <a className="btn btn-primary btn-sm" href={`tel:${tel}`}><Phone size={14} /> Call {l.phone}</a>}
        {l.whatsapp && <a className="btn btn-whatsapp btn-sm" href={`https://wa.me/${l.whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
        {l.email && <a className="btn btn-secondary btn-sm" href={`mailto:${l.email}`}><Mail size={14} /> {l.email}</a>}
      </div>
      <dl className="kv">
        <dt>From</dt><dd>{SOURCE_LABEL[l.source] ?? l.source}{l.page ? ` (${l.page})` : ''}</dd>
        {l.shopName && <><dt>Shop</dt><dd>{l.shopName}{l.planId ? ` · plan ${l.planId}` : ''}</dd></>}
        {l.city && <><dt>City</dt><dd>{l.city}</dd></>}
        <dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{l.message || '—'}</dd>
      </dl>
      <Field label="Notes for the team"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did they ask? Demo booked? Plan quoted?" /></Field>
      {notes !== l.staffNotes && <button className="btn btn-secondary btn-sm" disabled={save.isPending} onClick={() => save.mutate({ staffNotes: notes })}>Save notes</button>}
    </Modal>
  );
}

/* ---------- WhatsApp Business API inbox ---------- */

interface WaConv { id: string; waId: string; profileName: string; shopId: string | null; shopName: string | null; status: 'open' | 'closed'; unread: number; lastInboundAt: string | null; lastMessageAt: string; preview: string; assignedTo: string | null; windowOpen: boolean }
interface WaMsg { id: number; direction: 'in' | 'out'; kind: string; body: string; hasMedia: boolean; mediaMime: string; mediaName: string; status: string; error: string; sentBy: string | null; at: string }
interface WaInboxList { configured: boolean; webhookSecured: boolean; templateSet: boolean; webhookAt: string | null; unread: number; conversations: WaConv[] }

/** The WhatsApp tab: the two-way inbox when the Business API is set up, and the list of "WhatsApp us" taps. */
function WhatsAppTab({ inbox }: { inbox: WaInboxList | undefined }) {
  const [part, setPart] = useState<'inbox' | 'taps'>('inbox');
  if (!inbox?.configured) return <WhatsAppList />;
  return (
    <>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={part === 'inbox' ? 'active' : ''} onClick={() => setPart('inbox')}>Inbox{inbox.unread ? ` (${inbox.unread} new)` : ''}</button>
        <button className={part === 'taps' ? 'active' : ''} onClick={() => setPart('taps')}>“WhatsApp us” taps</button>
      </div>
      {part === 'inbox' ? <WaInbox data={inbox} /> : <WhatsAppList />}
    </>
  );
}

const TICK: Record<string, string> = { sending: '…', sent: '✓', delivered: '✓✓', read: '✓✓ read', failed: 'Not sent' };
const fmtAt = (iso: string) => `${istDay(iso)}, ${istTime(iso)}`;

function WaInbox({ data }: { data: WaInboxList }) {
  const [view, setView] = useState<'open' | 'closed'>('open');
  const closed = useQuery({ queryKey: ['platform', 'support', 'wa-inbox', 'closed'], queryFn: () => api.get<WaInboxList>('/platform/support/wa?view=closed'), enabled: view === 'closed' });
  const list = view === 'open' ? data.conversations : closed.data?.conversations ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const cur = list.find((c) => c.id === openId) ?? null;
  return (
    <>
      {!data.webhookSecured && <div className="support-alert"><AlertTriangle size={15} /> WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN must be set on the server, or Meta’s messages are refused.</div>}
      <p className="small muted" style={{ marginTop: 0 }}>
        Messages to your support WhatsApp number arrive here. {data.webhookAt ? `WhatsApp last reached us ${fmtAt(data.webhookAt)}.` : 'No message from WhatsApp yet: check the webhook in your Meta app.'}
      </p>
      <div className="wa-inbox">
        <div className="card wa-list">
          <div className="segmented" style={{ margin: 10 }}>
            <button className={view === 'open' ? 'active' : ''} onClick={() => setView('open')}>Open</button>
            <button className={view === 'closed' ? 'active' : ''} onClick={() => setView('closed')}>Closed</button>
          </div>
          {list.map((c) => (
            <button key={c.id} className={`wa-row ${c.id === openId ? 'on' : ''}`} onClick={() => setOpenId(c.id)}>
              <span className="row between" style={{ gap: 8 }}>
                <strong>{c.shopName ?? (c.profileName || `+${c.waId}`)}</strong>
                {c.unread > 0 && <span className="badge badge-red">{c.unread}</span>}
              </span>
              <span className="small muted">{c.shopName ? `${c.profileName || ''} +${c.waId}` : 'Shop not matched'} · {fmtAt(c.lastMessageAt)}</span>
              <span className="small wa-preview">{c.preview}</span>
            </button>
          ))}
          {!list.length && <EmptyState icon={MessageCircle} title={view === 'open' ? 'No open conversations' : 'No closed conversations'} text="When a shop messages your support WhatsApp, it shows up here." />}
        </div>
        <div className="card wa-thread">
          {cur ? <WaThread key={cur.id} conv={cur} templateSet={data.templateSet} /> : <EmptyState icon={MessageCircle} title="Pick a conversation" text="Choose one on the left to read and reply." />}
        </div>
      </div>
    </>
  );
}

function WaThread({ conv, templateSet }: { conv: WaConv; templateSet: boolean }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<WaMsg[]>([]);
  const [info, setInfo] = useState<WaConv>(conv);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  const load = async () => {
    try {
      const r = await api.get<{ conversation: WaConv; messages: WaMsg[] }>(`/platform/support/wa/${conv.id}?after=0`);
      setInfo(r.conversation);
      setMsgs(r.messages);
      const newest = r.messages[r.messages.length - 1]?.id ?? 0;
      if (newest !== lastId.current) { lastId.current = newest; requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' })); }
    } catch { /* try again next round */ }
  };
  useEffect(() => { void load(); const t = window.setInterval(load, 5000); return () => window.clearInterval(t); }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await api.post(`/platform/support/wa/${conv.id}/messages`, { body: text.trim() }); setText(''); await load(); }
    catch (e) { toast('error', 'Not sent', e instanceof ApiError ? e.message : 'Try again.'); await load(); }
    finally { setBusy(false); }
  };
  const template = async () => {
    setBusy(true);
    try { await api.post(`/platform/support/wa/${conv.id}/template`); await load(); toast('success', 'Template sent', 'Reply once they answer.'); }
    catch (e) { toast('error', 'Not sent', e instanceof ApiError ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  };
  const setStatus = async (status: 'open' | 'closed') => {
    try { setInfo(await api.patch<WaConv>(`/platform/support/wa/${conv.id}`, { status })); toast('success', status === 'closed' ? 'Conversation closed' : 'Conversation reopened'); }
    catch (e) { toast('error', 'Couldn’t update', e instanceof ApiError ? e.message : 'Try again.'); }
  };
  return (
    <div className="wa-thread-inner">
      <div className="row between wa-thread-head">
        <div style={{ minWidth: 0 }}>
          <strong>{info.shopName ?? (info.profileName || `+${info.waId}`)}</strong>
          <div className="small muted">{info.profileName} · +{info.waId}{info.shopName ? '' : ' · shop not matched'}</div>
        </div>
        {info.status === 'open'
          ? <button className="btn btn-secondary btn-sm" onClick={() => setStatus('closed')}><CheckCircle2 size={14} /> Close</button>
          : <button className="btn btn-secondary btn-sm" onClick={() => setStatus('open')}>Reopen</button>}
      </div>
      <div className="wa-msgs">
        {msgs.map((m) => (
          <div key={m.id} className={`wa-msg ${m.direction}`}>
            {m.hasMedia && (m.mediaMime.startsWith('image/')
              ? <a href={`/api/platform/support/wa/media/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/platform/support/wa/media/${m.id}`} alt={m.body || 'Photo from the shop'} loading="lazy" /></a>
              : <a className="btn btn-secondary btn-sm" href={`/api/platform/support/wa/media/${m.id}`} target="_blank" rel="noreferrer">Open {m.mediaName || m.kind}</a>)}
            {m.body && <div className="wa-body">{m.body}</div>}
            <div className="wa-meta">{m.direction === 'out' && m.sentBy ? `${m.sentBy} · ` : ''}{fmtAt(m.at)}{m.direction === 'out' ? ` · ${TICK[m.status] ?? m.status}` : ''}</div>
            {m.status === 'failed' && m.error && <div className="small" style={{ color: 'var(--red-600)' }}>{m.error}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      {info.windowOpen ? (
        <form className="wa-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply on WhatsApp…" maxLength={4000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}><Send size={15} /> Send</button>
        </form>
      ) : (
        <div className="support-alert" style={{ margin: 12 }}>
          <AlertTriangle size={15} /> More than 24 hours since they last wrote, so WhatsApp only allows an approved template.
          {templateSet ? <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} disabled={busy} onClick={template}>Send template</button> : ' None is set: call them instead.'}
        </div>
      )}
    </div>
  );
}
