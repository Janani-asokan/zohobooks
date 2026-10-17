import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Truck, Phone, Mail, ClipboardList, FileText } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBills, useMut, usePurchaseOrders, useVendors } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { Hint, Thumb } from '@/components/kit';
import { money } from '@/lib/format';
import { GSTIN_RE, INDIAN_STATES } from '../../../shared/gst';

const blank = { name: '', gstin: '', phone: '', email: '', state: 'Tamil Nadu' };

export default function Vendors() {
  const me = useShopUser();
  const canWrite = me.can('purchases.write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: vendors = [], isLoading } = useVendors();
  const bills = useBills().data ?? [];
  const orders = usePurchaseOrders().data ?? [];
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const create = useMut((b: typeof blank) => api.post('/shop/vendors', b), [['vendors']], { success: 'Vendor added', silentError: true });

  const start = () => { setVendor(blank); setTouched(false); setServerErr({}); setOpen(true); };
  useEffect(() => { if (params.get('new') && canWrite) { start(); setParams({}, { replace: true }); } }, [params]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vendors.filter((v) => !s || [v.name, v.gstin, v.phone, v.email].some((x) => x.toLowerCase().includes(s)));
  }, [vendors, q]);
  const errs = { name: !vendor.name.trim() ? 'Vendor name is required' : '', gstin: vendor.gstin && !GSTIN_RE.test(vendor.gstin) ? 'Invalid GSTIN (15 characters, e.g. 33ABCDE1234F1Z5)' : '' };
  const err = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const fyStart = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();

  return (
    <div className="page">
      <PageHeader title="Vendors" subtitle="The suppliers you buy from — with what you owe each of them."
        actions={canWrite && <button className="btn btn-primary" onClick={start}><Plus size={16} /> New Vendor</button>} />
      <Hint id="vendors" title="Why add vendors?">
        <p>Vendors are needed for purchase orders, bills and expenses. Add their <strong>GSTIN</strong> so the GST you pay them is counted as input tax credit in GSTR-3B.</p>
      </Hint>
      <div className="stat-grid">
        <StatCard label="Vendors" value={vendors.length} icon={Truck} tone="violet" foot={`${vendors.filter((v) => v.gstin).length} GST registered`} />
        <StatCard label="Total payables" value={money(vendors.reduce((s, v) => s + v.payable, 0))} icon={FileText} tone="red" foot="Open bills across vendors" />
        <StatCard label="Purchases this FY" value={money(bills.filter((b) => b.date >= fyStart).reduce((s, b) => s + b.amount, 0))} icon={ClipboardList} tone="blue" foot="Bills since 1 April" />
        <StatCard label="Open purchase orders" value={orders.filter((o) => o.status === 'Issued' || o.status === 'Partially Received').length} icon={Truck} tone="green" foot="Awaiting goods" />
      </div>

      <div className="card mt-16">
        <div className="toolbar"><div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search vendor, GSTIN, phone…" /></div></div>
        <div className="table-wrap">
          {isLoading ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : rows.length === 0 ? (
            <EmptyState icon={Truck} title={vendors.length ? 'No vendors match' : 'No vendors yet'} text="Add the suppliers you buy from." action={canWrite && <button className="btn btn-primary" onClick={start}><Plus size={15} /> New Vendor</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Vendor</th><th>GSTIN</th><th>State</th><th>Contact</th><th className="num">Bills</th><th className="num">Payables</th><th /></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td><div className="name-cell"><Thumb name={v.name} size={36} /><span className="title">{v.name}</span></div></td>
                    <td>{v.gstin ? <span className="chip mono">{v.gstin}</span> : <span className="muted small">Unregistered</span>}</td>
                    <td className="muted">{v.state || '—'}</td>
                    <td>{v.phone && <div className="small row" style={{ gap: 4 }}><Phone size={12} /> {v.phone}</div>}{v.email && <div className="muted row" style={{ gap: 4 }}><Mail size={12} /> {v.email}</div>}</td>
                    <td className="num">{bills.filter((b) => b.vendorId === v.id).length}</td>
                    <td className="num strong" style={v.payable > 0 ? { color: 'var(--red-600)' } : undefined}>{money(v.payable)}</td>
                    <td className="num">{canWrite && <button className="btn btn-soft btn-sm" onClick={() => navigate('/app/purchases/orders?new=1')}>New PO</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New vendor" footer={<><button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={() => {
        setTouched(true); setServerErr({});
        if (Object.values(errs).some(Boolean)) return;
        create.mutate(vendor, { onSuccess: () => setOpen(false), onError: (e) => setServerErr(fieldErrors(e)) });
      }}>Save vendor</button></>}>
        <div className="form-grid">
          <Field label="Vendor name" required error={err('name')} className="span-all"><input className={`input ${err('name') ? 'invalid' : ''}`} value={vendor.name} onChange={(e) => setVendor({ ...vendor, name: e.target.value })} autoFocus placeholder="e.g. Sri Balaji Distributors" /></Field>
          <Field label="GSTIN" error={err('gstin')} hint="Needed to claim input tax credit"><input className={`input mono ${err('gstin') ? 'invalid' : ''}`} value={vendor.gstin} maxLength={15} onChange={(e) => setVendor({ ...vendor, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="State"><select className="select" value={vendor.state} onChange={(e) => setVendor({ ...vendor, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Phone"><input className="input" value={vendor.phone} onChange={(e) => setVendor({ ...vendor, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={vendor.email} onChange={(e) => setVendor({ ...vendor, email: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
