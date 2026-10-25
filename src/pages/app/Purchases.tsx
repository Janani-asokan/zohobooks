import { useEffect, useMemo, useState } from 'react';
import { ExportMenu } from '@/components/ExportMenu';
import { billTable } from '@/lib/docPdf';
import { PdfButton } from '@/components/PdfButton';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ShoppingBag, CheckCircle2, Loader2, Package, Receipt, AlertTriangle, X } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBankAccounts, useBills, useItems, useMut, useTaxSlabs, useVendors } from '@/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { SmartUpload, type FillRow, type PendingFile } from '@/components/SmartUpload';
import { Attachments, attachFile } from '@/components/Attachments';
import { matchItem, matchParty } from '@/lib/match';
import { createItemFrom, createVendorFrom } from '@/lib/autoCreate';
import type { ExtractResult } from '../../../shared/extract';
import type { Bill } from '@/api/types';
import { StatusBadge } from '@/components/StatusBadge';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard, Toggle } from '@/components/ui';
import { Hint } from '@/components/kit';
import { PurchaseLinesEditor, emptyPLine, pLineFor, pTotals, toPurchaseInput, type PLine } from '@/components/PurchaseLines';
import { uid } from '@/lib/format';
import { addDays, fmtDate, money, todayISO } from '@/lib/format';
import { daysUntil } from '@/lib/fy';

type Mode = 'items' | 'amount';
const blankBill = () => ({ vendorId: '', vendorBillNo: '', date: todayISO(), dueDate: addDays(todayISO(), 30), taxableAmount: '', taxAmount: '', description: '', addStock: true, lines: [emptyPLine()] as PLine[] });

