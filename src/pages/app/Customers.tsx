import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Users, Building2, UserRound, Pencil, Trash2, Lock, Mail, Phone, FileText } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Pagination, SearchInput, usePagination } from '@/components/ui';
import { EMAIL_RE, GSTIN_RE, initials, money, uid } from '@/lib/format';
import { docTotals, effectiveStatus, INDIAN_STATES } from '@/lib/invoice';
import { TIER_LABEL, type Customer, type PriceTier } from '@/lib/types';

type Draft = Omit<Customer, 'id' | 'customId' | 'createdAt'>;
const blank = (state: string): Draft => ({ type: 'Individual', name: '', companyName: '', gstin: '', email: '', phone: '', state, address: '', tier: 'SP1' });

export default function Customers() {
  const { tenant, mutate, nextCustomerId, platform } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<'all' | Customer['type']>('all');
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; c?: Customer } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank(tenant.org.state));
  const [touched, setTouched] = useState(false);
  const [del, setDel] = useState<Customer | null>(null);

  const openNew = () => {
    setDraft(blank(tenant.org.state));
    setTouched(false);
    setModal({ mode: 'new' });
  };
  useEffect(() => {
    if (params.get('new')) {
      openNew();
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []);

  const stats = useMemo(() => {
    const m = new Map<string, { billed: number; due: number; count: number }>();
    for (const inv of tenant.invoices) {
      const t = docTotals(tenant, inv).total;
      const s = m.get(inv.customerId) ?? { billed: 0, due: 0, count: 0 };
      s.billed += t;
      s.count += 1;
      const st = effectiveStatus(inv);
      if (st === 'Unpaid' || st === 'Overdue') s.due += t;
      m.set(inv.customerId, s);
    }
    return m;
  }, [tenant]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenant.customers
      .filter((c) => type === 'all' || c.type === type)
      .filter((c) => !s || [c.name, c.companyName, c.customId, c.email, c.phone, c.gstin].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tenant.customers, q, type]);
  const pg = usePagination(rows, 8);

  const errs = {
    name: !draft.name.trim() ? 'Contact name is required' : '',
    companyName: draft.type === 'Business' && !draft.companyName.trim() ? 'Company name is required' : '',
    gstin: draft.type === 'Business' ? (!draft.gstin ? 'GST number is required for business customers' : !GSTIN_RE.test(draft.gstin) ? 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)' : '') : '',
    email: draft.email && !EMAIL_RE.test(draft.email) ? 'Enter a valid email' : '',
    phone: !draft.phone ? 'Phone is required' : draft.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid phone number' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');

  const save = () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    const clean: Draft = { ...draft, name: draft.name.trim(), companyName: draft.type === 'Business' ? draft.companyName.trim() : '', gstin: draft.type === 'Business' ? draft.gstin : '' };
    if (modal?.mode === 'edit' && modal.c) {
      mutate((t) => void Object.assign(t.customers.find((x) => x.id === modal.c!.id)!, clean));
      toast('success', 'Customer updated', clean.companyName || clean.name);
    } else {
      const customId = nextCustomerId();
      mutate((t) => {
        t.counters.customer += 1;
        t.customers.unshift({ ...clean, id: uid('cu_'), customId, createdAt: new Date().toISOString() });
      });
      toast('success', 'Customer added', `${clean.companyName || clean.name} · ${customId}`);
    }
    setModal(null);
  };

  const gstStateCode = draft.gstin.slice(0, 2);

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        subtitle="Everyone you sell to — each gets a unique customer ID automatically."
        crumbs={<>Sales <span>/</span> Customers</>}
        actions={<button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New Customer</button>}
      />

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search name, ID, phone, GSTIN…" />
            <div className="segmented">
              {(['all', 'Individual', 'Business'] as const).map((t) => (
                <button key={t} className={type === t ? 'active' : ''} onClick={() => { setType(t); pg.setPage(1); }}>
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar-right small muted">{tenant.customers.length} customers</div>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <EmptyState icon={Users} title={tenant.customers.length ? 'No customers match' : 'No customers yet'} text="Add individuals or GST-registered businesses." action={<button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Customer</button>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Customer ID</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Price tier</th>
                  <th className="num">Receivables</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((c) => {
                  const s = stats.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="name-cell">
                          <span className="avatar" style={c.type === 'Business' ? { background: 'var(--violet-50)', color: 'var(--violet-600)', borderRadius: 10 } : undefined}>{initials(c.companyName || c.name)}</span>
                          <div>
                            <div className="title">{c.companyName || c.name}</div>
                            <div className="sub">{c.type === 'Business' ? `${c.name} · GSTIN ${c.gstin}` : c.state}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="chip mono">{c.customId}</span></td>
                      <td>{c.type === 'Business' ? <Badge tone="violet" plain>Business</Badge> : <Badge tone="gray" plain>Individual</Badge>}</td>
                      <td>
                        <div className="small row" style={{ gap: 6 }}><Phone size={12} className="muted" /> {c.phone}</div>
                        {c.email && <div className="small row muted" style={{ gap: 6 }}><Mail size={12} /> {c.email}</div>}
                      </td>
                      <td><span className="chip">{c.tier} · {TIER_LABEL[c.tier]}</span></td>
                      <td className="num">
                        <div className="strong">{money(s?.due ?? 0)}</div>
                        <div className="muted">{s?.count ?? 0} invoices</div>
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        <button className="icon-btn" title="New invoice" onClick={() => navigate(`/app/sales/invoices/new?customer=${c.id}`)}><FileText size={15} /></button>
                        <button className="icon-btn" title="Edit" onClick={() => { setDraft({ ...c }); setTouched(false); setModal({ mode: 'edit', c }); }}><Pencil size={15} /></button>
                        <button className="icon-btn danger" title="Delete" disabled={!!s?.count} onClick={() => setDel(c)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination {...pg} />
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="lg"
        title={modal?.mode === 'edit' ? 'Edit customer' : 'New customer'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{modal?.mode === 'edit' ? 'Save changes' : 'Save customer'}</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Customer ID" hint={modal?.mode === 'edit' ? 'IDs are permanent' : `Auto-assigned using the “${platform.customerIdPrefix}” prefix`}>
            <div className="input-group">
              <span className="lead"><Lock size={14} /></span>
              <input className="input" readOnly value={modal?.mode === 'edit' ? modal.c!.customId : nextCustomerId()} style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }} />
            </div>
          </Field>
          <Field label="Default price tier" hint="Applied automatically on invoices">
            <select className="select" value={draft.tier} onChange={(ev) => setDraft({ ...draft, tier: ev.target.value as PriceTier })}>
              {(Object.keys(TIER_LABEL) as PriceTier[]).map((t) => <option key={t} value={t}>{t} — {TIER_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Customer type" className="span-all">
            <div className="radio-cards">
              {(
                [
                  ['Individual', 'Individual', 'Walk-in / retail customer', UserRound],
                  ['Business', 'Business', 'GST-registered company (B2B)', Building2],
                ] as const
              ).map(([v, t, s, Icon]) => (
                <div key={v} className={`radio-card ${draft.type === v ? 'active' : ''}`} onClick={() => setDraft({ ...draft, type: v })}>
                  <span className="dot" />
                  <div>
                    <strong className="row" style={{ gap: 6 }}><Icon size={14} /> {t}</strong>
                    <span>{s}</span>
                  </div>
                </div>
              ))}
            </div>
          </Field>

          {draft.type === 'Business' && (
            <>
              <Field label="Company name" required error={e('companyName')}>
                <input className={`input ${e('companyName') ? 'invalid' : ''}`} value={draft.companyName} onChange={(ev) => setDraft({ ...draft, companyName: ev.target.value })} placeholder="e.g. Nila Textiles" />
              </Field>
              <Field label="GST number (GSTIN)" required error={e('gstin')} hint={GSTIN_RE.test(draft.gstin) ? `State code ${gstStateCode}` : '15-character GSTIN'}>
                <input className={`input ${e('gstin') ? 'invalid' : ''}`} value={draft.gstin} maxLength={15} onChange={(ev) => setDraft({ ...draft, gstin: ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} placeholder="33AABCA1234F1Z5" style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '.04em' }} />
              </Field>
            </>
          )}

          <Field label={draft.type === 'Business' ? 'Contact person' : 'Full name'} required error={e('name')}>
            <input className={`input ${e('name') ? 'invalid' : ''}`} value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} autoFocus />
          </Field>
          <Field label="Phone" required error={e('phone')}>
            <input className={`input ${e('phone') ? 'invalid' : ''}`} value={draft.phone} onChange={(ev) => setDraft({ ...draft, phone: ev.target.value })} placeholder="+91 98xxx xxxxx" />
          </Field>
          <Field label="Email" error={e('email')}>
            <input className={`input ${e('email') ? 'invalid' : ''}`} value={draft.email} onChange={(ev) => setDraft({ ...draft, email: ev.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="State (place of supply)" hint={draft.state && draft.state !== tenant.org.state ? 'Inter-state → IGST applies' : 'Intra-state → CGST + SGST'}>
            <select className="select" value={draft.state} onChange={(ev) => setDraft({ ...draft, state: ev.target.value })}>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Billing address" className="span-all">
            <textarea className="textarea" value={draft.address} onChange={(ev) => setDraft({ ...draft, address: ev.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmModal
        open={!!del}
        onClose={() => setDel(null)}
        title="Delete customer?"
        text={<>{del?.companyName || del?.name} ({del?.customId}) will be removed. Their ID won’t be reused.</>}
        onConfirm={() => {
          mutate((t) => void (t.customers = t.customers.filter((x) => x.id !== del!.id)));
          toast('success', 'Customer deleted');
        }}
      />
    </div>
  );
}
