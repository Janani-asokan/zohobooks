import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Headset, Loader2, PhoneCall, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, useOrg } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { Field, PageHeader } from '@/components/ui';
import { SUPPORT_TOPICS, istDay, istTime, topicLabel, type SlotDay, type SupportSettings } from '../../../shared/support';

interface Callback { id: string; contactName: string; phone: string; topic: string; message: string; slotStart: string; status: 'scheduled' | 'completed' | 'missed' | 'cancelled'; staffNotes: string; assignedTo?: string | null }
const STATUS: Record<Callback['status'], { label: string; cls: string }> = {
  scheduled: { label: 'Booked', cls: 'badge-blue' }, completed: { label: 'Done', cls: 'badge-green' },
  missed: { label: 'Missed', cls: 'badge-amber' }, cancelled: { label: 'Cancelled', cls: 'badge-gray' },
};
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hours = (s: SupportSettings) => `${s.days.map((d) => DAYS[d]).join(', ')} · ${istTime(`2026-01-01T${s.start}:00+05:30`)} – ${istTime(`2026-01-01T${s.end}:00+05:30`)}`;

/** Customer support: the shop owner books a call-back in a slot the system offers, and sees what happened to it. */
export default function Support() {
  const me = useShopUser();
  const org = useOrg().data;
  const slots = useQuery({ queryKey: ['supportSlots'], queryFn: () => api.get<{ settings: SupportSettings; days: SlotDay[] }>('/shop/support/slots') });
  const list = useQuery({ queryKey: ['supportCallbacks'], queryFn: () => api.get<Callback[]>('/shop/support/callbacks') });
  const upcoming = (list.data ?? []).find((c) => c.status === 'scheduled' && new Date(c.slotStart) > new Date());
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [f, setF] = useState({ topic: 'billing', message: '', contactName: '', phone: '' });
  const contactName = f.contactName || me.user.name;
  const phone = f.phone || org?.phone || '';
  const days = slots.data?.days ?? [];
  const shownDay = useMemo(() => days.find((d) => d.date === day) ?? days[0], [days, day]);
  const book = useMut((b: object) => api.post<Callback>('/shop/support/callbacks', b), [['supportCallbacks'], ['supportSlots']],
    { success: (c) => `Call-back booked for ${istDay(c.slotStart)}, ${istTime(c.slotStart)}` });
  const cancel = useMut((id: string) => api.post(`/shop/support/callbacks/${id}/cancel`), [['supportCallbacks'], ['supportSlots']], { success: 'Call-back cancelled' });
  const phoneOk = phone.replace(/\D/g, '').length >= 10;

  return (
    <div className="page">
      <PageHeader title="Customer support" icon={Headset} subtitle="Book a call-back: our support team calls you at the time you choose." />
      <div className="support-grid">
        <section className="card card-body">
          {upcoming ? (
            <div className="support-booked" role="status">
              <span className="support-booked-icon"><CalendarClock size={22} /></span>
              <div style={{ flex: 1 }}>
                <strong>Your call-back is booked</strong>
                <div className="support-when">{istDay(upcoming.slotStart)}, {istTime(upcoming.slotStart)}</div>
                <div className="small muted">We'll call {upcoming.contactName} on {upcoming.phone} about {topicLabel(upcoming.topic).toLowerCase()}.</div>
              </div>
              <button className="btn btn-secondary btn-sm" disabled={cancel.isPending} onClick={() => window.confirm('Cancel this call-back?') && cancel.mutate(upcoming.id)}><XCircle size={14} /> Cancel</button>
            </div>
          ) : (
            <>
              <h3 style={{ margin: '0 0 4px' }}><PhoneCall size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Book a call-back</h3>
              {slots.data && <p className="small muted" style={{ margin: '0 0 14px' }}>Support hours (India time): {hours(slots.data.settings)}. Pick a free slot.</p>}
              {slots.isLoading ? <div className="skeleton" style={{ height: 180 }} /> : days.length === 0 ? (
                <p className="small muted">No free slots in the next {slots.data?.settings.bookingDays ?? 14} days. Please check again later.</p>
              ) : (
                <>
                  <div className="field"><label>Day</label>
                    <div className="support-days" role="radiogroup" aria-label="Day">
                      {days.map((d) => (
                        <button key={d.date} type="button" role="radio" aria-checked={shownDay?.date === d.date} className={`support-chip ${shownDay?.date === d.date ? 'on' : ''}`}
                          onClick={() => { setDay(d.date); setSlot(''); }}>
                          {istDay(`${d.date}T12:00:00+05:30`)}<span>{d.slots.length} free</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 12 }}><label>Time</label>
                    <div className="support-times" role="radiogroup" aria-label="Time">
                      {shownDay?.slots.map((s) => (
                        <button key={s.start} type="button" role="radio" aria-checked={slot === s.start} className={`support-chip ${slot === s.start ? 'on' : ''}`} onClick={() => setSlot(s.start)}>
                          {istTime(s.start)}{s.left === 1 && <span>last place</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-grid" style={{ marginTop: 14 }}>
                    <Field label="What is it about?">
                      <select className="select" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
                        {SUPPORT_TOPICS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Who should we ask for?">
                      <input className="input" value={contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={120} />
                    </Field>
                    <Field label="Phone number to call" error={phone && !phoneOk ? 'Enter a 10-digit number' : ''}>
                      <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98765 43210" />
                    </Field>
                    <Field label="Tell us a little (optional)" className="span-all">
                      <textarea className="textarea" rows={3} maxLength={1000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="e.g. Labels print sideways on the TVS printer" />
                    </Field>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!slot || !phoneOk || contactName.trim().length < 2 || book.isPending}
                    onClick={() => book.mutate({ slotStart: slot, topic: f.topic, message: f.message, contactName: contactName.trim(), phone })}>
                    {book.isPending ? <Loader2 size={15} className="spin" /> : <CalendarClock size={15} />}
                    {slot ? ` Book ${istDay(slot)}, ${istTime(slot)}` : ' Pick a time'}
                  </button>
                </>
              )}
            </>
          )}
        </section>

        <aside className="card card-body">
          <h3 style={{ margin: '0 0 10px' }}><Headset size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Your call-backs</h3>
          {(list.data ?? []).length === 0 ? <p className="small muted">None yet.</p> : (
            <ul className="support-list">
              {list.data!.map((c) => (
                <li key={c.id}>
                  <div className="row between"><strong>{istDay(c.slotStart)}, {istTime(c.slotStart)}</strong><span className={`badge ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span></div>
                  <div className="small muted">{topicLabel(c.topic)}{c.assignedTo ? ` · ${c.assignedTo}` : ''}</div>
                  {c.staffNotes && <div className="small support-notes"><CheckCircle2 size={13} /> {c.staffNotes}</div>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
