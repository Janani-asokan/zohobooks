import { useEffect, useState } from 'react';
import { Layers, Save, Users, GitBranch, FileText } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, usePlans } from '@/api/hooks';
import type { Plan } from '@/api/types';
import { Field, PageHeader } from '@/components/ui';

function PlanCard({ plan }: { plan: Plan }) {
  const [p, setP] = useState(plan);
  useEffect(() => setP(plan), [plan]);
  const save = useMut((b: Plan) => api.put<Plan>(`/platform/plans/${b.id}`, { pricePerYear: b.pricePerYear, maxUsers: b.maxUsers, maxBranches: b.maxBranches, maxInvoicesPerMonth: b.maxInvoicesPerMonth }), [['platform']], { success: `${plan.name} plan updated` });
  const dirty = JSON.stringify(p) !== JSON.stringify(plan);
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <section className="card">
      <div className="card-header">
        <div className="row" style={{ gap: 12 }}>
          <span className={`stat-icon ${plan.id === 'premium' ? 'tone-violet' : plan.id === 'trial' ? 'tone-amber' : 'tone-blue'}`}><Layers size={18} /></span>
          <div><h3>{plan.name}</h3><p>{plan.trialDays ? `${plan.trialDays}-day free trial` : 'Annual license'}</p></div>
        </div>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Price per year (₹)">
            <div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={p.pricePerYear} disabled={!!plan.trialDays} onChange={(e) => setP({ ...p, pricePerYear: num(e.target.value) })} /></div>
          </Field>
          <Field label={<span className="row" style={{ gap: 6 }}><Users size={13} /> Max users</span>}>
            <input className="input" type="number" min={1} value={p.maxUsers} onChange={(e) => setP({ ...p, maxUsers: Math.max(1, num(e.target.value)) })} />
          </Field>
          <Field label={<span className="row" style={{ gap: 6 }}><GitBranch size={13} /> Max branches</span>}>
            <input className="input" type="number" min={1} value={p.maxBranches} onChange={(e) => setP({ ...p, maxBranches: Math.max(1, num(e.target.value)) })} />
          </Field>
          <Field label={<span className="row" style={{ gap: 6 }}><FileText size={13} /> Invoices / month</span>} hint="Leave empty for unlimited">
            <input className="input" type="number" min={1} value={p.maxInvoicesPerMonth ?? ''} placeholder="Unlimited" onChange={(e) => setP({ ...p, maxInvoicesPerMonth: e.target.value ? Math.max(1, num(e.target.value)) : null })} />
          </Field>
        </div>
      </div>
      <div className="card-footer">
        <button className="btn btn-ghost" disabled={!dirty} onClick={() => setP(plan)}>Discard</button>
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(p)}><Save size={15} /> Save Changes</button>
      </div>
    </section>
  );
}

export default function Plans() {
  const { data = [] } = usePlans();
  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader title="Plans & limits" subtitle="Limits are enforced by the server when shops add users, branches or invoices. Price changes apply to new purchases and renewals." />
      <div className="stack">{data.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
    </div>
  );
}
