import { useState } from 'react';
import { Plus, ShoppingBag, Truck, CheckCircle2, Loader2 } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBankAccounts, useBills, useMut, useVendors } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { Badge, EmptyState, Field, Modal, PageHeader, StatCard } from '@/components/ui';
import { addDays, fmtDate, initials, money, todayISO } from '@/lib/format';
import { daysUntil } from '@/lib/fy';
import { GSTIN_RE, INDIAN_STATES } from '../../../shared/gst';

export default function Purchases() {
  const me = useShopUser();
  const { t } = usePrefs();
  const canWrite = me.can('purchases.write');
  const vendors = useVendors().data ?? [];
  const bills = useBills().data ?? [];
  const accounts = useBankAccounts().data ?? [];
  const [tab, setTab] = useState<'bills' | 'vendors'>('bills');
  const [billOpen, setBillOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [payBill, setPayBill] = useState<{ id: string; number: string; amount: number } | null>(null);
  const [payAccount, setPayAccount] = useState('');
  const [bill, setBill] = useState({ vendorId: '', vendorBillNo: '', date: todayISO(), dueDate: addDays(todayISO(), 30), taxableAmount: '', taxAmount: '', description: '' });
  const [vendor, setVendor] = useState({ name: '', gstin: '', phone: '', email: '', state: 'Tamil Nadu' });
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});

  const keys = [['bills'], ['vendors'], ['bankAccounts'], ['bankTxns'], ['notifications']];
  const createBill = useMut((b: Record<string, unknown>) => api.post('/shop/bills', b), keys, { success: 'Bill recorded', silentError: true });
  const createVendor = useMut((b: Record<string, unknown>) => api.post('/shop/vendors', b), keys, { success: 'Vendor added', silentError: true });
  const pay = useMut((v: { id: string; accountId: string }) => api.post(`/shop/bills/${v.id}/pay`, { accountId: v.accountId, date: todayISO() }), keys, { success: 'Bill paid' });

  const open = bills.filter((b) => b.status === 'Open');
  const overdue = open.filter((b) => daysUntil(b.dueDate) < 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const itc = bills.filter((b) => b.date >= monthStart).reduce((s, b) => s + b.taxAmount, 0);

  const billErr = { vendorId: !bill.vendorId ? 'Select a vendor' : '', taxableAmount: !(Number(bill.taxableAmount) > 0) ? 'Enter amount' : '', dueDate: bill.dueDate < bill.date ? 'Due date can’t be before bill date' : '' };
  const vendErr = { name: !vendor.name.trim() ? 'Vendor name is required' : '', gstin: vendor.gstin && !GSTIN_RE.test(vendor.gstin) ? 'Invalid GSTIN' : '' };
  const err = (o: Record<string, string>, k: string) => (touched ? o[k] : '') || serverErr[k] || '';

  return (
    <div className="page">
      <PageHeader title={t('nav.purchases')} subtitle="Vendors, purchase bills and the GST input credit they carry."
        actions={canWrite && (
          <>
            <button className="btn btn-secondary" onClick={() => { setVendor({ name: '', gstin: '', phone: '', email: '', state: 'Tamil Nadu' }); setTouched(false); setServerErr({}); setVendorOpen(true); }}><Truck size={16} /> New Vendor</button>
            <button className="btn btn-primary" onClick={() => { setBill({ vendorId: '', vendorBillNo: '', date: todayISO(), dueDate: addDays(todayISO(), 30), taxableAmount: '', taxAmount: '', description: '' }); setTouched(false); setServerErr({}); setBillOpen(true); }}><Plus size={16} /> New Bill</button>
          </>
        )} />
      <div className="stat-grid">
        <StatCard label="Total payables" value={money(open.reduce((s, b) => s + b.amount, 0))} icon={ShoppingBag} tone="blue" foot={<>{open.length} open bills</>} />
        <StatCard label="Overdue bills" value={money(overdue.reduce((s, b) => s + b.amount, 0))} icon={ShoppingBag} tone="red" foot={<>{overdue.length} past due</>} />
        <StatCard label="Input tax credit (this month)" value={money(itc)} icon={CheckCircle2} tone="green" foot="GST on purchase bills · used in GSTR-3B" />
        <StatCard label="Vendors" value={vendors.length} icon={Truck} tone="violet" foot="Active suppliers" />
      </div>

      <div className="card mt-16">
        <div style={{ padding: '0 16px' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            <button className={tab === 'bills' ? 'active' : ''} onClick={() => setTab('bills')}>Bills <span className="count">{bills.length}</span></button>
            <button className={tab === 'vendors' ? 'active' : ''} onClick={() => setTab('vendors')}>Vendors <span className="count">{vendors.length}</span></button>
          </div>
        </div>
        <div className="table-wrap" style={{ borderTop: '1px solid var(--border)' }}>
          {tab === 'bills' ? (
            bills.length === 0 ? <EmptyState icon={ShoppingBag} title="No bills yet" text="Record purchase bills from your vendors." /> : (
              <table className="table">
                <thead><tr><th>{t('common.date')}</th><th>Bill #</th><th>Vendor</th><th>Description</th><th>Due</th><th>{t('common.status')}</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">{t('common.total')}</th><th /></tr></thead>
                <tbody>
                  {bills.map((b) => {
                    const st = b.status === 'Open' && daysUntil(b.dueDate) < 0 ? 'Overdue' : b.status;
                    return (
                      <tr key={b.id}>
                        <td>{fmtDate(b.date)}</td>
                        <td className="strong">{b.number}{b.vendorBillNo && <div className="muted">Vendor # {b.vendorBillNo}</div>}</td>
                        <td>{b.vendorName}</td>
                        <td className="muted">{b.description || '—'}</td>
                        <td className="muted">{fmtDate(b.dueDate)}</td>
                        <td><Badge>{st}</Badge></td>
                        <td className="num">{money(b.taxableAmount)}</td>
                        <td className="num muted">{money(b.taxAmount)}</td>
                        <td className="num strong">{money(b.amount)}</td>
                        <td className="num">{b.status === 'Open' && canWrite && <button className="btn btn-secondary btn-sm" onClick={() => { setPayBill(b); setPayAccount(accounts.find((a) => a.type === 'Bank')?.id ?? accounts[0]?.id ?? ''); }}><CheckCircle2 size={14} /> Pay</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : vendors.length === 0 ? <EmptyState icon={Truck} title="No vendors yet" text="Add the suppliers you buy from." /> : (
            <table className="table">
              <thead><tr><th>Vendor</th><th>GSTIN</th><th>State</th><th>Contact</th><th className="num">Payables</th></tr></thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td><div className="name-cell"><span className="avatar">{initials(v.name)}</span><span className="title">{v.name}</span></div></td>
                    <td><span className="chip mono">{v.gstin || 'Unregistered'}</span></td>
                    <td className="muted">{v.state || '—'}</td>
                    <td><div className="small">{v.phone}</div><div className="muted">{v.email}</div></td>
                    <td className="num strong">{money(v.payable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={billOpen} onClose={() => setBillOpen(false)} title="New bill" footer={<><button className="btn btn-secondary" onClick={() => setBillOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={createBill.isPending} onClick={() => {
        setTouched(true); setServerErr({});
        if (Object.values(billErr).some(Boolean)) return;
        createBill.mutate({ ...bill, taxableAmount: Number(bill.taxableAmount), taxAmount: Number(bill.taxAmount || 0) }, { onSuccess: () => setBillOpen(false), onError: (e) => setServerErr(fieldErrors(e)) });
      }}>{createBill.isPending && <Loader2 size={15} className="spin" />} Save bill</button></>}>
        <div className="form-grid">
          <Field label="Vendor" required error={err(billErr, 'vendorId')} className="span-all">
            <select className={`select ${err(billErr, 'vendorId') ? 'invalid' : ''}`} value={bill.vendorId} onChange={(e) => setBill({ ...bill, vendorId: e.target.value })}><option value="">Select vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gstin ? '' : ' (unregistered)'}</option>)}</select>
          </Field>
          <Field label="Vendor’s bill number"><input className="input" value={bill.vendorBillNo} onChange={(e) => setBill({ ...bill, vendorBillNo: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={bill.description} onChange={(e) => setBill({ ...bill, description: e.target.value })} /></Field>
          <Field label="Bill date"><input className="input" type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></Field>
          <Field label="Due date" error={err(billErr, 'dueDate')}><input className="input" type="date" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} /></Field>
          <Field label="Taxable value" required error={err(billErr, 'taxableAmount')}><div className="input-addon"><span>₹</span><input className={`input ${err(billErr, 'taxableAmount') ? 'invalid' : ''}`} type="number" value={bill.taxableAmount} onChange={(e) => setBill({ ...bill, taxableAmount: e.target.value })} /></div></Field>
          <Field label="GST on bill" hint="Claimed as input tax credit if the vendor has a GSTIN"><div className="input-addon"><span>₹</span><input className="input" type="number" value={bill.taxAmount} onChange={(e) => setBill({ ...bill, taxAmount: e.target.value })} /></div></Field>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Total: <strong>{money(Number(bill.taxableAmount || 0) + Number(bill.taxAmount || 0))}</strong></p>
      </Modal>

      <Modal open={vendorOpen} onClose={() => setVendorOpen(false)} title="New vendor" footer={<><button className="btn btn-secondary" onClick={() => setVendorOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={createVendor.isPending} onClick={() => {
        setTouched(true); setServerErr({});
        if (Object.values(vendErr).some(Boolean)) return;
        createVendor.mutate(vendor, { onSuccess: () => setVendorOpen(false), onError: (e) => setServerErr(fieldErrors(e)) });
      }}>Save vendor</button></>}>
        <div className="form-grid">
          <Field label="Vendor name" required error={err(vendErr, 'name')} className="span-all"><input className={`input ${err(vendErr, 'name') ? 'invalid' : ''}`} value={vendor.name} onChange={(e) => setVendor({ ...vendor, name: e.target.value })} autoFocus /></Field>
          <Field label="GSTIN" error={err(vendErr, 'gstin')}><input className={`input ${err(vendErr, 'gstin') ? 'invalid' : ''}`} value={vendor.gstin} maxLength={15} onChange={(e) => setVendor({ ...vendor, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="State"><select className="select" value={vendor.state} onChange={(e) => setVendor({ ...vendor, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Phone"><input className="input" value={vendor.phone} onChange={(e) => setVendor({ ...vendor, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={vendor.email} onChange={(e) => setVendor({ ...vendor, email: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!payBill} onClose={() => setPayBill(null)} title={`Pay ${payBill?.number}`} subtitle={payBill ? `${money(payBill.amount)} will be withdrawn from the chosen account.` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setPayBill(null)}>Cancel</button><button className="btn btn-primary" disabled={!payAccount || pay.isPending} onClick={() => pay.mutate({ id: payBill!.id, accountId: payAccount }, { onSuccess: () => setPayBill(null) })}>Mark as paid</button></>}>
        <Field label="Pay from"><select className="select" value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}</select></Field>
      </Modal>
    </div>
  );
}
