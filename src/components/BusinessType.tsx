import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Store } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, useOrg } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { Badge, Field, Modal } from '@/components/ui';
import { FEATURES } from '../../shared/features';
import type { BusinessTemplate } from '../../shared/templates';

interface ApplyResult { fieldsAdded: string[]; unitsAdded: string[]; itemsAdded: number; itemsSkipped: number; printUpdated: boolean }

/**
 * Business profile: which kind of business this is. Choosing one adds that trade's item fields, units and common
 * items, and can set the receipt paper. It only adds; nothing the shop already has is changed or removed.
 */
export function BusinessTypeCard() {
  const me = useShopUser();
  const org = useOrg().data;
  const templates = useQuery({ queryKey: ['business-templates'], queryFn: () => api.get<BusinessTemplate[]>('/shop/business-templates'), staleTime: Infinity }).data ?? [];
  const [pick, setPick] = useState<{ key: string; samples: boolean; printLayout: boolean } | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const apply = useMut((p: NonNullable<typeof pick>) => api.post<{ result: ApplyResult }>('/shop/organization/business-type', p), [['org'], ['items'], ['itemFacets'], ['printSettings']], {
    success: (r) => [
      'Done.', r.result.itemsAdded ? `${r.result.itemsAdded} items added.` : '', r.result.fieldsAdded.length ? `New item fields: ${r.result.fieldsAdded.join(', ')}.` : '',
      r.result.itemsSkipped ? `${r.result.itemsSkipped} items you already had were left as they are.` : '',
    ].filter(Boolean).join(' '),
  });
  const saveDetails = useMut((d: Record<string, string>) => api.put('/shop/organization', { ...org, tradeDetails: d }), [['org']], { success: 'Saved' });
  useEffect(() => { if (org) setDetails(org.tradeDetails ?? {}); }, [org]);
  useEffect(() => { if (window.location.hash === '#business-type') document.getElementById('business-type')?.scrollIntoView({ block: 'center' }); }, []);
  if (!org || !templates.length) return null;
  const current = templates.find((t) => t.key === org.businessType);
  const chosen = pick ? templates.find((t) => t.key === pick.key) : undefined;
  const isAdmin = me.can('admin');

  return (
    <section className="card card-body" id="business-type">
      <div className="row between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="section-title" style={{ marginBottom: 4 }}><Store size={15} /> Business type</div>
          {current ? <><strong>{current.name}</strong><p className="small muted" style={{ margin: '2px 0 0' }}>{current.summary}</p></>
            : <p className="small muted" style={{ margin: 0 }}>Choose what your business sells. We set up the right item fields, units, receipt size and common items for you.</p>}
        </div>
        {isAdmin && <button className={`btn ${current ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setPick({ key: current?.key ?? '', samples: true, printLayout: !current })}>{current ? 'Change' : 'Choose business type'}</button>}
      </div>

      {current && current.tradeDetails.length > 0 && (
        <div className="form-grid mt-16">
          {current.tradeDetails.map((d) => (
            <Field key={d.key} label={d.label} hint={d.help}>
              <input id={`td-${d.key}`} className="input" value={details[d.key] ?? ''} disabled={!isAdmin} onChange={(e) => setDetails({ ...details, [d.key]: e.target.value })} />
            </Field>
          ))}
          {isAdmin && <div className="span-all"><button className="btn btn-secondary btn-sm" disabled={saveDetails.isPending || JSON.stringify(details) === JSON.stringify(org.tradeDetails ?? {})} onClick={() => saveDetails.mutate(details)}>Save details</button></div>}
        </div>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} size="xl" title="What does your business sell?" subtitle="Pick the closest. You can change it later; nothing you already have is removed."
        footer={<><button className="btn btn-secondary" onClick={() => setPick(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen || apply.isPending} onClick={() => pick && apply.mutate(pick, { onSuccess: () => setPick(null) })}>{chosen ? `Set up as ${chosen.name}` : 'Choose a type'}</button></>}>
        {pick && <div className="stack" style={{ gap: 16 }}>
          <div className="bt-grid" role="radiogroup" aria-label="Business type">
            {templates.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={pick.key === t.key} className={`bt-card ${pick.key === t.key ? 'active' : ''}`} onClick={() => setPick({ ...pick, key: t.key })}>
                <strong>{t.name}</strong><span className="small muted">{t.summary}</span>
                {t.key === org.businessType && <Badge tone="green">Current</Badge>}
              </button>
            ))}
          </div>
          {chosen && (
            <div className="bt-preview">
              <div>
                <div className="small strong">This takes care of</div>
                <ul className="feature-includes">{chosen.helps.map((h) => <li key={h}><Check size={14} /> {h}</li>)}</ul>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {chosen.itemFields.length > 0 && <div><div className="small strong">Item fields added</div><div className="small">{chosen.itemFields.map((f) => f.label).join(', ')}</div></div>}
                {chosen.units.length > 0 && <div><div className="small strong">Units</div><div className="small">{chosen.units.join(', ')}</div></div>}
                {chosen.features.length > 0 && <div><div className="small strong">Recommended add-ons</div><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {chosen.features.map((k) => <Badge key={k} tone={me.has(k) ? 'green' : 'gray'}>{FEATURES.find((f) => f.key === k)?.name ?? k}{me.has(k) ? ' · on' : ''}</Badge>)}</div>
                  {chosen.features.some((k) => !me.has(k)) && <div className="small muted" style={{ marginTop: 4 }}>Ask for the ones that are off in Settings → Features.</div>}</div>}
                {chosen.samples.length > 0 && <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={pick.samples} onChange={(e) => setPick({ ...pick, samples: e.target.checked })} />
                  Add {chosen.samples.length} common items ({chosen.samples.slice(0, 3).map((s) => s.name).join(', ')}…). Prices are examples and GST rates are the usual ones: check both before billing.</label>}
                <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={pick.printLayout} onChange={(e) => setPick({ ...pick, printLayout: e.target.checked })} />
                  Use {chosen.thermalPaper === '2in' ? '2-inch (58 mm)' : '3-inch (80 mm)'} receipt paper</label>
              </div>
            </div>
          )}
        </div>}
      </Modal>
    </section>
  );
}
