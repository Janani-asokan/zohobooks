import { useState } from 'react';
import { Plus, ShoppingBag, Truck, CheckCircle2 } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, Field, Modal, PageHeader, StatCard } from '@/components/ui';
import { addDays, fmtDate, GSTIN_RE, initials, money, todayISO, uid } from '@/lib/format';
import { daysUntil } from '@/lib/fy';
import type { Bill, Vendor } from '@/lib/types';

export default function Purchases() {
  const { tenant, mutate } = useTenant();
  const toast = useToast();
  const [tab, setTab] = useState<'bills' | 'vendors'>('bills');
  const [billOpen, setBillOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [bill, setBill] = useState({ vendorId: '', date: todayISO(), dueDate: addDays(todayISO(), 30), amount: '', description: '' });
  const [vendor, setVendor] = useState<Omit<Vendor, 'id'>>({ name: '', gstin: '', phone: '', email: '' });
  const [touched, setTouched] = useState(false);

  const vName = (id: string) => tenant.vendors.find((v) => v.id === id)?.name ?? '—';
  const open = tenant.bills.filter((b) => b.status === 'Open');
  const overdue = open.filter((b) => daysUntil(b.dueDate) < 0);

  const billErr = { vendorId: !bill.vendorId ? 'Select a vendor' : '', amount: !(Number(bill.amount) > 0) ? 'Enter amount' : '' };
  const vendErr = { name: !vendor.name.trim() ? 'Vendor name is required' : '', gstin: vendor.gstin && !GSTIN_RE.test(vendor.gstin) ? 'Invalid GSTIN' : '' };

  const saveBill = () => {
    setTouched(true);
    if (billErr.vendorId || billErr.amount) return;
    mutate((t) => {
      t.counters.bill += 1;
      const b: Bill = { id: uid('bl_'), number: `BILL-${String(t.counters.bill).padStart(4, '0')}`, vendorId: bill.vendorId, date: bill.date, dueDate: bill.dueDate, amount: Number(bill.amount), status: 'Open', description: bill.description };
      t.bills.unshift(b);
    });
    toast('success', 'Bill recorded');
    setBillOpen(false);
  };
  const saveVendor = () => {
    setTouched(true);
    if (vendErr.name || vendErr.gstin) return;
    mutate((t) => void t.vendors.unshift({ ...vendor, id: uid('v_') }));
    toast('success', 'Vendor added', vendor.name);
    setVendorOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Purchases"
        subtitle="Track vendors and the bills you owe them."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => { setVendor({ name: '', gstin: '', phone: '', email: '' }); setTouched(false); setVendorOpen(true); }}><Truck size={16} /> New Vendor</button>
            <button className="btn btn-primary" onClick={() => { setBill({ vendorId: '', date: todayISO(), dueDate: addDays(todayISO(), 30), amount: '', description: '' }); setTouched(false); setBillOpen(true); }}><Plus size={16} /> New Bill</button>
          </>
        }
      />
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <StatCard label="Total payables" value={money(open.reduce((s, b) => s + b.amount, 0))} icon={ShoppingBag} tone="blue" foot={<>{open.length} open bills</>} />
        <StatCard label="Overdue bills" value={money(overdue.reduce((s, b) => s + b.amount, 0))} icon={ShoppingBag} tone="red" foot={<>{overdue.length} past due</>} />
        <StatCard label="Vendors" value={tenant.vendors.length} icon={Truck} tone="violet" foot={<>Active suppliers</>} />
      </div>

      <div className="card mt-16">
        <div style={{ padding: '0 16px' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            <button className={tab === 'bills' ? 'active' : ''} onClick={() => setTab('bills')}>Bills <span className="count">{tenant.bills.length}</span></button>
            <button className={tab === 'vendors' ? 'active' : ''} onClick={() => setTab('vendors')}>Vendors <span className="count">{tenant.vendors.length}</span></button>
          </div>
        </div>
        <div className="table-wrap" style={{ borderTop: '1px solid var(--border)' }}>
          {tab === 'bills' ? (
            tenant.bills.length === 0 ? <EmptyState icon={ShoppingBag} title="No bills yet" text="Record purchase bills from your vendors." /> : (
              <table className="table">
                <thead><tr><th>Date</th><th>Bill #</th><th>Vendor</th><th>Description</th><th>Due</th><th>Status</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {tenant.bills.map((b) => {
                    const st = b.status === 'Open' && daysUntil(b.dueDate) < 0 ? 'Overdue' : b.status;
                    return (
                      <tr key={b.id}>
                        <td>{fmtDate(b.date)}</td>
                        <td className="strong">{b.number}</td>
                        <td>{vName(b.vendorId)}</td>
                        <td className="muted">{b.description || '—'}</td>
                        <td className="muted">{fmtDate(b.dueDate)}</td>
                        <td><Badge>{st}</Badge></td>
                        <td className="num strong">{money(b.amount)}</td>
                        <td className="num">
                          {b.status === 'Open' && <button className="btn btn-secondary btn-sm" onClick={() => { mutate((t) => void (t.bills.find((x) => x.id === b.id)!.status = 'Paid')); toast('success', 'Bill marked paid', b.number); }}><CheckCircle2 size={14} /> Pay</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : tenant.vendors.length === 0 ? <EmptyState icon={Truck} title="No vendors yet" text="Add the suppliers you buy from." /> : (
            <table className="table">
              <thead><tr><th>Vendor</th><th>GSTIN</th><th>Contact</th><th className="num">Payables</th></tr></thead>
              <tbody>
                {tenant.vendors.map((v) => (
                  <tr key={v.id}>
                    <td><div className="name-cell"><span className="avatar">{initials(v.name)}</span><span className="title">{v.name}</span></div></td>
                    <td><span className="chip mono">{v.gstin || '—'}</span></td>
                    <td><div className="small">{v.phone}</div><div className="muted">{v.email}</div></td>
                    <td className="num strong">{money(tenant.bills.filter((b) => b.vendorId === v.id && b.status === 'Open').reduce((s, b) => s + b.amount, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={billOpen} onClose={() => setBillOpen(false)} title="New bill" footer={<><button className="btn btn-secondary" onClick={() => setBillOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveBill}>Save bill</button></>}>
        <div className="form-grid">
          <Field label="Vendor" required error={touched ? billErr.vendorId : ''} className="span-all">
            <select className={`select ${touched && billErr.vendorId ? 'invalid' : ''}`} value={bill.vendorId} onChange={(e) => setBill({ ...bill, vendorId: e.target.value })}>
              <option value="">Select vendor…</option>
              {tenant.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Bill date"><input className="input" type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></Field>
          <Field label="Due date"><input className="input" type="date" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} /></Field>
          <Field label="Amount (incl. tax)" required error={touched ? billErr.amount : ''}>
            <div className="input-addon"><span>₹</span><input className={`input ${touched && billErr.amount ? 'invalid' : ''}`} type="number" value={bill.amount} onChange={(e) => setBill({ ...bill, amount: e.target.value })} /></div>
          </Field>
          <Field label="Description"><input className="input" value={bill.description} onChange={(e) => setBill({ ...bill, description: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={vendorOpen} onClose={() => setVendorOpen(false)} title="New vendor" footer={<><button className="btn btn-secondary" onClick={() => setVendorOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveVendor}>Save vendor</button></>}>
        <div className="form-grid">
          <Field label="Vendor name" required error={touched ? vendErr.name : ''} className="span-all"><input className={`input ${touched && vendErr.name ? 'invalid' : ''}`} value={vendor.name} onChange={(e) => setVendor({ ...vendor, name: e.target.value })} /></Field>
          <Field label="GSTIN" error={touched ? vendErr.gstin : ''}><input className={`input ${touched && vendErr.gstin ? 'invalid' : ''}`} value={vendor.gstin} maxLength={15} onChange={(e) => setVendor({ ...vendor, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Phone"><input className="input" value={vendor.phone} onChange={(e) => setVendor({ ...vendor, phone: e.target.value })} /></Field>
          <Field label="Email" className="span-all"><input className="input" value={vendor.email} onChange={(e) => setVendor({ ...vendor, email: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