/** Bills — what you owe vendors. Itemised bills can add stock directly; lump-sum bills cover services & utilities. */
export default function Purchases() {
  const me = useShopUser();
  const canWrite = me.can('purchases.write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const vendors = useVendors().data ?? [];
  const { data: bills = [], isLoading } = useBills();
  const accounts = useBankAccounts().data ?? [];
  const items = useItems().data ?? [];
  const slabs = useTaxSlabs().data ?? [];
  const qc = useQueryClient();
  const [billFile, setBillFile] = useState<PendingFile | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [filter, setFilter] = useState<'All' | Bill['status']>('All');
  const [q, setQ] = useState('');
  const [billOpen, setBillOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('items');
  const [bill, setBill] = useState(blankBill);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payAccount, setPayAccount] = useState('');
  const [payForm, setPayForm] = useState({ amount: '', tdsAmount: '', mode: 'Bank Transfer', reference: '', date: todayISO() });
  const [payErr, setPayErr] = useState('');
  const [view, setView] = useState<Bill | null>(null);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});

  const keys = [['bills'], ['vendors'], ['bankAccounts'], ['bankTxns'], ['notifications'], ['items'], ['stockAlerts'], ['movements'], ['dashboard']];
  const createBill = useMut((b: Record<string, unknown>) => api.post<Bill>('/shop/bills', b), keys, { success: (b) => `${b.number} recorded${b.stockAdded ? ' · stock added' : ''}`, silentError: true });
  const pay = useMut((v: { id: string; body: Record<string, unknown> }) => api.post<Bill>(`/shop/bills/${v.id}/pay`, v.body), [...keys, ['billPayments']], { success: (b) => (b.status === 'Paid' ? `${b.number} paid in full` : `Payment recorded · ${money(b.balance)} left`), silentError: true });
  const startPay = (b: Bill) => { setPayBill(b); setPayErr(''); setPayForm({ amount: String(b.balance), tdsAmount: '', mode: 'Bank Transfer', reference: '', date: todayISO() }); setPayAccount(accounts.find((a) => a.type === 'Bank')?.id ?? accounts[0]?.id ?? ''); };
  const savePay = () => {
    const amount = Number(payForm.amount), tds = Number(payForm.tdsAmount || 0);
    if (!(amount > 0)) return setPayErr('Enter the amount paid');
    if (amount + tds > payBill!.balance + 0.005) return setPayErr(`More than the ${money(payBill!.balance)} still due`);
    pay.mutate({ id: payBill!.id, body: { accountId: payAccount, date: payForm.date, amount, tdsAmount: tds, mode: payForm.mode, reference: payForm.reference } }, { onSuccess: () => setPayBill(null), onError: (e) => setPayErr(e.message) });
  };

  const start = () => { setBill(blankBill()); setMode('items'); setTouched(false); setServerErr({}); setBillFile(null); setBillOpen(true); };

  /* ---------- fill a bill from the vendor's PDF or a photo of it ---------- */
  const billRows = (r: ExtractResult): FillRow[] => {
    const d = r.data;
    const v = matchParty(vendors, d.party);
    const vname = d.party.companyName || d.party.name;
    return [
      { key: 'vendor', label: 'Vendor', value: v?.name ?? (vname ? `${vname} (new vendor)` : null), display: v ? `${v.name} · matched${v.gstin ? ` by ${v.gstin === d.party.gstin ? 'GSTIN' : 'name'}` : ''}` : vname ? `${vname}\nNot in your vendors yet: it will be added${d.party.gstin ? ` with GSTIN ${d.party.gstin}` : ''}` : undefined, current: vendors.find((x) => x.id === bill.vendorId)?.name },
      { key: 'number', label: 'Vendor’s bill number', value: d.documentNumber, current: bill.vendorBillNo },
      { key: 'date', label: 'Bill date', value: d.date, display: d.date ? fmtDate(d.date) : undefined, current: bill.date },
      { key: 'due', label: 'Due date', value: d.dueDate, display: d.dueDate ? fmtDate(d.dueDate) : undefined, current: bill.dueDate },
      { key: 'amounts', label: d.lines.length ? 'Total (from the bill)' : 'Taxable value + GST', value: d.lines.length ? d.total : d.subtotal ?? d.total, display: d.lines.length ? (d.total != null ? money(d.total) : undefined) : `${money(d.subtotal ?? d.total ?? 0)} + GST ${money(d.taxTotal ?? 0)}` },
    ];
  };
  const billLines = (r: ExtractResult) => r.data.lines.map((l) => ({ l, item: matchItem(items, l) }));
  const billExtra = (r: ExtractResult) => {
    const rows = billLines(r);
    if (!rows.length) return null;
    const missing = rows.filter((x) => !x.item).length;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="strong">Items on the bill</div>
        <table className="table">
          <thead><tr><th>On the bill</th><th className="num">Qty</th><th className="num">Rate</th><th>In your catalogue</th></tr></thead>
          <tbody>{rows.map(({ l, item }, i) => <tr key={i}><td>{l.name}{l.hsn && <div className="muted">HSN {l.hsn}</div>}</td><td className="num">{l.qty ?? 1}</td><td className="num">{l.rate != null ? money(l.rate) : '—'}</td><td>{item ? item.name : <span className="muted">Not found</span>}</td></tr>)}</tbody>
        </table>
        {missing > 0 && <label className="row" style={{ gap: 8 }}><input type="checkbox" className="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} /> Add the {missing} new item{missing > 1 ? 's' : ''} to the catalogue (cost from the bill, selling price +20% to start)</label>}
      </div>
    );
  };
  const applyBill = async (keys: Set<string>, r: ExtractResult, file: PendingFile) => {
    const d = r.data;
    let vendorId = bill.vendorId;
    if (keys.has('vendor')) {
      const v = matchParty(vendors, d.party);
      if (v) vendorId = v.id;
      else if (d.party.companyName || d.party.name) {
        try { vendorId = (await createVendorFrom(d.party)).id; qc.invalidateQueries({ queryKey: ['vendors'] }); } catch (e) { setServerErr({ vendorId: (e as Error).message }); }
      }
    }
    const rows = billLines(r);
    const lines: PLine[] = [];
    let created = 0;
    for (const { l, item } of rows) {
      let it = item;
      if (!it && createMissing) { try { it = await createItemFrom(l, slabs, true); created++; } catch { /* left for the user */ } }
      if (!it) continue;
      const rate = l.rate ?? (l.amount && l.qty ? Math.round((l.amount / l.qty) * 100) / 100 : it.cost ?? 0);
      lines.push({ ...pLineFor(it, l.qty ?? 1), key: uid('pl_'), rate: String(rate), taxRate: l.taxRate ?? it.taxRate });
    }
    if (created) qc.invalidateQueries({ queryKey: ['items'] });
    const subtotal = d.subtotal ?? (d.total != null && d.taxTotal != null ? d.total - d.taxTotal : d.total);
    setMode(lines.length ? 'items' : 'amount');
    setBill((b) => ({
      ...b, vendorId,
      vendorBillNo: keys.has('number') && d.documentNumber ? d.documentNumber.slice(0, 60) : b.vendorBillNo,
      date: keys.has('date') && d.date ? d.date : b.date,
      dueDate: keys.has('due') && d.dueDate ? d.dueDate : b.dueDate,
      lines: lines.length ? lines : b.lines,
      taxableAmount: !lines.length && keys.has('amounts') && subtotal != null ? String(subtotal) : b.taxableAmount,
      taxAmount: !lines.length && keys.has('amounts') && d.taxTotal != null ? String(d.taxTotal) : b.taxAmount,
      description: b.description || d.lines.slice(0, 3).map((x) => x.name).join(', ').slice(0, 200),
    }));
    setBillFile(file);
  };
  useEffect(() => { if (params.get('new') && canWrite) { start(); setParams({}, { replace: true }); } }, [params]);

  const statusOf = (b: Bill) => b.status;
  const open = bills.filter((b) => b.status !== 'Paid');
  const overdue = open.filter((b) => daysUntil(b.dueDate) < 0);
  const monthStart = todayISO().slice(0, 8) + '01';
  const itc = bills.filter((b) => b.date >= monthStart).reduce((s, b) => s + b.taxAmount, 0);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return bills.filter((b) => filter === 'All' || statusOf(b) === filter).filter((b) => !s || [b.number, b.vendorName, b.vendorBillNo, b.description].some((x) => x.toLowerCase().includes(s)));
  }, [bills, filter, q]);

  const t = pTotals(bill.lines);
  const errs = {
    vendorId: !bill.vendorId ? 'Select a vendor' : '',
    taxableAmount: mode === 'amount' && !(Number(bill.taxableAmount) > 0) ? 'Enter amount' : '',
    lines: mode === 'items' && t.count === 0 ? 'Add at least one item' : '',
    dueDate: bill.dueDate < bill.date ? 'Due date can’t be before bill date' : '',
  };
  const err = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const save = () => {
    setTouched(true); setServerErr({});
    if (Object.values(errs).some(Boolean)) return;
    const base = { vendorId: bill.vendorId, vendorBillNo: bill.vendorBillNo, date: bill.date, dueDate: bill.dueDate, description: bill.description };
    const body = mode === 'items' ? { ...base, lines: toPurchaseInput(bill.lines), addStock: bill.addStock } : { ...base, taxableAmount: Number(bill.taxableAmount), taxAmount: Number(bill.taxAmount || 0) };
    createBill.mutate(body, {
      onSuccess: (b) => {
        setBillOpen(false);
        if (billFile) void attachFile('bill', b.id, billFile.file.name, billFile.dataUrl).catch(() => undefined);
      },
      onError: (e) => setServerErr(fieldErrors(e)),
    });
  };

  return (
    <div className="page">
      <PageHeader title="Bills" subtitle="Vendor bills you need to pay, and the GST input credit they carry."
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Bills', subtitle: `${rows.length} bills`, filename: 'bills', landscape: true,
          columns: [{ label: 'Date' }, { label: 'Bill #' }, { label: 'Vendor' }, { label: 'Vendor bill no.' }, { label: 'Due' }, { label: 'Status' }, { label: 'Taxable', money: true }, { label: 'GST', money: true }, { label: 'Total', money: true }, { label: 'Balance', money: true }],
          rows: rows.map((b) => ({ cells: [fmtDate(b.date), b.number, b.vendorName, b.vendorBillNo, fmtDate(b.dueDate), statusOf(b), b.taxableAmount, b.taxAmount, b.amount, b.balance] })),
        })} />{canWrite && <button className="btn btn-primary" onClick={start}><Plus size={16} /> New Bill</button>}</>} />
      <Hint id="bills" title="Recording purchases">
        <p>Enter a bill <strong>item by item</strong> to add the goods to stock straight away (no purchase order needed), or as a <strong>single amount</strong> when the vendor bill has no stock items. Record rent, salaries and other running costs under <strong>Expenses</strong> so they show in Profit &amp; Loss. Click <strong>Pay</strong> when you settle it — the money leaves the bank or cash account you choose.</p>
      </Hint>
      <div className="stat-grid">
        <StatCard label="Total payables" value={money(open.reduce((s, b) => s + b.balance, 0))} icon={ShoppingBag} tone="blue" foot={<>{open.length} open bills</>} />
        <StatCard label="Overdue bills" value={money(overdue.reduce((s, b) => s + b.balance, 0))} icon={AlertTriangle} tone="red" foot={<>{overdue.length} past due</>} />
        <StatCard label="Input tax credit (this month)" value={money(itc)} icon={CheckCircle2} tone="green" foot="GST on purchase bills · used in GSTR-3B" />
        <StatCard label="Paid this month" value={money(bills.filter((b) => b.status === 'Paid' && b.date >= monthStart).reduce((s, b) => s + b.amount, 0))} icon={Receipt} tone="violet" foot="Bills dated this month" />
      </div>

      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left" style={{ flexWrap: 'wrap' }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search bill, vendor…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {(['All', 'Open', 'Overdue', 'Partially Paid', 'Paid'] as const).map((f) => <button key={f} className={`filter-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f} <span className="n">{f === 'All' ? bills.length : bills.filter((b) => statusOf(b) === f).length}</span></button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : rows.length === 0 ? <EmptyState icon={ShoppingBag} title={bills.length ? 'No bills match' : 'No bills yet'} text="Record purchase bills from your vendors." action={canWrite && <button className="btn btn-primary" onClick={start}><Plus size={15} /> New Bill</button>} /> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Bill #</th><th>Vendor</th><th>Details</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => setView(b)}>
                    <td>{fmtDate(b.date)}</td>
                    <td className="strong">{b.number}{b.vendorBillNo && <div className="muted">Vendor # {b.vendorBillNo}</div>}</td>
                    <td>{b.vendorName}</td>
                    <td className="muted">{b.description || '—'}{b.stockAdded && <div><span className="chip" style={{ background: 'var(--green-50)', color: 'var(--green-700)' }}><Package size={11} /> {b.purchaseOrderId ? 'From PO' : 'Stock added'}</span></div>}</td>
                    <td className="muted">{fmtDate(b.dueDate)}</td>
                    <td><StatusBadge status={statusOf(b)} /></td>
                    <td className="num strong">{money(b.amount)}<div className="muted">GST {money(b.taxAmount)}</div></td>
                    <td className="num">{b.balance > 0 ? money(b.balance) : '—'}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>{b.balance > 0 && canWrite && <button className="btn btn-secondary btn-sm" onClick={() => startPay(b)}><CheckCircle2 size={14} /> Pay</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={billOpen} onClose={() => setBillOpen(false)} size={mode === 'items' ? 'xl' : undefined} title="New bill" subtitle="Enter the bill exactly as your vendor gave it."
        footer={<><button className="btn btn-secondary" onClick={() => setBillOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={createBill.isPending} onClick={save}>{createBill.isPending && <Loader2 size={15} className="spin" />} Save bill</button></>}>
        <div style={{ marginBottom: 16 }}>
          <SmartUpload kind="bill" toRows={billRows} onApply={(k, r, f) => void applyBill(k, r, f)} extra={billExtra}
            title="Fill from the vendor’s bill" hint="Upload the PDF or a photo of the bill. Vendor, bill number, dates, items and amounts are filled in; the file is kept with the bill." />
          {billFile && <div className="small muted" style={{ marginTop: 6 }}>{billFile.file.name} will be attached to this bill.</div>}
        </div>
        <div className="type-cards" style={{ marginBottom: 18 }}>
          <button type="button" className={`type-card ${mode === 'items' ? 'active' : ''}`} onClick={() => setMode('items')}><span className="stat-icon tone-blue"><Package size={18} /></span><div><strong>Itemised</strong><span>Stock you bought — adds to inventory</span></div></button>
          <button type="button" className={`type-card ${mode === 'amount' ? 'active' : ''}`} onClick={() => setMode('amount')}><span className="stat-icon tone-violet"><Receipt size={18} /></span><div><strong>Single amount</strong><span>No stock items on the bill</span></div></button>
        </div>
        <div className="form-grid cols-3">
          <Field label="Vendor" required error={err('vendorId')}>
            <select className={`select ${err('vendorId') ? 'invalid' : ''}`} value={bill.vendorId} onChange={(e) => setBill({ ...bill, vendorId: e.target.value })}><option value="">Select vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gstin ? '' : ' (unregistered)'}</option>)}</select>
            {vendors.length === 0 && <span className="field-hint"><button className="link-btn" onClick={() => navigate('/app/purchases/vendors?new=1')}>Add a vendor first</button></span>}
          </Field>
          <Field label="Vendor’s bill number"><input className="input" value={bill.vendorBillNo} onChange={(e) => setBill({ ...bill, vendorBillNo: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={bill.description} onChange={(e) => setBill({ ...bill, description: e.target.value })} placeholder={mode === 'items' ? 'Optional' : 'e.g. Freight charges'} /></Field>
          <Field label="Bill date"><input className="input" type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></Field>
          <Field label="Due date" error={err('dueDate')}>
            <input className="input" type="date" value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} />
            <div className="suggest">{[0, 15, 30, 45].map((d) => <button key={d} type="button" onClick={() => setBill({ ...bill, dueDate: addDays(bill.date, d) })}>{d === 0 ? 'On receipt' : `Net ${d}`}</button>)}</div>
          </Field>
        </div>
        {mode === 'items' ? (
          <>
            <div className="section-title mt-24">Items</div>
            <PurchaseLinesEditor lines={bill.lines} onChange={(lines) => setBill({ ...bill, lines })} items={items} error={err('lines')} />
            <div className="toggle-row"><div><div className="strong">Add these items to stock</div><div className="small muted">Turn off if the goods were already received on a purchase order.</div></div><Toggle checked={bill.addStock} onChange={(v) => setBill({ ...bill, addStock: v })} /></div>
          </>
        ) : (
          <div className="form-grid mt-16">
            <Field label="Taxable value" required error={err('taxableAmount')}><div className="input-addon"><span>₹</span><input className={`input ${err('taxableAmount') ? 'invalid' : ''}`} type="number" value={bill.taxableAmount} onChange={(e) => setBill({ ...bill, taxableAmount: e.target.value })} /></div></Field>
            <Field label="GST on bill" hint="Claimed as input tax credit if the vendor has a GSTIN">
              <div className="input-addon"><span>₹</span><input className="input" type="number" value={bill.taxAmount} onChange={(e) => setBill({ ...bill, taxAmount: e.target.value })} /></div>
              {Number(bill.taxableAmount) > 0 && <div className="suggest">{[5, 12, 18, 28].map((r) => <button key={r} type="button" onClick={() => setBill({ ...bill, taxAmount: String(Math.round(Number(bill.taxableAmount) * r) / 100) })}>{r}%</button>)}</div>}
            </Field>
            <p className="small muted span-all">Total: <strong style={{ color: 'var(--ink-900)' }}>{money(Number(bill.taxableAmount || 0) + Number(bill.taxAmount || 0))}</strong></p>
          </div>
        )}
      </Modal>

      <Modal open={!!payBill} onClose={() => setPayBill(null)} title={`Pay ${payBill?.number}`} subtitle={payBill ? `${payBill.vendorName} · ${money(payBill.balance)} of ${money(payBill.amount)} still due` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setPayBill(null)}>Cancel</button><button className="btn btn-primary" disabled={!payAccount || pay.isPending} onClick={savePay}>Record payment</button></>}>
        <div className="form-grid">
          <Field label="Amount paid" required error={payErr}><div className="input-addon"><span>₹</span><input className={`input ${payErr ? 'invalid' : ''}`} type="number" min={0} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} autoFocus /></div></Field>
          <Field label="Payment date"><input className="input" type="date" value={payForm.date} max={todayISO()} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></Field>
          <Field label="Pay from"><select className="select" value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}</select></Field>
          <Field label="Mode"><select className="select" value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>{['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference" hint="UTR, cheque number…"><input className="input" value={payForm.reference} maxLength={100} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
          <Field label="TDS deducted" hint="Counts towards the bill; not withdrawn"><div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={payForm.tdsAmount} onChange={(e) => setPayForm({ ...payForm, tdsAmount: e.target.value })} /></div></Field>
        </div>
      </Modal>

      {view && (
        <>
          <div className="overlay" style={{ padding: 0 }} onMouseDown={() => setView(null)} />
          <aside className="drawer" role="dialog" aria-label={view.number}>
            <div className="drawer-head">
              <div><div className="row" style={{ gap: 8 }}><h3 style={{ fontSize: 16 }}>{view.number}</h3><Badge>{statusOf(view)}</Badge></div><p className="small muted">{view.vendorName} · {fmtDate(view.date)} · due {fmtDate(view.dueDate)}</p></div>
              <div className="row" style={{ gap: 4 }}><PdfButton table={() => billTable(view)} /><button className="icon-btn" onClick={() => setView(null)} aria-label="Close"><X size={18} /></button></div>
            </div>
            <div className="drawer-body">
              {view.lines.length > 0 ? (
                <table className="table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                  <tbody>{view.lines.map((l) => <tr key={l.id}><td className="strong">{l.name}<div className="muted">GST {l.taxRate}%</div></td><td className="num">{l.qty} {l.unit}</td><td className="num">{money(l.rate)}</td><td className="num strong">{money(l.amount)}</td></tr>)}</tbody></table>
              ) : <p className="small">{view.description || 'Lump-sum bill'}</p>}
              <div className="totals-mini" style={{ marginLeft: 'auto', marginTop: 12 }}>
                <div><span>Taxable</span><strong>{money(view.taxableAmount)}</strong></div>
                <div><span>GST</span><strong>{money(view.taxAmount)}</strong></div>
                <div className="grand"><span>Total</span><strong>{money(view.amount)}</strong></div>
              </div>
              {view.stockAdded && <p className="small muted mt-16"><Package size={13} style={{ verticalAlign: -2 }} /> {view.purchaseOrderId ? 'Goods were received on the purchase order.' : 'These goods were added to stock when the bill was saved.'}</p>}
              <div className="mt-16"><Attachments entity="bill" entityId={view.id} canWrite={canWrite} /></div>
              {view.balance > 0 && canWrite && <button className="btn btn-primary mt-16" onClick={() => { startPay(view); setView(null); }}><CheckCircle2 size={15} /> Record payment</button>}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
