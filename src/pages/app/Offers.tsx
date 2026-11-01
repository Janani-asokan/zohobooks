import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift, Plus, Pencil, Pause, Play, Archive, Loader2, Sparkles, Star, Search } from 'lucide-react';
import { api } from '@/api/client';
import { useItems, useMut } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Segmented, Toggle } from '@/components/ui';
import { fmtDate, money, todayISO } from '@/lib/format';
import { offerStatus, withLoyaltyDefaults, type LoyaltySettings, type Offer } from '../../../shared/offers';

type Draft = Omit<Offer, 'id' | 'value' | 'minBill'> & { value: string; minBill: string };

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const blank = (): Draft => ({ name: '', kind: 'item', discountKind: 'percent', value: '10', scope: 'all', categories: [], itemIds: [], minBill: '', startsOn: todayISO(), endsOn: addDays(todayISO(), 7), message: '', active: true });

/** Quick starts for the festivals Indian shops run sales for. Dates are a suggestion to change. */
const PRESETS: Array<{ label: string; name: string; message: string; days: number }> = [
  { label: 'Diwali', name: 'Diwali offer', message: 'Happy Diwali! Festival discount applied.', days: 10 },
  { label: 'Children’s Day', name: 'Children’s Day offer', message: 'Happy Children’s Day!', days: 3 },
  { label: 'Christmas', name: 'Christmas offer', message: 'Merry Christmas! Festive discount applied.', days: 7 },
  { label: 'New Year', name: 'New Year sale', message: 'Happy New Year! Sale price applied.', days: 5 },
  { label: 'Pongal / Sankranti', name: 'Pongal offer', message: 'Happy Pongal!', days: 4 },
  { label: 'Clearance', name: 'Clearance sale', message: 'Clearance sale price.', days: 14 },
];

const TONE = { Running: 'green', Upcoming: 'blue', Ended: 'gray', Paused: 'amber' } as const;

export function describeOffer(o: Pick<Offer, 'kind' | 'discountKind' | 'value' | 'scope' | 'categories' | 'itemIds' | 'minBill'>) {
  const off = o.discountKind === 'percent' ? `${o.value}% off` : `${money(o.value).replace('.00', '')} off`;
  if (o.kind === 'bill') return `${off} the bill${o.minBill > 0 ? ` on bills of ${money(o.minBill).replace('.00', '')} or more` : ''}`;
  if (o.scope === 'all') return `${off} every item`;
  if (o.scope === 'category') return o.categories.length ? `${off} ${o.categories.join(', ')}` : `${off} the categories you pick`;
  return o.itemIds.length ? `${off} ${o.itemIds.length} chosen item${o.itemIds.length === 1 ? '' : 's'}` : `${off} the items you pick`;
}

export default function Offers() {
  const me = useShopUser();
  const [tab, setTab] = useState<'offers' | 'loyalty'>('offers');
  return (
    <div className="page">
      <PageHeader title="Offers & loyalty" crumbs={<>Sales <span>/</span> Offers & loyalty</>} icon={Gift}
        subtitle="Festival offers apply by themselves at the counter and on invoices. Regular customers earn points they can spend later." />
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>Offers</button>
        <button className={tab === 'loyalty' ? 'active' : ''} onClick={() => setTab('loyalty')}>Loyalty points</button>
      </div>
      {tab === 'offers' ? <OffersTab canEdit={me.can('items.write')} /> : <LoyaltyTab canEdit={me.can('admin')} />}
    </div>
  );
}

function OffersTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data: offers = [], isLoading } = useQuery({ queryKey: ['offers'], queryFn: () => api.get<Offer[]>('/shop/offers') });
  const items = (useItems().data ?? []).filter((i) => !i.isGroup);
  const categories = useMemo(() => [...new Set(items.map((i) => (i.category ?? '').trim()).filter(Boolean))].sort(), [items]);
  const [modal, setModal] = useState<{ id?: string } | null>(null);
  const [f, setF] = useState<Draft>(blank());
  const [touched, setTouched] = useState(false);
  const [q, setQ] = useState('');
  const [archive, setArchive] = useState<Offer | null>(null);
  const keys = [['offers'], ['offers-running']];
  const create = useMut((b: Record<string, unknown>) => api.post<Offer>('/shop/offers', b), keys, { success: 'Offer saved' });
  const update = useMut((v: { id: string; b: Record<string, unknown> }) => api.put<Offer>(`/shop/offers/${v.id}`, v.b), keys, { success: 'Offer updated' });
  const remove = useMut((id: string) => api.post(`/shop/offers/${id}/archive`, {}), keys, { success: 'Offer archived' });
  const today = todayISO();

  const open = (o?: Offer, preset?: (typeof PRESETS)[number]) => {
    setF(o ? { ...o, value: String(o.value), minBill: o.minBill ? String(o.minBill) : '' }
      : preset ? { ...blank(), name: preset.name, message: preset.message, endsOn: addDays(today, preset.days - 1) } : blank());
    setTouched(false); setQ('');
    setModal({ id: o?.id });
  };
  const body = (d: Draft) => ({ ...d, value: Number(d.value), minBill: Number(d.minBill || 0), discountKind: d.kind === 'item' ? 'percent' : d.discountKind });
  const v = Number(f.value);
  const errs = {
    name: !f.name.trim() ? 'Give the offer a name' : '',
    value: !(v > 0) ? 'Enter the discount' : f.discountKind === 'percent' || f.kind === 'item' ? (v > 100 ? 'At most 100%' : '') : '',
    endsOn: f.endsOn < f.startsOn ? 'Must be on or after the start date' : '',
    categories: f.kind === 'item' && f.scope === 'category' && !f.categories.length ? 'Pick at least one category' : '',
    itemIds: f.kind === 'item' && f.scope === 'items' && !f.itemIds.length ? 'Pick at least one item' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');
  const save = () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return toast('error', 'A few details are missing', 'Check the highlighted fields.');
    if (modal?.id) update.mutate({ id: modal.id, b: body(f) }, { onSuccess: () => setModal(null) });
    else create.mutate(body(f), { onSuccess: () => setModal(null) });
  };
  const toggle = (o: Offer) => update.mutate({ id: o.id, b: { ...o, active: !o.active } });
  const shownItems = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.barcode.includes(q)).slice(0, 80);

  return (
    <>
      {canEdit && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="small muted" style={{ marginRight: 4 }}><Sparkles size={14} style={{ verticalAlign: -2 }} /> Start an offer:</span>
            {PRESETS.map((p) => <button key={p.label} className="chip-btn" onClick={() => open(undefined, p)}>{p.label}</button>)}
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => open()}><Plus size={15} /> New offer</button>
          </div>
        </div>
      )}
      <div className="card table-wrap">
        {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 120 }} /></div> : offers.length === 0 ? (
          <EmptyState icon={Gift} title="No offers yet" text="Create a festival offer once: it applies by itself at the counter between its dates, and its message prints on the bill."
            action={canEdit ? <button className="btn btn-primary" onClick={() => open(undefined, PRESETS[0])}><Plus size={15} /> Diwali offer</button> : undefined} />
        ) : (
          <table className="table">
            <thead><tr><th>Offer</th><th>What the customer gets</th><th>Dates</th><th>Status</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {offers.map((o) => {
                const st = offerStatus(o, today);
                return (
                  <tr key={o.id} style={st === 'Ended' || st === 'Paused' ? { opacity: 0.7 } : undefined}>
                    <td className="strong">{o.name}{o.message && <div className="muted small">“{o.message}”</div>}</td>
                    <td>{describeOffer(o)}</td>
                    <td>{fmtDate(o.startsOn)} – {fmtDate(o.endsOn)}</td>
                    <td><Badge tone={TONE[st]}>{st}</Badge></td>
                    {canEdit && (
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        <button className="icon-btn" title={o.active ? 'Pause' : 'Resume'} onClick={() => toggle(o)}>{o.active ? <Pause size={15} /> : <Play size={15} />}</button>
                        <button className="icon-btn" title="Edit" onClick={() => open(o)}><Pencil size={15} /></button>
                        <button className="icon-btn" title="Archive" onClick={() => setArchive(o)}><Archive size={15} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        A line gets the bigger of the discount typed on it and the best item offer; offers do not add up on one line. Only the best bill offer applies. The cashier can take an offer off one bill.
      </p>

      <Modal open={!!modal} onClose={() => setModal(null)} size="lg" title={modal?.id ? 'Edit offer' : 'New offer'}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending || update.isPending} onClick={save}>{(create.isPending || update.isPending) && <Loader2 size={15} className="spin" />} Save offer</button></>}>
        <div className="form-grid cols-2">
          <Field label="Offer name" required error={e('name')} className="span-all">
            <input id="offer-name" className="input" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder="e.g. Diwali offer" autoFocus />
          </Field>
          <Field label="Offer on" className="span-all">
            <Segmented value={f.kind} onChange={(k) => setF({ ...f, kind: k, discountKind: k === 'item' ? 'percent' : f.discountKind })}
              options={[{ value: 'item', label: 'Items (a % off)' }, { value: 'bill', label: 'Whole bill' }]} />
          </Field>
          <Field label="Discount" required error={e('value')}>
            <div className="row" style={{ gap: 8 }}>
              <input id="offer-value" className="input" type="number" min={0} value={f.value} onChange={(ev) => setF({ ...f, value: ev.target.value })} style={{ maxWidth: 140 }} />
              {f.kind === 'bill' ? <Segmented value={f.discountKind} onChange={(d) => setF({ ...f, discountKind: d })} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '₹' }]} /> : <span className="muted">% off</span>}
            </div>
          </Field>
          {f.kind === 'bill' ? (
            <Field label="Bills of at least" hint="Leave empty for every bill">
              <div className="input-addon"><span>₹</span><input id="offer-min" className="input" type="number" min={0} value={f.minBill} onChange={(ev) => setF({ ...f, minBill: ev.target.value })} placeholder="e.g. 2000" /></div>
            </Field>
          ) : (
            <Field label="For">
              <select id="offer-scope" className="select" value={f.scope} onChange={(ev) => setF({ ...f, scope: ev.target.value as Draft['scope'] })}>
                <option value="all">Every item</option>
                <option value="category" disabled={!categories.length}>Some categories{!categories.length ? ' (no categories yet)' : ''}</option>
                <option value="items">Chosen items</option>
              </select>
            </Field>
          )}
          {f.kind === 'item' && f.scope === 'category' && (
            <Field label="Categories" error={e('categories')} className="span-all">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {categories.map((c) => {
                  const on = f.categories.includes(c);
                  return <button key={c} type="button" className={`chip-btn ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, categories: on ? f.categories.filter((x) => x !== c) : [...f.categories, c] })}>{c}</button>;
                })}
              </div>
            </Field>
          )}
          {f.kind === 'item' && f.scope === 'items' && (
            <Field label={`Items (${f.itemIds.length} chosen)`} error={e('itemIds')} className="span-all">
              <div className="input-group" style={{ marginBottom: 8 }}><span className="lead"><Search size={15} /></span><input className="input" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search by name or barcode" /></div>
              <div className="offer-items">
                {shownItems.map((i) => {
                  const on = f.itemIds.includes(i.id);
                  return (
                    <label key={i.id} className="offer-item">
                      <input type="checkbox" checked={on} onChange={() => setF({ ...f, itemIds: on ? f.itemIds.filter((x) => x !== i.id) : [...f.itemIds, i.id] })} />
                      <span>{i.name}</span><span className="muted small" style={{ marginLeft: 'auto' }}>{money(i.sp1)}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}
          <Field label="Starts on"><input id="offer-start" className="input" type="date" value={f.startsOn} onChange={(ev) => setF({ ...f, startsOn: ev.target.value })} /></Field>
          <Field label="Ends on" error={e('endsOn')}><input id="offer-end" className="input" type="date" value={f.endsOn} onChange={(ev) => setF({ ...f, endsOn: ev.target.value })} /></Field>
          <Field label="Message on the bill" hint="Printed on every bill that gets this offer" className="span-all">
            <input id="offer-message" className="input" maxLength={140} value={f.message} onChange={(ev) => setF({ ...f, message: ev.target.value })} placeholder="e.g. Happy Diwali! 10% off all toys" />
          </Field>
          <Field label="Running" className="span-all"><Toggle checked={f.active} onChange={(a) => setF({ ...f, active: a })} label={<span className="small">{f.active ? 'Applies between its dates' : 'Paused: does not apply'}</span>} /></Field>
        </div>
        {v > 0 && <div className="offer-preview"><Gift size={15} /> {describeOffer({ ...f, value: v, minBill: Number(f.minBill || 0) })}, {fmtDate(f.startsOn)} to {fmtDate(f.endsOn)}.</div>}
      </Modal>
      <ConfirmModal open={!!archive} onClose={() => setArchive(null)} title="Archive this offer?" confirmLabel="Archive"
        text={`“${archive?.name}” stops applying and leaves this list. Bills that used it keep it.`} onConfirm={() => remove.mutate(archive!.id)} />
    </>
  );
}

interface PointsRow { id: string; name: string; phone: string; points: number; lastAt: string }

function LoyaltyTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data: saved } = useQuery({ queryKey: ['loyalty-settings'], queryFn: () => api.get<LoyaltySettings>('/shop/loyalty/settings') });
  const { data: rows = [] } = useQuery({ queryKey: ['loyalty-customers'], queryFn: () => api.get<PointsRow[]>('/shop/loyalty/customers') });
  const [draft, setDraft] = useState<Record<keyof LoyaltySettings, string | boolean> | null>(null);
  const s = withLoyaltyDefaults(saved);
  const d = draft ?? { enabled: s.enabled, earnPer100: String(s.earnPer100), pointValue: String(s.pointValue), minRedeem: String(s.minRedeem), maxRedeemPct: String(s.maxRedeemPct) };
  const set = (k: keyof LoyaltySettings, val: string | boolean) => setDraft({ ...d, [k]: val });
  const saveIt = useMut((b: LoyaltySettings) => api.put<LoyaltySettings>('/shop/loyalty/settings', b), [['loyalty-settings']], { success: 'Loyalty settings saved' });
  const [adjust, setAdjust] = useState<PointsRow | null>(null);
  const [adj, setAdj] = useState({ points: '', note: '' });
  const doAdjust = useMut((v: { id: string; points: number; note: string }) => api.post(`/shop/loyalty/customers/${v.id}/adjust`, { points: v.points, note: v.note }), [['loyalty-customers'], ['loyalty']], { success: 'Points updated' });
  const num = (k: keyof LoyaltySettings) => Number(d[k]);
  const example = Math.floor((1000 * num('earnPer100')) / 100);

  const save = () => {
    const b: LoyaltySettings = { enabled: !!d.enabled, earnPer100: num('earnPer100'), pointValue: num('pointValue'), minRedeem: Math.round(num('minRedeem')), maxRedeemPct: num('maxRedeemPct') };
    if (!(b.pointValue > 0) || b.earnPer100 < 0 || !(b.maxRedeemPct >= 1 && b.maxRedeemPct <= 100)) return toast('error', 'Check the numbers', 'A point must be worth something, and the bill share must be between 1 and 100%.');
    saveIt.mutate(b, { onSuccess: () => setDraft(null) });
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 15 }}><Star size={15} style={{ verticalAlign: -2 }} /> Loyalty rules</h3>
          <Toggle checked={!!d.enabled} disabled={!canEdit} onChange={(v) => set('enabled', v)} label={<span className="small">{d.enabled ? 'On' : 'Off'}</span>} />
        </div>
        <div className="form-grid cols-2">
          <Field label="Points for every ₹100 paid"><input id="loy-earn" className="input" type="number" min={0} step="0.5" disabled={!canEdit} value={String(d.earnPer100)} onChange={(e) => set('earnPer100', e.target.value)} /></Field>
          <Field label="One point is worth"><div className="input-addon"><span>₹</span><input id="loy-value" className="input" type="number" min={0} step="0.25" disabled={!canEdit} value={String(d.pointValue)} onChange={(e) => set('pointValue', e.target.value)} /></div></Field>
          <Field label="Points can be used from"><input id="loy-min" className="input" type="number" min={0} disabled={!canEdit} value={String(d.minRedeem)} onChange={(e) => set('minRedeem', e.target.value)} /></Field>
          <Field label="Points pay at most (% of a bill)"><input id="loy-max" className="input" type="number" min={1} max={100} disabled={!canEdit} value={String(d.maxRedeemPct)} onChange={(e) => set('maxRedeemPct', e.target.value)} /></Field>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Example: a customer who pays ₹1,000 earns {example} point{example === 1 ? '' : 's'}, worth {money(example * num('pointValue'))} on a later bill.
          Points are earned on bills for a saved customer (not walk-in sales). Cancelling a bill undoes its points; a return takes back the points earned on what came back.
        </p>
        {canEdit && <button className="btn btn-primary mt-16" disabled={saveIt.isPending} onClick={save}>{saveIt.isPending && <Loader2 size={15} className="spin" />} Save rules</button>}
      </div>
      <div className="card table-wrap">
        <div style={{ padding: '14px 16px 6px' }} className="strong">Customers with points</div>
        {rows.length === 0 ? <div className="muted small" style={{ padding: '6px 16px 16px' }}>No points yet. They appear here after the first bill for a saved customer.</div> : (
          <table className="table">
            <thead><tr><th>Customer</th><th className="num">Points</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{r.name}<div className="muted small">{r.phone}</div></td>
                  <td className="num strong">{r.points}<div className="muted small">{money(r.points * s.pointValue)}</div></td>
                  {canEdit && <td className="num"><button className="btn btn-secondary btn-sm" onClick={() => { setAdjust(r); setAdj({ points: '', note: '' }); }}>Adjust</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Adjust points · ${adjust?.name ?? ''}`} subtitle={`Now ${adjust?.points ?? 0} points`}
        footer={<><button className="btn btn-secondary" onClick={() => setAdjust(null)}>Cancel</button><button className="btn btn-primary" disabled={doAdjust.isPending || !Number(adj.points) || !adj.note.trim()} onClick={() => doAdjust.mutate({ id: adjust!.id, points: Math.round(Number(adj.points)), note: adj.note.trim() }, { onSuccess: () => setAdjust(null) })}>Save</button></>}>
        <div className="form-grid cols-2">
          <Field label="Points to add" hint="Use a minus sign to take away, e.g. −20"><input id="adj-points" className="input" type="number" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} autoFocus /></Field>
          <Field label="Reason" required><input id="adj-note" className="input" maxLength={200} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="e.g. Birthday gift" /></Field>
        </div>
      </Modal>
    </div>
  );
}
