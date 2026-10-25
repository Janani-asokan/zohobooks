import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExportMenu } from '@/components/ExportMenu';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Users, Building2, UserRound, Pencil, Trash2, Lock, Mail, Phone, FileText, Upload, Loader2 } from 'lucide-react';
import { api, download, fieldErrors } from '@/api/client';
import { useCustomers, useMut, useNextCustomerId, useOrg } from '@/api/hooks';
import { TIER_LABEL, type Customer, type PriceTier } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Pagination, SearchInput, usePagination } from '@/components/ui';
import { CsvImport } from '@/components/CsvImport';
import { EMAIL_RE, initials, money } from '@/lib/format';
import { GSTIN_RE, INDIAN_STATES, gstinMatchesState } from '../../../shared/gst';
import { Hint } from '@/components/kit';
import { CustomerPanel } from '@/components/CustomerPanel';
import { SmartUpload, type PendingFile } from '@/components/SmartUpload';
import { attachFile } from '@/components/Attachments';
import { applyParty, partyRows } from '@/lib/partyFill';

type Draft = Pick<Customer, 'type' | 'name' | 'companyName' | 'gstin' | 'email' | 'phone' | 'state' | 'address' | 'tier' | 'creditLimit'>;
const blank = (state: string): Draft => ({ type: 'Individual', name: '', companyName: '', gstin: '', email: '', phone: '', state, address: '', tier: 'SP1', creditLimit: 0 });
const CUSTOMER_TEMPLATE = 'Type,Name,Company,GSTIN,Phone,Email,State,Address,Tier\r\nIndividual,Ravi Kumar,,,9876543210,ravi@example.com,Tamil Nadu,Adyar Chennai 600020,SP1\r\nBusiness,Priya Raman,Nila Textiles,33AAFCN5678K1Z2,9444011223,accounts@nila.in,Tamil Nadu,T. Nagar Chennai 600017,SP2\r\n';

