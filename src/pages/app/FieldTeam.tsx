import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BrainCircuit, Clock3, IndianRupee, Loader2, MapPinned, Route, Sparkles, Store, Users } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { useAiEnabled } from '@/components/Assistant';
import { money, todayISO } from '@/lib/format';
import type { FieldVisit } from '@/lib/geo';

interface Person {
  id: string; userId: string; userName: string; startedAt: string; endedAt: string | null; onDuty: boolean; distanceKm: number; onDutyMinutes: number;
  route: Array<{ lat: number; lng: number; at: string }>; visits: FieldVisit[]; lastSeen: { lat: number; lng: number; at: string } | null;
  totals: { visits: number; orders: number; orderValue: number; collected: number };
}
interface Summary { headline: string; people: Array<{ name: string; summary: string; flag: string | null }>; followUps: string[] }

const COLORS = ['#c75f71', '#56654f', '#b07a2f', '#6b5ca5', '#2f7d9a', '#a2465a', '#54463a'];
const time = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Owner's view of the field team: where everyone went, who they met, what came of it. */
export default function FieldTeam() {
  const toast = useToast();
  const aiOn = useAiEnabled();
  const [date, setDate] = useState(todayISO());
  const [focus, setFocus] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['fieldTeam', date], queryFn: () => api.get<{ date: string; people: Person[] }>(`/shop/field/team?date=${date}`), refetchInterval: date === todayISO() ? 60_000 : false });
  const people = q.data?.people ?? [];
  const shown = focus ? people.filter((p) => p.userId === focus) : people;
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapEl.current || map.current) return;
    map.current = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([20.6, 78.9], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current; const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    shown.forEach((p) => {
      const color = COLORS[people.indexOf(p) % COLORS.length]!;
      const line = p.route.map((r) => [r.lat, r.lng] as [number, number]);
      if (line.length > 1) L.polyline(line, { color, weight: 4, opacity: 0.75 }).addTo(g);
      bounds.push(...line);
      p.visits.filter((v) => v.lat !== null).forEach((v, i) => {
        const ll: [number, number] = [v.lat!, v.lng!];
        bounds.push(ll);
        L.marker(ll, { icon: L.divIcon({ className: 'fv-pin', html: `<span style="background:${color}">${i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindPopup(`<strong>${esc(v.customerName)}</strong><br>${esc(p.userName)} · ${time(v.checkedInAt)}${v.minutes !== null ? ` · ${v.minutes} min` : ''}<br>${esc(v.outcome || v.purpose)}${v.orderValue ? ` · order ${money(v.orderValue)}` : ''}${v.collected ? ` · collected ${money(v.collected)}` : ''}${v.notes ? `<br><em>${esc(v.notes)}</em>` : ''}`)
          .addTo(g);
      });
      if (p.lastSeen && p.onDuty) {
        L.circleMarker([p.lastSeen.lat, p.lastSeen.lng], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(`${p.userName} · last seen ${time(p.lastSeen.at)}`, { permanent: false }).addTo(g);
        bounds.push([p.lastSeen.lat, p.lastSeen.lng]);
      }
    });
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds as L.LatLngTuple[]).pad(0.2), { maxZoom: 15 });
    setTimeout(() => m.invalidateSize(), 50);
  }, [shown, people]);

  const totals = useMemo(() => ({
    people: people.length, onDuty: people.filter((p) => p.onDuty).length, visits: people.reduce((s, p) => s + p.totals.visits, 0),
    orders: people.reduce((s, p) => s + p.totals.orderValue, 0), collected: people.reduce((s, p) => s + p.totals.collected, 0), km: Math.round(people.reduce((s, p) => s + p.distanceKm, 0) * 10) / 10,
  }), [people]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const ai = useMut(() => api.post<Summary>('/shop/ai/field-summary', { date }), [], { silentError: true });
  useEffect(() => setSummary(null), [date]);

  return (
    <div className="page">
      <PageHeader title="Field Team" crumbs={<>Sales <span>/</span> Field Team</>} subtitle="Where your salespeople went, who they met and what they brought back. Updates every minute while they are on duty."
        actions={<>
          <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} aria-label="Date" style={{ width: 170 }} />
          <ExportMenu disabled={!people.length} table={() => ({
            title: 'Field visits', subtitle: date, filename: `field-visits-${date}`,
            columns: [{ label: 'Person' }, { label: 'Time' }, { label: 'Customer' }, { label: 'Purpose' }, { label: 'Result' }, { label: 'Minutes', align: 'right' }, { label: 'Order', money: true }, { label: 'Collected', money: true }, { label: 'Notes' }],
            rows: people.flatMap((p) => p.visits.map((v) => ({ cells: [p.userName, time(v.checkedInAt), v.customerName, v.purpose, v.outcome || '—', v.minutes ?? '—', v.orderValue, v.collected, v.notes] }))),
          })} />
        </>} />

      <div className="stat-grid">
        <StatCard label="On duty" value={`${totals.onDuty} / ${totals.people}`} icon={Users} tone="blue" foot={`${totals.km} km travelled`} />
        <StatCard label="Visits" value={totals.visits} icon={MapPinned} tone="violet" foot={totals.people ? `${Math.round((totals.visits / totals.people) * 10) / 10} per person` : '—'} />
        <StatCard label="Orders" value={money(totals.orders)} icon={Store} tone="green" foot="value noted at visits" />
        <StatCard label="Collected" value={money(totals.collected)} icon={IndianRupee} tone="amber" foot="cash and cheques picked up" />
      </div>

      {aiOn && people.length > 0 && (
        <div className="card ai-advice mt-16">
          <div className="ai-advice-head">
            <span className="ai-badge"><BrainCircuit size={18} /></span>
            <div style={{ flex: 1 }}><h3>AI day summary</h3><p className="small muted">What each person did, anything worth a look, and who to follow up.</p></div>
            <button className="btn btn-primary" disabled={ai.isPending} onClick={() => ai.mutate(undefined, { onSuccess: setSummary, onError: (e) => toast('error', e.message) })}>{ai.isPending ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {summary ? 'Refresh' : 'Summarise the day'}</button>
          </div>
          {summary && (
            <div className="ai-advice-body">
              <p className="ai-headline">{summary.headline}</p>
              <ol className="ai-actions">{summary.people.map((p) => <li key={p.name} className={p.flag ? 'pri-medium' : 'pri-low'}><span className="pri">{p.name.split(' ')[0]}</span><div><div>{p.summary}</div>{p.flag && <div className="small" style={{ color: 'var(--amber-700)', marginTop: 4 }}>{p.flag}</div>}</div></li>)}</ol>
              {summary.followUps.length > 0 && <div className="ai-season"><Clock3 size={14} /><div><strong>Follow up:</strong> {summary.followUps.join(' · ')}</div></div>}
            </div>
          )}
        </div>
      )}

      <div className="field-team mt-16">
        <aside className="card ft-people">
          <div className="card-header"><h3>Team</h3>{focus && <button className="btn btn-ghost btn-sm" onClick={() => setFocus(null)}>Show all</button>}</div>
          {q.isLoading ? <div className="skeleton" style={{ height: 200, margin: 12 }} /> : people.length === 0 ? (
            <EmptyState icon={Route} title="Nobody on the road" text={date === todayISO() ? 'Salespeople appear here when they tap Start day in My Day.' : 'No field activity on this date.'} />
          ) : people.map((p, i) => (
            <button key={p.userId} className={`ft-person ${focus === p.userId ? 'on' : ''}`} onClick={() => setFocus(focus === p.userId ? null : p.userId)}>
              <span className="ft-color" style={{ background: COLORS[i % COLORS.length] }} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <strong>{p.userName}</strong> <span className={`badge ${p.onDuty ? 'badge-green' : 'badge-gray'}`}>{p.onDuty ? 'On duty' : 'Ended'}</span>
                <div className="small muted">{time(p.startedAt)}{p.endedAt ? ` – ${time(p.endedAt)}` : ''} · {hm(p.onDutyMinutes)} · {p.distanceKm} km</div>
                <div className="small">{p.totals.visits} visits · {p.totals.orders} orders · {money(p.totals.orderValue)}{p.totals.collected ? ` · +${money(p.totals.collected)}` : ''}</div>
                {p.lastSeen && p.onDuty && <div className="small muted">Last seen {time(p.lastSeen.at)}</div>}
              </div>
            </button>
          ))}
        </aside>
        <div className="card ft-map"><div ref={mapEl} className="ft-map-el" aria-label="Map of visits" /></div>
      </div>

      {shown.some((p) => p.visits.length) && (
        <div className="card mt-16">
          <div className="card-header"><h3>Visits</h3></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Time</th><th>Person</th><th>Customer</th><th>Result</th><th className="num">Minutes</th><th className="num">Order</th><th className="num">Collected</th><th>Notes</th></tr></thead>
            <tbody>{shown.flatMap((p) => p.visits.map((v) => ({ p, v }))).sort((a, b) => a.v.checkedInAt.localeCompare(b.v.checkedInAt)).map(({ p, v }) => (
              <tr key={v.id}><td>{time(v.checkedInAt)}</td><td>{p.userName}</td><td className="strong">{v.customerName}<div className="muted small">{v.purpose}</div></td><td>{v.outcome || <span className="muted">In progress</span>}</td>
                <td className="num">{v.minutes ?? '—'}</td><td className="num">{v.orderValue ? money(v.orderValue) : '—'}</td><td className="num">{v.collected ? money(v.collected) : '—'}</td><td className="small">{v.notes}{v.nextVisit ? <div className="muted">Next visit {v.nextVisit}</div> : null}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
