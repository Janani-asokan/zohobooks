import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Puzzle, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { useAuth } from '@/context/AuthContext';
import { Badge, Field, Modal, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';

interface Level { key: string; name: string; description: string; monthly: number; yearly: number }
interface ShopFeature {
  key: string; name: string; group: string; summary: string; includes: string[]; levels: Level[];
  on: boolean; level: string | null; source: string | null; endsOn: string | null; requested: { level: string; at: string } | null;
}
interface HistoryRow { id: string; feature: string; level: string; status: string; source: string; startsOn: string; endsOn: string | null; monthlyPrice: number | null; createdAt: string }

/** Everything every shop gets, whatever add-ons it has. */
const CORE = ['GST invoices, bill of supply and credit notes', 'Customers, payments received and dues', 'Items, stock and low-stock alerts', 'Sales, profit and GST reports (GSTR-1, GSTR-3B)', 'Banking and cash', 'WhatsApp sharing, UPI QR and printing', 'Staff logins with roles'];

const SOURCE: Record<string, string> = { trial: 'Trial', paid: 'On', complimentary: 'On', grandfathered: 'On' };

/** The owner picks the add-ons the business needs, sees what each costs, and asks for one in one tap. */
export default function Features() {
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const focus = params.get('f');
  const q = useQuery({ queryKey: ['features'], queryFn: () => api.get<{ features: ShopFeature[]; history: HistoryRow[] }>('/shop/features') });
  const [ask, setAsk] = useState<{ f: ShopFeature; level: string; note: string } | null>(null);
  const request = useMut((v: { key: string; level: string; note: string }) => api.post(`/shop/features/${v.key}/request`, { level: v.level, note: v.note }), [['features']],
    { success: 'Request sent. We will call you to confirm and turn it on.' });
  const withdraw = useMut((key: string) => api.del(`/shop/features/${key}/request`), [['features']], { success: 'Request withdrawn' });

  useEffect(() => { refresh(); }, [refresh]); // pick up features the platform turned on since sign-in
  useEffect(() => {
    if (focus && q.data) document.getElementById(`feature-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus, q.data]);

  const groups = useMemo(() => {
    const m = new Map<string, ShopFeature[]>();
    for (const f of q.data?.features ?? []) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [q.data]);
  const monthly = (q.data?.features ?? []).filter((f) => f.on && f.source === 'paid').reduce((s, f) => s + (f.levels.find((l) => l.key === f.level)?.monthly ?? 0), 0);

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader title="Features & add-ons" icon={Puzzle}
        subtitle="Pay only for what your business uses. Turning something off hides it; nothing you saved is ever deleted." />

      <section className="card card-body feature-core">
        <div><h3 style={{ margin: 0 }}><Check size={16} /> Included for every business</h3>
          <ul className="feature-includes cols">{CORE.map((c) => <li key={c}><Check size={14} /> {c}</li>)}</ul></div>
        {monthly > 0 && <div className="feature-total"><span className="small muted">Your add-ons</span><strong>{money(monthly)}</strong><span className="small muted">per month</span></div>}
      </section>

      {q.isLoading && <div className="skeleton mt-16" style={{ height: 320 }} />}
      {groups.map(([group, list]) => (
        <section key={group} className="mt-16">
          <h3 className="feature-group">{group}</h3>
          <div className="feature-grid">
            {list.map((f) => {
              const lvl = f.levels.find((l) => l.key === (f.level ?? f.requested?.level)) ?? f.levels[0]!;
              return (
                <article key={f.key} id={`feature-${f.key}`} className={`card feature-card ${f.on ? 'is-on' : ''} ${focus === f.key ? 'is-focus' : ''}`}>
                  <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <h4>{f.name}</h4>
                    {f.on ? <Badge tone={f.source === 'trial' ? 'amber' : 'green'}>{SOURCE[f.source ?? ''] ?? 'On'}{f.endsOn ? ` till ${fmtDate(f.endsOn)}` : ''}</Badge>
                      : f.requested ? <Badge tone="violet"><Clock size={12} /> Asked {fmtDate(String(f.requested.at).slice(0, 10))}</Badge> : <Badge tone="gray">Off</Badge>}
                  </div>
                  <p className="small muted">{f.summary}</p>
                  <ul className="feature-includes">{f.includes.map((i) => <li key={i}><Check size={14} /> {i}</li>)}</ul>
                  <div className="feature-price">
                    {f.levels.length > 1 ? <span className="small muted">From </span> : null}
                    <strong>{money(Math.min(...f.levels.map((l) => l.monthly)))}</strong><span className="small muted"> / month · {money(lvl.yearly)} / year</span>
                  </div>
                  {f.on && f.levels.length > 1 && <p className="small muted">Level: {lvl.name}</p>}
                  {!f.on && !f.requested && <button className="btn btn-primary btn-block" onClick={() => setAsk({ f, level: f.levels[0]!.key, note: '' })}><Sparkles size={15} /> Ask to turn on</button>}
                  {f.requested && <button className="btn btn-secondary btn-block" disabled={withdraw.isPending} onClick={() => withdraw.mutate(f.key)}>Withdraw request</button>}
                  {f.on && f.source === 'trial' && !f.requested && <button className="btn btn-secondary btn-block" onClick={() => setAsk({ f, level: f.level ?? f.levels[0]!.key, note: '' })}>Keep it after the trial</button>}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {!!q.data?.history.length && (
        <details className="card mt-16">
          <summary className="card-body strong" style={{ cursor: 'pointer' }}>History</summary>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Feature</th><th>What happened</th><th>From</th><th>To</th><th className="num">Price / month</th></tr></thead>
            <tbody>{q.data.history.map((h) => (
              <tr key={h.id}>
                <td>{q.data.features.find((f) => f.key === h.feature)?.name ?? h.feature}</td>
                <td>{h.status === 'requested' ? 'Asked for' : h.status === 'active' ? (h.source === 'trial' ? 'Trial' : 'Turned on') : h.source === 'request' ? 'Request closed' : 'Ended'}</td>
                <td>{fmtDate(h.startsOn)}</td><td>{h.endsOn ? fmtDate(h.endsOn) : '—'}</td>
                <td className="num">{h.monthlyPrice == null ? '—' : money(h.monthlyPrice)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      )}

      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask ? `Turn on ${ask.f.name}` : ''}
        subtitle="We will call you to confirm and turn it on. Nothing is charged until then."
        footer={<><button className="btn btn-secondary" onClick={() => setAsk(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={request.isPending} onClick={() => ask && request.mutate({ key: ask.f.key, level: ask.level, note: ask.note }, { onSuccess: () => setAsk(null) })}>Send request</button></>}>
        {ask && <div className="stack" style={{ gap: 12 }}>
          {ask.f.levels.length > 1 ? (
            <div className="stack" role="radiogroup" aria-label="Level" style={{ gap: 8 }}>
              {ask.f.levels.map((l) => (
                <label key={l.key} className={`feature-level ${ask.level === l.key ? 'active' : ''}`}>
                  <input type="radio" name="level" checked={ask.level === l.key} onChange={() => setAsk({ ...ask, level: l.key })} />
                  <span><strong>{l.name}</strong> · {money(l.monthly)} / month<br /><span className="small muted">{l.description}</span></span>
                </label>
              ))}
            </div>
          ) : (
            <p><strong>{money(ask.f.levels[0]!.monthly)}</strong> per month, or {money(ask.f.levels[0]!.yearly)} for a year (two months free).</p>
          )}
          <Field label="Anything we should know? (optional)"><textarea id="ft-note" className="textarea" rows={2} value={ask.note} onChange={(e) => setAsk({ ...ask, note: e.target.value })} placeholder="For example: we have 3 counters" /></Field>
        </div>}
      </Modal>
    </div>
  );
}