export default function Customers() {
  const me = useShopUser();
  const canWrite = me.can('customers.write');
  const org = useOrg();
  const orgState = org.data?.state ?? 'Tamil Nadu';
  const { data: customers = [], isLoading } = useCustomers();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<'all' | Customer['type']>('all');
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; c?: Customer } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank(orgState));
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Customer | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [custFile, setCustFile] = useState<PendingFile | null>(null);
  const nextId = useNextCustomerId(modal?.mode === 'new');
  const selectedId = params.get('c');
  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const select = (id: string | null) => { if (id) params.set('c', id); else params.delete('c'); setParams(params, { replace: true }); };
  const closePanel = useCallback(() => select(null), [params]);
  const openEdit = (c: Customer) => { setDraft({ type: c.type, name: c.name, companyName: c.companyName, gstin: c.gstin, email: c.email, phone: c.phone, state: c.state, address: c.address, tier: c.tier, creditLimit: c.creditLimit }); setTouched(false); setServerErr({}); setModal({ mode: 'edit', c }); };

  const keys = [['customers'], ['nextCustomerId']];
  const create = useMut((b: Draft) => api.post<Customer>('/shop/customers', b), keys, { silentError: true });
  const update = useMut((v: { id: string; body: Draft }) => api.put<Customer>(`/shop/customers/${v.id}`, v.body), keys, { silentError: true });
  const remove = useMut((id: string) => api.del(`/shop/customers/${id}`), keys, { success: 'Customer deleted' });

  const openNew = () => {
    setDraft(blank(orgState));
    setTouched(false);
    setServerErr({});
    setCustFile(null);
    setModal({ mode: 'new' });
  };
  useEffect(() => {
    if (params.get('new')) {
      openNew();
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .filter((c) => type === 'all' || c.type === type)
      .filter((c) => !s || [c.name, c.companyName, c.customId, c.email, c.phone, c.gstin].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [customers, q, type]);
  const pg = usePagination(rows, 8);

  const errs = {
    name: !draft.name.trim() ? 'Contact name is required' : '',
    companyName: draft.type === 'Business' && !draft.companyName.trim() ? 'Company name is required' : '',
    gstin: draft.type === 'Business' ? (!draft.gstin ? 'GST number is required for business customers' : !GSTIN_RE.test(draft.gstin) ? 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)' : !gstinMatchesState(draft.gstin, draft.state) ? 'GSTIN state code doesn’t match the selected state' : '') : '',
    email: draft.email && !EMAIL_RE.test(draft.email) ? 'Enter a valid email' : '',
    phone: !draft.phone ? 'Phone is required' : draft.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid phone number' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';

  const save = () => {
    setTouched(true);
    setServerErr({});
    if (Object.values(errs).some(Boolean)) return;
    const clean: Draft = { ...draft, name: draft.name.trim(), companyName: draft.type === 'Business' ? draft.companyName.trim() : '', gstin: draft.type === 'Business' ? draft.gstin : '' };
    const onError = (err: Error) => { const f = fieldErrors(err); setServerErr(f); toast('error', Object.keys(f).length ? 'Please fix the highlighted fields' : err.message); };
    if (modal?.mode === 'edit' && modal.c) {
      update.mutate({ id: modal.c.id, body: clean }, { onSuccess: (c) => { toast('success', 'Customer updated', c.companyName || c.name); setModal(null); }, onError });
    } else {
      create.mutate(clean, { onSuccess: (c) => { toast('success', 'Customer added', `${c.companyName || c.name} · ${c.customId}`); setModal(null); if (custFile) void attachFile('customer', c.id, custFile.file.name, custFile.dataUrl).catch(() => undefined); }, onError });
    }
  };

  const gstStateCode = draft.gstin.slice(0, 2);

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        subtitle="Everyone you sell to — each gets a unique customer ID automatically."
        crumbs={<>Sales <span>/</span> Customers</>}
        actions={
          <>
            <ExportMenu disabled={!rows.length} table={() => ({
              title: 'Customers', subtitle: `${rows.length} customers`, filename: 'customers', landscape: true,
              columns: [{ label: 'ID' }, { label: 'Customer' }, { label: 'Type' }, { label: 'GSTIN' }, { label: 'Phone' }, { label: 'Email' }, { label: 'State' }, { label: 'Billed', money: true }, { label: 'Due', money: true }],
              rows: rows.map((c) => ({ cells: [c.customId, c.companyName || c.name, c.type, c.gstin || '', c.phone, c.email, c.state, c.billed, c.due] })),
            })} extra={[{ label: 'CSV for re-import', onClick: () => { download('/shop/customers/export.csv', 'customers.csv').catch((err) => toast('error', err.message)); } }]} />
            {canWrite && <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>}
            {canWrite && <button className="btn btn-primary" onClick={openNew} title="Alt C"><Plus size={16} /> New Customer</button>}
          </>
        }
      />
      <Hint id="customers" title="Customers & price levels">
        <p>Each customer gets an automatic ID (like ACS-1582). Business customers need a <strong>GSTIN</strong> for B2B tax invoices. Pick their <strong>price level</strong> (SP1 Standard, SP2 Loyal, SP3 New) once — invoices use it automatically. The “Due” column shows what they still owe you.</p>
      </Hint>

      <div className={`split-page ${selected ? 'has-detail' : ''}`}>
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
          <div className="toolbar-right small muted">{customers.length} customers</div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : rows.length === 0 ? (
            <EmptyState icon={Users} title={customers.length ? 'No customers match' : 'No customers yet'} text="Add individuals or GST-registered businesses, or import them from a spreadsheet." action={canWrite && <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Customer</button>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="hide-split">Customer ID</th>
                  <th className="hide-split">Type</th>
                  <th className="hide-split">Contact</th>
                  <th className="hide-split">Price tier</th>
                  <th className="num">Receivables</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((c) => {
                  return (
                    <tr key={c.id} className={`row-click ${c.id === selectedId ? 'row-selected' : ''}`} onClick={() => select(c.id === selectedId ? null : c.id)} aria-selected={c.id === selectedId}>
                      <td>
                        <div className="name-cell">
                          <span className="avatar" style={c.type === 'Business' ? { background: 'var(--violet-50)', color: 'var(--violet-600)', borderRadius: 8 } : undefined}>{initials(c.companyName || c.name)}</span>
                          <div>
                            <div className="title">{c.companyName || c.name}</div>
                            <div className="sub">{c.type === 'Business' ? `${c.name} · GSTIN ${c.gstin}` : c.state}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hide-split"><span className="chip mono">{c.customId}</span></td>
                      <td className="hide-split">{c.type === 'Business' ? <Badge tone="violet" plain>Business</Badge> : <Badge tone="gray" plain>Individual</Badge>}</td>
                      <td className="hide-split">
                        <div className="small row" style={{ gap: 6 }}><Phone size={12} className="muted" /> {c.phone}</div>
                        {c.email && <div className="small row muted" style={{ gap: 6 }}><Mail size={12} /> {c.email}</div>}
                      </td>
                      <td className="hide-split"><span className="chip">{c.tier} · {TIER_LABEL[c.tier]}</span></td>
                      <td className="num">
                        <div className="strong">{money(c.due)}</div>
                        <div className="muted">{c.creditLimit > 0 && c.due > c.creditLimit ? <span style={{ color: 'var(--red-600)' }}>Over limit</span> : `${c.invoiceCount} invoices`}</div>
                      </td>
                      <td className="num hide-split" style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                        {me.can('sales.write') && <button className="icon-btn" title="New invoice" onClick={() => navigate(`/app/sales/invoices/new?customer=${c.id}`)}><FileText size={15} /></button>}
                        {canWrite && <button className="icon-btn" title="Edit" onClick={() => openEdit(c)}><Pencil size={15} /></button>}
                        {canWrite && <button className="icon-btn danger" title={c.invoiceCount ? 'Customers with invoices can’t be deleted' : 'Delete'} disabled={c.invoiceCount > 0} onClick={() => setDel(c)}><Trash2 size={15} /></button>}
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
      {selected && <CustomerPanel key={selected.id} customer={selected} onClose={closePanel} onEdit={canWrite ? () => openEdit(selected) : undefined} />}
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="lg"
        title={modal?.mode === 'edit' ? 'Edit customer' : 'New customer'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={create.isPending || update.isPending}>{(create.isPending || update.isPending) && <Loader2 size={15} className="spin" />} {modal?.mode === 'edit' ? 'Save changes' : 'Save customer'}</button>
          </>
        }
      >
        {modal?.mode === 'new' && (
          <div style={{ marginBottom: 16 }}>
            <SmartUpload kind="customer" title="Fill from a GST certificate or visiting card"
              hint="Upload a GST certificate, visiting card, letterhead or their purchase order. Name, GSTIN, phone, email, state and address are filled in."
              toRows={(r) => partyRows(r.data.party, { ...draft }, true)}
              onApply={(keys, r, file) => { setDraft((d) => { const n = applyParty({ ...d }, keys, r.data.party, true); if (n.gstin) n.type = 'Business'; if (n.type === 'Business' && !n.companyName) n.companyName = n.name; return n; }); setCustFile(file); }} />
            {custFile && <div className="small muted" style={{ marginTop: 6 }}>{custFile.file.name} will be kept on the customer.</div>}
          </div>
        )}
        <div className="form-grid">
          <Field label="Customer ID" hint={modal?.mode === 'edit' ? 'IDs are permanent' : `Auto-assigned using the “${me.platform.customerIdPrefix}” prefix`}>
            <div className="input-group">
              <span className="lead"><Lock size={14} /></span>
              <input className="input" readOnly value={modal?.mode === 'edit' ? modal.c!.customId : nextId.data?.customId ?? '…'} style={{ fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace' }} />
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
          <Field label="State (place of supply)" hint={draft.state && draft.state !== orgState ? 'Inter-state → IGST applies' : 'Intra-state → CGST + SGST'}>
            <select className="select" value={draft.state} onChange={(ev) => setDraft({ ...draft, state: ev.target.value })}>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Credit limit" hint="Invoices past this need confirmation. 0 = no limit">
            <div className="input-addon"><span>₹</span><input className="input" type="number" min={0} step={1000} value={draft.creditLimit || ''} placeholder="0" onChange={(ev) => setDraft({ ...draft, creditLimit: Math.max(0, Number(ev.target.value) || 0) })} /></div>
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
        onConfirm={() => remove.mutate(del!.id)}
      />
      <CsvImport open={importOpen} onClose={() => setImportOpen(false)} endpoint="/shop/customers/import" title="Import customers" template={CUSTOMER_TEMPLATE} invalidate={['customers', 'nextCustomerId']} />
    </div>
  );
}
