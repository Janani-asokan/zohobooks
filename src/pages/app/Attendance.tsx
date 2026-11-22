import '@/styles/attendance.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, Fingerprint, Loader2, LocateFixed, LogIn, LogOut, MapPin, PenLine, RotateCcw, Smartphone, Trash2, UserRound } from 'lucide-react';
import { api, apiHeaders, type ApiError } from '@/api/client';
import { useMut } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, Field, Modal, PageHeader } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { getPosition, type Fix } from '@/lib/geo';
import { API_BASE, IS_APP } from '@/lib/platform';
import { biometricSupported, createDeviceKey, deviceLabel, signWithDevice } from '@/lib/webauthn';
import type { ReportTable } from '@/lib/report';
import { hoursText, type DaySummary } from '../../../shared/attendance';
import { istTime } from '../../../shared/support';

interface MarkRow { id: string; userId: string; userName: string; kind: 'in' | 'out'; day: string; at: string; lat: number | null; lng: number | null; accuracy: number | null; distanceM: number | null; outside: boolean; hasSelfie: boolean; method: 'biometric' | 'selfie' | 'location' | 'manual'; manual: boolean; note: string; deviceLabel: string | null }
interface Me {
  level: 'manual' | 'face' | 'biometric'; needs: { selfie: boolean; biometric: boolean }; canManage: boolean; day: string; state: 'in' | 'out'; marks: MarkRow[];
  branch: { id: string; name: string; located: boolean; radiusM: number } | null;
  devices: Array<{ id: string; credentialId: string; label: string; createdAt: string; lastUsedAt: string | null }>;
}
const METHOD: Record<MarkRow['method'], string> = { biometric: 'Fingerprint', selfie: 'Selfie', location: 'Location', manual: 'By hand' };

