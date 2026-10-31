import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Plus, Settings2 } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import { LENDING_KEYS, useLendingSettings } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, Field, PageHeader, Toggle } from '@/components/ui';

/** Switch the module on or off and manage the areas borrowers are grouped by. */
export default function LendingSettings() {
  const me = useShopUser();
  const s = useLendingSettings().data;
  const [area, setArea] = useState({ code: '', name: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const toggle = useMut((enabled: boolean) => api.put('/shop/lending/enabled', { enabled }), [...LENDING_KEYS, ['organization']], { success: (_r, v) => (v ? 'Microfinance management switched on' : 'Microfinance management switched off') });
  const add = useMut((b: { code: string; name: string }) => api.post('/shop/lending/areas', b), LENDING_KEYS, { success: (_r, b) => `Area ${b.code} added`, silentError: true });
  const patch = useMut((v: { code: string; active?: boolean; name?: string }) => api.patch(`/shop/lending/areas/${v.code}`, v), LENDING_KEYS, { success: 'Area updated' });
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHeader title="Microfinance settings" crumbs={<><Link to="/app/microfinance">Microfinance</Link> <span>/</span> Settings</>} icon={Settings2} />
      {me.can('admin') && (
        <section className="card card-body">
          <Toggle checked={!!s?.enabled} onChange={(v) => toggle.mutate(v)} label={<span><strong>Microfinance management</strong> <span className="muted small">Borrowers, loans and collections for this business. Switching off hides the module; nothing is deleted.</span></span>} />
          {!s?.aadhaarAvailable && <p className="small muted" style={{ marginTop: 10 }}>Aadhaar storage needs the <code>AADHAAR_KEY</code> setting on the server. Until then borrowers are registered without Aadhaar.</p>}
        </section>
      )}
      <section className="card mt-16">
        <div className="card-header"><div><h3><MapPin size={16} /> Areas</h3><p>Borrower codes start with the area code, like KUN001. Dashboards and reports group by area.</p></div></div>
        <table className="table"><tbody>{(s?.areas ?? []).map((a) => (
          <tr key={a.code}><td className="strong" style={{ width: 90 }}>{a.code}</td><td>{a.name}</td><td>{a.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
            <td className="num">{me.can('lending.write') && <button className="btn btn-ghost btn-sm" onClick={() => patch.mutate({ code: a.code, active: !a.active })}>{a.active ? 'Deactivate' : 'Activate'}</button>}</td></tr>
        ))}</tbody></table>
        {me.can('lending.write') && (
          <div className="card-body row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
            <Field label="Code" error={err.code}><input id="ar-code" className="input" style={{ width: 110 }} maxLength={4} value={area.code} onChange={(e) => setArea({ ...area, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} placeholder="KUN" /></Field>
            <Field label="Name" error={err.name}><input id="ar-name" className="input" style={{ width: 240 }} value={area.name} onChange={(e) => setArea({ ...area, name: e.target.value })} placeholder="Kundi" /></Field>
            <button className="btn btn-secondary" disabled={add.isPending} onClick={() => add.mutate(area, { onSuccess: () => { setArea({ code: '', name: '' }); setErr({}); }, onError: (x) => setErr({ ...fieldErrors(x), code: fieldErrors(x).code ?? x.message }) })}><Plus size={15} /> Add area</button>
          </div>
        )}
      </section>
    </div>
  );
}
