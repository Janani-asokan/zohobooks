import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Inbox, Puzzle, Save, X, Zap } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, usePlatformOverview } from '@/api/hooks';
import { Badge, EmptyState, Field, Modal, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';

interface Level { key: string; name: string; description: string; monthly: number; yearly: number; custom: boolean; includedCredits: number | null }
interface CatalogueFeature { key: string; name: string; group: string; summary: string; available: boolean; shops: number; levels: Level[] }
interface Request { id: string; shopId: string; shopName: string; feature: string; level: string; monthlyPrice: number | null; note: string; requestedBy: string; createdAt: string }
interface HistoryRow { id: string; feature: string; level: string; status: string; source: string; live: boolean; startsOn: string; endsOn: string | null; monthlyPrice: number | null; note: string; decidedBy: string; createdAt: string }
interface Activate { shopId: string; shopName: string; feature: CatalogueFeature; level: string; source: 'paid' | 'trial' | 'complimentary'; endsOn: string; monthlyPrice: string; note: string }

const KEYS = [['platform', 'features']];
const plusMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

/** Platform owner: set feature prices, approve shops' requests, and turn features on or off for any shop. */
export default function SuperFeatures() {
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['platform', 'features'], queryFn: () => api.get<{ features: CatalogueFeature[]; requests: Request[] }>('/platform/features') });
  const shops = usePlatformOverview().data?.shops ?? [];
  const shopId = params.get('shop') ?? '';
  const shop = shops.find((s) => s.id === shopId);
  const hist = useQuery({ queryKey: ['platform', 'features', shopId], enabled: !!shopId, queryFn: () => api.get<{ history: HistoryRow[]; shop: { licenseEnd: string } }>(`/platform/shops/${shopId}/features`) });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [act, setAct] = useState<Activate | null>(null);
  const features = q.data?.features ?? [];
  useEffect(() => {
    if (!q.data) return;
    setPrices(Object.fromEntries(q.data.features.flatMap((f) => f.levels.map((l) => [`${f.key}:${l.key}`, l.monthly]))));
    setCredits(Object.fromEntries(q.data.features.flatMap((f) => f.levels.filter((l) => l.includedCredits != null).map((l) => [`${f.key}:${l.key}`, l.includedCredits!]))));
  }, [q.data]);

  const changed = useMemo(() => features.flatMap((f) => f.levels.filter((l) => {
    const k = `${f.key}:${l.key}`;
    return (prices[k] !== undefined && prices[k] !== l.monthly) || (l.includedCredits != null && credits[k] !== undefined && credits[k] !== l.includedCredits);
  }).map((l) => {
    const k = `${f.key}:${l.key}`;
    return { feature: f.key, level: l.key, monthly: prices[k] ?? l.monthly, ...(l.includedCredits != null ? { includedCredits: credits[k] ?? l.includedCredits } : {}) };
  })), [features, prices, credits]);
  const savePrices = useMut(() => api.put('/platform/features/prices', { prices: changed }), KEYS, { success: 'Prices saved. Shops see them straight away.' });
  const turnOn = useMut((a: Activate) => api.post(`/platform/shops/${a.shopId}/features/${a.feature.key}`, {
    level: a.level, source: a.source, endsOn: a.endsOn || null, monthlyPrice: a.monthlyPrice === '' ? null : Number(a.monthlyPrice), note: a.note,
  }), KEYS, { success: (_r, a) => `${a.feature.name} turned on for ${a.shopName}` });
  const turnOff = useMut((v: { shopId: string; feature: string; note: string }) => api.del(`/platform/shops/${v.shopId}/features/${v.feature}`), KEYS, { success: 'Turned off. The shop’s data is kept.' });
  const decline = useMut((v: { shopId: string; feature: string }) => api.post(`/platform/shops/${v.shopId}/features/${v.feature}/decline`, {}), KEYS, { success: 'Request declined' });

  const open = (s: { id: string; name: string }, f: CatalogueFeature, level?: string, monthly?: number | null) =>
    setAct({ shopId: s.id, shopName: s.name, feature: f, level: level ?? f.levels[f.levels.length - 1]!.key, source: 'paid', endsOn: plusMonths(1), monthlyPrice: monthly == null ? '' : String(monthly), note: '' });
  const live = (key: string) => hist.data?.history.find((h) => h.feature === key && h.status === 'active' && h.live);

  return (
    <div className="page">
      <PageHeader title="Features & prices" icon={Puzzle} subtitle="Shops pay only for the add-ons they use. Core billing is always included." />

      <section className="card">
        <div className="card-header"><div><h3><Inbox size={16} /> Requests</h3><p>Shops that asked for a feature. Call them, take payment, then approve.</p></div></div>
        {!q.data?.requests.length ? <div className="card-body small muted">No open requests.</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Shop</th><th>Feature</th><th>Asked</th><th className="num">Price / month</th><th>Note</th><th /></tr></thead>
            <tbody>{q.data.requests.map((r) => {
              const f = features.find((x) => x.key === r.feature);
              return (
                <tr key={r.id}>
                  <td className="strong">{r.shopName}<div className="muted small">{r.requestedBy}</div></td>
                  <td>{f?.name ?? r.feature}{f && f.levels.length > 1 ? ` · ${f.levels.find((l) => l.key === r.level)?.name}` : ''}</td>
                  <td>{fmtDate(String(r.createdAt).slice(0, 10))}</td>
                  <td className="num">{r.monthlyPrice == null ? '—' : money(r.monthlyPrice)}</td>
                  <td className="small">{r.note || <span className="muted">—</span>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {f && <button className="btn btn-primary btn-sm" onClick={() => open({ id: r.shopId, name: r.shopName }, f, r.level, r.monthlyPrice)}><Check size={14} /> Approve</button>}{' '}
                    <button className="btn btn-ghost btn-sm" disabled={decline.isPending} onClick={() => decline.mutate({ shopId: r.shopId, feature: r.feature })}><X size={14} /> Decline</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="card mt-16">
        <div className="card-header"><div><h3>Price list</h3><p>Per month. A year costs ten months. Changes apply to new requests; agreed prices of running periods stay.</p></div>
          <button className="btn btn-primary" disabled={!changed.length || savePrices.isPending} onClick={() => savePrices.mutate(undefined)}><Save size={15} /> Save {changed.length || ''} change{changed.length === 1 ? '' : 's'}</button></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Feature</th><th>Level</th><th className="num">Shops using</th><th style={{ width: 170 }}>Price / month (₹)</th><th className="num">Per year</th><th style={{ width: 150 }}>AI credits / month</th></tr></thead>
          <tbody>{features.flatMap((f) => f.levels.map((l, i) => (
            <tr key={`${f.key}:${l.key}`}>
              <td>{i === 0 && <><span className="strong">{f.name}</span>{!f.available && <> <Badge tone="gray">Coming soon</Badge></>}<div className="muted small">{f.group}</div></>}</td>
              <td>{l.name}{f.levels.length > 1 && <div className="muted small">{l.description}</div>}</td>
              <td className="num">{i === 0 ? f.shops : ''}</td>
              <td><input id={`price-${f.key}-${l.key}`} aria-label={`${f.name} ${l.name} price per month`} className="input" type="number" min={0} value={prices[`${f.key}:${l.key}`] ?? l.monthly}
                onChange={(e) => setPrices({ ...prices, [`${f.key}:${l.key}`]: Math.max(0, Number(e.target.value) || 0) })} /></td>
              <td className="num">{money((prices[`${f.key}:${l.key}`] ?? l.monthly) * 10)}</td>
              <td>{l.includedCredits != null ? <input id={`credits-${f.key}-${l.key}`} aria-label={`${f.name} ${l.name} AI credits per month`} className="input" type="number" min={0} value={credits[`${f.key}:${l.key}`] ?? l.includedCredits}
                onChange={(e) => setCredits({ ...credits, [`${f.key}:${l.key}`]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /> : <span className="muted">—</span>}</td>
            </tr>
          )))}</tbody>
        </table></div>
      </section>

      <AiCreditsSection />

      <section className="card mt-16">
        <div className="card-header"><div><h3>A shop’s features</h3><p>Turn add-ons on or off. Turning off hides the feature; the shop’s data is kept.</p></div>
          <select id="sf-shop" className="select" style={{ maxWidth: 320 }} value={shopId} onChange={(e) => { params.set('shop', e.target.value); setParams(params, { replace: true }); }} aria-label="Shop">
            <option value="">Choose a shop…</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.shopName}</option>)}
          </select></div>
        {!shop ? <EmptyState icon={Puzzle} title="Choose a shop" text="Pick a shop to see and change its features." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Feature</th><th>Status</th><th>Until</th><th className="num">Price / month</th><th /></tr></thead>
            <tbody>{features.filter((f) => f.available).map((f) => {
              const h = live(f.key);
              return (
                <tr key={f.key}>
                  <td className="strong">{f.name}</td>
                  <td>{h ? <Badge tone={h.source === 'trial' ? 'amber' : 'green'}>{h.source === 'trial' ? 'Trial' : h.source === 'grandfathered' ? 'On (existing shop)' : h.source === 'complimentary' ? 'On (free)' : 'On'}</Badge> : <Badge tone="gray">Off</Badge>}</td>
                  <td>{h?.endsOn ? fmtDate(h.endsOn) : h ? 'No end date' : '—'}</td>
                  <td className="num">{h?.monthlyPrice == null ? '—' : money(h.monthlyPrice)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => open({ id: shop.id, name: shop.shopName }, f, h?.level)}>{h ? 'Change' : 'Turn on'}</button>{' '}
                    {h && <button className="btn btn-ghost btn-sm" onClick={() => turnOff.mutate({ shopId: shop.id, feature: f.key, note: 'Turned off by the platform' })}>Turn off</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <Modal open={!!act} onClose={() => setAct(null)} title={act ? `${act.feature.name} for ${act.shopName}` : ''} subtitle="Record what was agreed. The previous period is kept in the history."
        footer={<><button className="btn btn-secondary" onClick={() => setAct(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={turnOn.isPending} onClick={() => act && turnOn.mutate(act, { onSuccess: () => setAct(null) })}>Turn on</button></>}>
        {act && <div className="form-grid">
          {act.feature.levels.length > 1 && <Field label="Level"><select id="act-level" className="select" value={act.level} onChange={(e) => setAct({ ...act, level: e.target.value })}>{act.feature.levels.map((l) => <option key={l.key} value={l.key}>{l.name} · {money(l.monthly)}</option>)}</select></Field>}
          <Field label="Type"><select id="act-source" className="select" value={act.source} onChange={(e) => setAct({ ...act, source: e.target.value as Activate['source'] })}>
            <option value="paid">Paid</option><option value="trial">Trial</option><option value="complimentary">Free (complimentary)</option></select></Field>
          <Field label="Until" hint="Leave empty for no end date">
            <div className="row" style={{ gap: 6 }}><input id="act-ends" className="input" type="date" value={act.endsOn} onChange={(e) => setAct({ ...act, endsOn: e.target.value })} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAct({ ...act, endsOn: plusMonths(1) })}>1 month</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAct({ ...act, endsOn: plusMonths(12) })}>1 year</button>
              {act.shopId === shopId && hist.data && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAct({ ...act, endsOn: hist.data!.shop.licenseEnd })}>Licence end</button>}</div></Field>
          <Field label="Agreed price / month (₹)" hint="Empty: today’s list price"><input id="act-price" className="input" type="number" min={0} value={act.monthlyPrice} onChange={(e) => setAct({ ...act, monthlyPrice: e.target.value })} /></Field>
          <Field label="Note" className="span-all"><input id="act-note" className="input" value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} placeholder="UTR / cheque number, or why it is free" /></Field>
        </div>}
      </Modal>
    </div>
  );
}

interface AiOverview {
  shops: Array<{ id: string; name: string; level: string | null; allowance: number; used: number; pct: number; calls: number; costUsd: number }>;
  totalCostUsd: number;
  requests: Array<{ id: string; shopId: string; shopName: string; credits: number; price: number; requestedBy: string; createdAt: string }>;
  pack: { credits: number; price: number };
}

/** AI credits across shops: what each used this month and what it really cost, top-up requests, and the pack. */
function AiCreditsSection() {
  const q = useQuery({ queryKey: ['platform', 'ai'], queryFn: () => api.get<AiOverview>('/platform/ai') });
  const [pack, setPack] = useState<{ credits: number; price: number } | null>(null);
  const [grant, setGrant] = useState<{ shopId: string; shopName: string; credits: string; price: string; note: string } | null>(null);
  useEffect(() => { if (q.data) setPack(q.data.pack); }, [q.data]);
  const savePack = useMut((p: { credits: number; price: number }) => api.put('/platform/ai/pack', p), [['platform', 'ai']], { success: 'Top-up pack saved' });
  const give = useMut((g: NonNullable<typeof grant>) => api.post(`/platform/shops/${g.shopId}/ai/topups`, {
    ...(g.credits ? { credits: Number(g.credits) } : {}), ...(g.price ? { price: Number(g.price) } : {}), note: g.note,
  }), [['platform', 'ai']], { success: (_r, g) => `Credits added for ${g.shopName}` });
  const decline = useMut((shopId: string) => api.post(`/platform/shops/${shopId}/ai/topups/decline`, {}), [['platform', 'ai']], { success: 'Request declined' });
  const d = q.data;
  if (!d) return <div className="skeleton mt-16" style={{ height: 200 }} />;
  const packDirty = pack && (pack.credits !== d.pack.credits || pack.price !== d.pack.price);
  return (
    <section className="card mt-16">
      <div className="card-header"><div><h3><Zap size={16} /> AI credits</h3><p>1 credit = US$0.004 of real AI cost. This month the AI has cost you US${d.totalCostUsd.toFixed(2)} across all shops.</p></div></div>
      {d.requests.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Asked for more credits</th><th className="num">Credits</th><th className="num">Price</th><th>Asked</th><th /></tr></thead>
          <tbody>{d.requests.map((r) => (
            <tr key={r.id}>
              <td className="strong">{r.shopName}<div className="muted small">{r.requestedBy}</div></td>
              <td className="num">{r.credits.toLocaleString('en-IN')}</td><td className="num">{money(r.price)}</td><td>{fmtDate(String(r.createdAt).slice(0, 10))}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => setGrant({ shopId: r.shopId, shopName: r.shopName, credits: String(r.credits), price: String(r.price), note: '' })}><Check size={14} /> Add credits</button>{' '}
                <button className="btn btn-ghost btn-sm" disabled={decline.isPending} onClick={() => decline.mutate(r.shopId)}><X size={14} /> Decline</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Shop</th><th>Level</th><th style={{ width: 200 }}>Used this month</th><th className="num">Uses</th><th className="num">AI cost</th><th /></tr></thead>
        <tbody>{d.shops.filter((x) => x.level || x.calls).map((x) => (
          <tr key={x.id}>
            <td className="strong">{x.name}</td>
            <td>{x.level ? x.level[0]!.toUpperCase() + x.level.slice(1) : <span className="muted">Off</span>}</td>
            <td><div className={`ai-meter ${x.pct >= 100 ? 'full' : x.pct >= 80 ? 'warn' : ''}`}><span style={{ width: `${x.pct}%` }} /></div>
              <div className="small muted">{Math.round(x.used).toLocaleString('en-IN')} of {x.allowance.toLocaleString('en-IN')} · {x.pct}%</div></td>
            <td className="num">{x.calls}</td>
            <td className="num">US${x.costUsd.toFixed(2)}</td>
            <td className="num">{x.level && <button className="btn btn-secondary btn-sm" onClick={() => setGrant({ shopId: x.id, shopName: x.name, credits: '', price: '', note: '' })}>Add credits</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {pack && (
        <div className="card-body row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
          <Field label="Top-up pack: credits"><input id="pack-credits" className="input" style={{ width: 140 }} type="number" min={1} value={pack.credits} onChange={(e) => setPack({ ...pack, credits: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></Field>
          <Field label="Pack price (₹)"><input id="pack-price" className="input" style={{ width: 140 }} type="number" min={0} value={pack.price} onChange={(e) => setPack({ ...pack, price: Math.max(0, Number(e.target.value) || 0) })} /></Field>
          <button className="btn btn-secondary" disabled={!packDirty || savePack.isPending} onClick={() => savePack.mutate(pack)}><Save size={15} /> Save pack</button>
          <span className="small muted">Real AI cost of one pack: about US${(pack.credits * 0.004).toFixed(2)}</span>
        </div>
      )}
      <Modal open={!!grant} onClose={() => setGrant(null)} title={grant ? `Add AI credits for ${grant.shopName}` : ''} subtitle="Extra credits apply to this month."
        footer={<><button className="btn btn-secondary" onClick={() => setGrant(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={give.isPending} onClick={() => grant && give.mutate(grant, { onSuccess: () => setGrant(null) })}>Add credits</button></>}>
        {grant && <div className="form-grid">
          <Field label="Credits" hint={`Empty: one pack (${d.pack.credits})`}><input id="grant-credits" className="input" type="number" min={1} value={grant.credits} onChange={(e) => setGrant({ ...grant, credits: e.target.value })} /></Field>
          <Field label="Price (₹)" hint={`Empty: pack price (${money(d.pack.price)})`}><input id="grant-price" className="input" type="number" min={0} value={grant.price} onChange={(e) => setGrant({ ...grant, price: e.target.value })} /></Field>
          <Field label="Note" className="span-all"><input id="grant-note" className="input" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} placeholder="UTR / cheque number, or why it is free" /></Field>
        </div>}
      </Modal>
    </section>
  );
}