/** Staff attendance: check in / out with location, a selfie and the device's fingerprint; the register for managers. */
export default function Attendance() {
  const me = useQuery({ queryKey: ['attendance', 'me'], queryFn: () => api.get<Me>('/shop/attendance/me') });
  const [tab, setTab] = useState<'me' | 'today' | 'month' | 'places'>('me');
  const d = me.data;
  return (
    <div className="page">
      <PageHeader title="Attendance" subtitle={d ? `${d.level === 'biometric' ? 'Fingerprint / face unlock, selfie and location' : d.level === 'face' ? 'Selfie and location' : 'Location'} at every check-in` : ' '} />
      {d?.canManage && (
        <div className="tabs" style={{ marginBottom: 16 }}>
          {([['me', 'My attendance'], ['today', 'Today'], ['month', 'Monthly report'], ['places', 'Shop locations']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      )}
      {!d ? <div className="skeleton" style={{ height: 240 }} /> : tab === 'me' ? <MyAttendance me={d} /> : tab === 'today' ? <Today /> : tab === 'month' ? <Month /> : <Places />}
    </div>
  );
}

/* ---------- My attendance ---------- */

function MyAttendance({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [canBio, setCanBio] = useState<boolean | null>(null);
  useEffect(() => { void biometricSupported().then(setCanBio); }, []);
  const lastIn = [...me.marks].reverse().find((m) => m.kind === 'in');
  const thisDevice = me.devices.length > 0; // a key is per device; the browser picks the one it holds
  return (
    <div className="att-grid">
      <section className="card card-body att-hero">
        <div className={`att-state ${me.state}`}>
          <span className="att-dot" />
          {me.state === 'in' ? <>Checked in since <strong>{istTime(lastIn!.at)}</strong></> : me.marks.length ? <>Checked out at <strong>{istTime(me.marks[me.marks.length - 1]!.at)}</strong></> : <>Not checked in yet today</>}
        </div>
        <button className={`btn btn-lg ${me.state === 'in' ? 'btn-secondary' : 'btn-primary'} att-go`} onClick={() => setOpen(true)}>
          {me.state === 'in' ? <><LogOut size={18} /> Check out</> : <><LogIn size={18} /> Check in</>}
        </button>
        <ul className="att-needs small muted">
          <li><MapPin size={14} /> Your location{me.branch?.located ? ` (within ${me.branch.radiusM} m of ${me.branch.name})` : ''}</li>
          {me.needs.selfie && <li><Camera size={14} /> A selfie</li>}
          {me.needs.biometric && <li><Fingerprint size={14} /> Your fingerprint or face unlock{canBio === false ? ' (not on this device: your selfie is used and the owner can see that)' : ''}</li>}
        </ul>
        {me.marks.length > 0 && (
          <ul className="att-marks">
            {me.marks.map((m) => (
              <li key={m.id}>
                <span className={`att-kind ${m.kind}`}>{m.kind === 'in' ? 'In' : 'Out'}</span>
                <strong>{istTime(m.at)}</strong>
                <span className="small muted">{METHOD[m.method]}{m.distanceM !== null ? ` · ${m.distanceM} m from shop` : ''}</span>
                {m.outside && <Badge tone="amber">Away from shop</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {me.needs.biometric && <Devices me={me} canBio={canBio} hasKey={thisDevice} />}
      {open && <CheckModal me={me} canBio={!!canBio} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Devices({ me, canBio, hasKey }: { me: Me; canBio: boolean | null; hasKey: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const remove = useMut((id: string) => api.del(`/shop/attendance/devices/${id}`), [['attendance']], { success: 'Device removed' });
  const setUp = async () => {
    setBusy(true);
    try {
      const o = await api.post<Parameters<typeof createDeviceKey>[0]>('/shop/attendance/devices/options');
      await api.post('/shop/attendance/devices', { ...(await createDeviceKey(o)), label: deviceLabel() });
      toast('success', 'Fingerprint set up', 'Check in on this device with your fingerprint or face unlock.');
      await qc.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card card-body">
      <h3 style={{ margin: '0 0 6px' }}><Fingerprint size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Fingerprint / face unlock</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Uses this phone’s or laptop’s own screen lock. Your fingerprint never leaves the device; we only get a signed “yes, it’s them”.</p>
      {canBio === false ? (
        <p className="small">{IS_APP ? 'The phone app can’t use fingerprint yet. Open corpus360lite.com in Chrome on this phone to set it up, or check in here with a selfie.' : 'This device or browser has no fingerprint or face unlock. Your selfie will be used instead.'}</p>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={busy || canBio === null} onClick={setUp}>{busy ? <Loader2 size={14} className="spin" /> : <Fingerprint size={14} />} {hasKey ? 'Set up another device' : 'Set up on this device'}</button>
      )}
      {me.devices.length > 0 && (
        <ul className="att-devices">
          {me.devices.map((d) => (
            <li key={d.id}><Smartphone size={15} /> <span>{d.label}<span className="small muted"> · added {new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{d.lastUsedAt ? `, last used ${new Date(d.lastUsedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span></span>
              <button className="icon-btn" aria-label={`Remove ${d.label}`} onClick={() => window.confirm(`Remove ${d.label}? You can set it up again.`) && remove.mutate(d.id)}><Trash2 size={15} /></button></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Check in / out: location starts at once, then the selfie and the fingerprint, as the shop's level needs. */
function CheckModal({ me, canBio, onClose }: { me: Me; canBio: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const kind = me.state === 'in' ? 'out' : 'in';
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoErr, setGeoErr] = useState('');
  const [selfie, setSelfie] = useState('');
  const [busy, setBusy] = useState(false);
  const locate = () => { setGeoErr(''); setFix(null); getPosition(20000, 0).then(setFix).catch((e: Error) => setGeoErr(e.message)); };
  useEffect(locate, []);
  const useBio = me.needs.biometric && canBio && me.devices.length > 0;
  const bioMissing = me.needs.biometric && canBio && me.devices.length === 0;
  const ready = !!fix && (!me.needs.selfie || !!selfie) && !bioMissing;
  const submit = async () => {
    if (!fix) return;
    setBusy(true);
    try {
      let assertion;
      if (useBio) assertion = await signWithDevice(await api.post('/shop/attendance/challenge'));
      await api.post('/shop/attendance/mark', {
        kind, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, selfie: selfie || undefined, assertion,
        noBiometric: me.needs.biometric && !useBio ? 'unsupported' : undefined,
      });
      toast('success', kind === 'in' ? 'Checked in' : 'Checked out', istTime(new Date()));
      await qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    } catch (e) { toast('error', (e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={kind === 'in' ? 'Check in' : 'Check out'} subtitle={me.branch?.name}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
          {busy ? <Loader2 size={15} className="spin" /> : useBio ? <Fingerprint size={15} /> : <CheckCircle2 size={15} />} {useBio ? `Confirm with fingerprint` : kind === 'in' ? 'Check in' : 'Check out'}
        </button>
      </>}>
      <div className="att-step">
        <LocateFixed size={16} />
        {fix ? <span>Location found <span className="muted small">(±{fix.accuracy} m)</span></span> : geoErr ? <span style={{ color: 'var(--danger)' }}>{geoErr} <button className="btn btn-ghost btn-sm" onClick={locate}>Try again</button></span> : <span className="muted"><Loader2 size={14} className="spin" /> Finding your location…</span>}
      </div>
      {me.needs.selfie && <SelfieCam value={selfie} onChange={setSelfie} />}
      {bioMissing && <div className="att-step warn"><AlertTriangle size={16} /> Set up fingerprint on this device first (below the Check in button).</div>}
      {me.needs.biometric && !canBio && <div className="att-step muted small"><Fingerprint size={16} /> This device can’t check your fingerprint, so your selfie is used. The owner sees this.</div>}
    </Modal>
  );
}

/** Front camera preview; Take photo keeps a small JPEG (about 480 px wide). */
function SelfieCam({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (value) return;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t open the camera.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); setOn(true); }
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return; // the preview restarted (e.g. Retake); not a problem
        setErr((e as DOMException).name === 'NotAllowedError' ? 'Camera is blocked. Allow the camera for this app, then try again.' : (e as Error).message || 'Couldn’t open the camera.');
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); setOn(false); };
  }, [value]);
  const take = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const w = 480; const h = Math.round((v.videoHeight / v.videoWidth) * w);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!; ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h);
    setErr('');
    onChange(c.toDataURL('image/jpeg', 0.72));
  };
  return (
    <div className="att-cam">
      {value ? <img src={value} alt="Your selfie" /> : <video ref={video} playsInline muted aria-label="Camera preview" />}
      {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
      {value ? <button className="btn btn-secondary btn-sm" onClick={() => onChange('')}><RotateCcw size={14} /> Retake</button>
        : <button className="btn btn-primary btn-sm" disabled={!on} onClick={take}><Camera size={14} /> Take selfie</button>}
    </div>
  );
}

/* ---------- Register (attendance.manage) ---------- */

type Person = { id: string; name: string; role: string; active: boolean } & DaySummary & { marks: MarkRow[] };
const STATUS: Record<DaySummary['status'], [string, string]> = { in: ['In now', 'green'], present: ['Came', 'blue'], absent: ['Not in', 'gray'] };

/** A selfie from the API (the phone app signs requests with a token, so a plain <img src> can't load it). */
function Selfie({ id, size = 44 }: { id: string; size?: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    fetch(`${API_BASE}/api/shop/attendance/marks/${id}/selfie`, { headers: apiHeaders(false), credentials: IS_APP ? 'omit' : 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className="att-selfie" src={url} alt="Selfie" width={size} height={size} /></a> : <span className="att-selfie empty" style={{ width: size, height: size }}><UserRound size={16} /></span>;
}

function Today() {
  const [day, setDay] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const q = useQuery({ queryKey: ['attendance', 'day', day], queryFn: () => api.get<{ day: string; people: Person[] }>(`/shop/attendance/day?date=${day}`), refetchInterval: 60_000 });
  const [hand, setHand] = useState<Person | null>(null);
  const people = q.data?.people ?? [];
  const counts = { in: people.filter((p) => p.status === 'in').length, came: people.filter((p) => p.status !== 'absent').length };
  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 170 }} aria-label="Day" />
        <span className="small muted">{counts.came} of {people.length} came · {counts.in} in now</span>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Staff</th><th>Status</th><th>In</th><th>Out</th><th className="num">Hours</th><th>Proof</th><th /></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td className="strong">{p.name}<div className="small muted">{p.role}</div></td>
                <td><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>{p.open && p.status !== 'in' && <div className="small" style={{ color: 'var(--amber-700)' }}>No check-out</div>}</td>
                <td>{p.firstIn ? istTime(p.firstIn) : '—'}</td>
                <td>{p.lastOut ? istTime(p.lastOut) : '—'}</td>
                <td className="num">{p.minutes ? hoursText(p.minutes) : '—'}</td>
                <td>
                  <div className="att-proof">
                    {p.marks.filter((m) => m.hasSelfie).slice(-2).map((m) => <Selfie key={m.id} id={m.id} />)}
                    {p.marks.map((m) => (
                      <span key={m.id} className="small" title={m.note}>
                        {m.kind === 'in' ? 'In' : 'Out'} {istTime(m.at)}: {METHOD[m.method]}
                        {m.lat !== null && <> · <a href={`https://maps.google.com/?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer">map</a></>}
                        {m.outside && <Badge tone="amber">{m.distanceM} m away</Badge>}
                        {m.note.startsWith('No fingerprint') && <Badge tone="gray">no fingerprint</Badge>}
                      </span>
                    ))}
                  </div>
                </td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setHand(p)}><PenLine size={14} /> Mark</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && people.length === 0 && <EmptyState icon={UserRound} title="No staff" text="Add staff in Settings → Users to take their attendance." />}
      </div>
      {hand && <ManualMark person={hand} day={day} onClose={() => setHand(null)} />}
    </>
  );
}

function ManualMark({ person, day, onClose }: { person: Person; day: string; onClose: () => void }) {
  const [kind, setKind] = useState<'in' | 'out'>(person.status === 'in' ? 'out' : 'in');
  const [time, setTime] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16));
  const [note, setNote] = useState('');
  const save = useMut((b: object) => api.post('/shop/attendance/manual', b), [['attendance']], { success: 'Marked' });
  return (
    <Modal open onClose={onClose} title={`Mark ${person.name}`} subtitle="Kept as marked by hand, with your name and the reason"
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={note.trim().length < 3 || save.isPending} onClick={() => save.mutate({ userId: person.id, kind, at: `${day}T${time}:00+05:30`, note }, { onSuccess: onClose })}>Save</button></>}>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={kind === 'in' ? 'active' : ''} onClick={() => setKind('in')}>Check in</button>
        <button className={kind === 'out' ? 'active' : ''} onClick={() => setKind('out')}>Check out</button>
      </div>
      <div className="form-grid">
        <Field label="Time (India)"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Why by hand?" required className="span-all"><input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Forgot phone, phone not working…" /></Field>
      </div>
    </Modal>
  );
}

interface MonthPerson { id: string; name: string; role: string; daysPresent: number; minutes: number; days: Record<string, DaySummary>; outsideMarks: number; noBiometricMarks: number; manualMarks: number }

function Month() {
  const [month, setMonth] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ['attendance', 'month', month], queryFn: () => api.get<{ month: string; from: string; to: string; people: MonthPerson[] }>(`/shop/attendance/month?month=${month}`) });
  const days = useMemo(() => {
    if (!q.data) return [] as string[];
    const n = Number(q.data.to.slice(8));
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [q.data, month]);
  const label = new Date(`${month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const table = (): ReportTable | null => q.data ? {
    title: 'Attendance', subtitle: label, filename: `Attendance_${month}`, landscape: true,
    columns: [{ label: 'Staff' }, { label: 'Role' }, { label: 'Days present', align: 'right' }, { label: 'Hours', align: 'right' }, { label: 'Away from shop', align: 'right' }, { label: 'No fingerprint', align: 'right' }, { label: 'Marked by hand', align: 'right' }, { label: 'Days' }],
    rows: q.data.people.map((p) => ({ cells: [p.name, p.role, p.daysPresent, hoursText(p.minutes), p.outsideMarks, p.noBiometricMarks, p.manualMarks, days.filter((d) => p.days[d]).map((d) => Number(d.slice(8))).join(', ')] })),
  } : null;
  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 180 }} aria-label="Month" />
        <ExportMenu table={table} disabled={!q.data} />
      </div>
      <div className="card table-wrap">
        <table className="table att-month">
          <thead><tr><th>Staff</th><th className="num">Days</th><th className="num">Hours</th>{days.map((d) => <th key={d} className="att-day">{Number(d.slice(8))}</th>)}</tr></thead>
          <tbody>
            {(q.data?.people ?? []).map((p) => (
              <tr key={p.id}>
                <td className="strong">{p.name}{(p.outsideMarks + p.noBiometricMarks + p.manualMarks) > 0 && <div className="small muted">{[p.outsideMarks && `${p.outsideMarks} away`, p.noBiometricMarks && `${p.noBiometricMarks} no fingerprint`, p.manualMarks && `${p.manualMarks} by hand`].filter(Boolean).join(' · ')}</div>}</td>
                <td className="num">{p.daysPresent}</td>
                <td className="num">{hoursText(p.minutes)}</td>
                {days.map((d) => { const s = p.days[d]; return <td key={d} className={`att-day ${s ? (s.open && s.status !== 'in' ? 'open' : 'p') : ''}`} title={s ? `${s.firstIn ? istTime(s.firstIn) : ''}–${s.lastOut ? istTime(s.lastOut) : ''} · ${hoursText(s.minutes)}` : 'Not in'}>{s ? (s.open && s.status !== 'in' ? '!' : 'P') : ''}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">P: came that day. !: checked in but never checked out (no hours counted; mark the check-out by hand in Today).</p>
    </>
  );
}

interface Place { id: string; name: string; primary: boolean; lat: number | null; lng: number | null; radiusM: number }

function Places() {
  const q = useQuery({ queryKey: ['attendance', 'branches'], queryFn: () => api.get<Place[]>('/shop/attendance/branches') });
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>Set where each shop or warehouse is. Check-ins further away than the distance you set are flagged “Away from shop”. Stand inside the shop and tap <strong>Use my location</strong>.</p>
      <div className="stack">{(q.data ?? []).map((p) => <PlaceRow key={p.id} p={p} />)}</div>
    </>
  );
}

function PlaceRow({ p }: { p: Place }) {
  const toast = useToast();
  const [f, setF] = useState({ lat: p.lat, lng: p.lng, radiusM: p.radiusM });
  const [busy, setBusy] = useState(false);
  const save = useMut((b: object) => api.put(`/shop/attendance/branches/${p.id}`, b), [['attendance']], { success: `${p.name} saved` });
  const here = async () => { setBusy(true); try { const x = await getPosition(20000, 0); setF({ ...f, lat: x.lat, lng: x.lng }); toast('info', 'Location found', `±${x.accuracy} m. Tap Save to keep it.`); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); } };
  return (
    <section className="card card-body">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong>{p.name}{p.primary && <span className="small muted"> · main</span>}</strong>
        {f.lat !== null ? <a className="small" href={`https://maps.google.com/?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">See on map</a> : <span className="small muted">Not set</span>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={here}>{busy ? <Loader2 size={14} className="spin" /> : <LocateFixed size={14} />} Use my location</button>
        <Field label="Allowed distance (m)"><input className="input" type="number" min={20} max={5000} value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: Number(e.target.value) })} style={{ width: 120 }} /></Field>
        <button className="btn btn-primary btn-sm" disabled={save.isPending || f.radiusM < 20} onClick={() => save.mutate(f)}>Save</button>
        {f.lat !== null && <button className="btn btn-ghost btn-sm" onClick={() => save.mutate({ lat: null, lng: null, radiusM: f.radiusM }, { onSuccess: () => setF({ ...f, lat: null, lng: null }) })}>Clear</button>}
      </div>
    </section>
  );
}
