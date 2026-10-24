import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { SmartUpload, type FillRow, type PendingFile } from '@/components/SmartUpload';
import { Attachments, attachFile } from '@/components/Attachments';
import { matchParty } from '@/lib/match';
import type { ExtractResult } from '../../../shared/extract';
import { Plus, Wallet, Trash2, Loader2, Zap, Home, Users, Wifi, Fuel, Wrench, PenTool, Megaphone, Landmark, Briefcase, Coffee, MoreHorizontal, PieChart } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBankAccounts, useExpenses, useMut, useVendors } from '@/api/hooks';
import type { Expense } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { MeterList } from '@/components/charts';
import { Hint } from '@/components/kit';
import { fmtDate, money, moneyShort, todayISO } from '@/lib/format';

export const EXPENSE_CATEGORIES: Array<{ name: string; icon: typeof Zap; color: string }> = [
  { name: 'Rent', icon: Home, color: '#5b5bf0' },
  { name: 'Salaries & Wages', icon: Users, color: '#10b981' },
  { name: 'Electricity', icon: Zap, color: '#f59e0b' },
  { name: 'Internet & Phone', icon: Wifi, color: '#0ea5e9' },
  { name: 'Fuel & Travel', icon: Fuel, color: '#ef4444' },
  { name: 'Repairs & Maintenance', icon: Wrench, color: '#8b5cf6' },
  { name: 'Office Supplies', icon: PenTool, color: '#14b8a6' },
  { name: 'Marketing', icon: Megaphone, color: '#ec4899' },
  { name: 'Bank Charges', icon: Landmark, color: '#71717a' },
  { name: 'Professional Fees', icon: Briefcase, color: '#7b4ff0' },
  { name: 'Food & Refreshments', icon: Coffee, color: '#f97316' },
  { name: 'Other', icon: MoreHorizontal, color: '#a1a1aa' },
];
/** Category from the merchant and the receipt text: TNEB → Electricity, Airtel → Internet & Phone, Swiggy → Food… */
export function guessExpenseCategory(text: string): string | null {
  const t = text.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['Electricity', /electric|tneb|tangedco|bescom|msedcl|kseb|power bill|units consumed/],
    ['Internet & Phone', /airtel|jio|vodafone|\bvi\b|bsnl|act fibernet|broadband|internet|mobile bill|postpaid/],
    ['Rent', /\brent\b|lease|landlord/],
    ['Fuel & Travel', /petrol|diesel|fuel|indian oil|hpcl|bpcl|uber|ola\b|rapido|irctc|flight|toll|fastag|parking/],
    ['Food & Refreshments', /swiggy|zomato|restaurant|cafe|tea|coffee|snacks|hotel|food/],
    ['Office Supplies', /stationery|paper|toner|cartridge|pen\b|office supplies|printing/],
    ['Repairs & Maintenance', /repair|maintenance|service charge|plumber|electrician|amc/],
    ['Marketing', /advert|facebook ads|google ads|meta ads|pamphlet|banner|flex|marketing/],
    ['Bank Charges', /bank charge|processing fee|neft charge|imps charge|annual fee|gst on charges/],
    ['Professional Fees', /chartered accountant|\bca\b|consult|legal|advocate|audit fee|professional fee/],
    ['Salaries & Wages', /salary|wages|payroll/],
  ];
  return rules.find(([, re]) => re.test(t))?.[0] ?? null;
}

const catMeta = (n: string) => EXPENSE_CATEGORIES.find((c) => c.name === n) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]!;
const blank = () => ({ date: todayISO(), category: '', description: '', vendorId: '', amount: '', taxAmount: '', accountId: '', reference: '' });

export default function Expenses() {
  const me = useShopUser();
  const canWrite = me.can('purchases.write');
  const [params, setParams] = useSearchParams();
  const { data: expenses = [], isLoading } = useExpenses();
  const vendors = useVendors().data ?? [];
  const accounts = useBankAccounts().data ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Expense | null>(null);
  const [filesFor, setFilesFor] = useState<Expense | null>(null);
  const [expFile, setExpFile] = useState<PendingFile | null>(null);
  const keys = [['expenses'], ['bankAccounts'], ['bankTxns'], ['dashboard']];
  const create = useMut((b: Record<string, unknown>) => api.post<Expense>('/shop/expenses', b), keys, { success: (e) => `${e.category} expense of ${money(e.total)} recorded`, silentError: true });
  const remove = useMut((id: string) => api.del(`/shop/expenses/${id}`), keys, { success: 'Expense deleted' });

  const start = (category = '') => { setExpFile(null); setForm({ ...blank(), category, accountId: accounts.find((a) => a.type === 'Cash')?.id ?? accounts[0]?.id ?? '' }); setTouched(false); setServerErr({}); setOpen(true); };
  useEffect(() => { if (params.get('new') && canWrite && accounts.length) { start(); setParams({}, { replace: true }); } }, [params, accounts.length]);

  const monthStart = todayISO().slice(0, 8) + '01';
  const thisMonth = expenses.filter((e) => e.date >= monthStart);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    thisMonth.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + e.total));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return expenses.filter((e) => cat === 'all' || e.category === cat).filter((e) => !s || [e.category, e.description, e.vendorName ?? '', e.reference].some((x) => x.toLowerCase().includes(s)));
  }, [expenses, q, cat]);

  const errs = { category: !form.category ? 'Pick a category' : '', amount: !(Number(form.amount) > 0) ? 'Enter the amount' : '', accountId: !form.accountId ? 'Choose the account you paid from' : '' };
  const err = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const save = () => {
    setTouched(true); setServerErr({});
    if (Object.values(errs).some(Boolean)) return;
    create.mutate({ ...form, vendorId: form.vendorId || null, amount: Number(form.amount), taxAmount: Number(form.taxAmount || 0) }, {
      onSuccess: (x) => { setOpen(false); if (expFile) void attachFile('expense', x.id, expFile.file.name, expFile.dataUrl).catch(() => undefined); },
      onError: (e) => setServerErr(fieldErrors(e)),
    });
  };

  /* ---------- fill from a receipt ---------- */
  const expRows = (r: ExtractResult): FillRow[] => {
    const d = r.data;
    const cat = guessExpenseCategory([d.party.companyName, d.party.name, r.textPreview, ...d.lines.map((l) => l.name)].filter(Boolean).join(' '));
    const v = matchParty(vendors, d.party);
    const net = d.subtotal ?? (d.total != null && d.taxTotal != null ? d.total - d.taxTotal : d.total);
    return [
      { key: 'category', label: 'Category', value: cat, current: form.category },
      { key: 'date', label: 'Date', value: d.date, display: d.date ? fmtDate(d.date) : undefined, current: form.date },
      { key: 'amount', label: 'Amount before GST', value: net, display: net != null ? money(net) : undefined, current: form.amount },
      { key: 'tax', label: 'GST', value: d.taxTotal, display: d.taxTotal != null ? money(d.taxTotal) : undefined, current: form.taxAmount },
      { key: 'vendor', label: 'Vendor', value: v?.name, current: vendors.find((x) => x.id === form.vendorId)?.name },
      { key: 'description', label: 'Description', value: [d.party.companyName || d.party.name, d.lines[0]?.name].filter(Boolean).join(' · ').slice(0, 200) || null, current: form.description },
      { key: 'reference', label: 'Reference', value: d.documentNumber, current: form.reference },
    ];
  };
  const applyExp = (keys: Set<string>, r: ExtractResult, file: PendingFile) => {
    const rows = Object.fromEntries(expRows(r).map((x) => [x.key, x.value]));
    const v = matchParty(vendors, r.data.party);
    setForm((f) => ({
      ...f,
      category: keys.has('category') && rows.category ? String(rows.category) : f.category,
      date: keys.has('date') && rows.date ? String(rows.date) : f.date,
      amount: keys.has('amount') && rows.amount != null ? String(rows.amount) : f.amount,
      taxAmount: keys.has('tax') && rows.tax != null ? String(rows.tax) : f.taxAmount,
      vendorId: keys.has('vendor') && v ? v.id : f.vendorId,
      description: keys.has('description') && rows.description ? String(rows.description) : f.description,
      reference: keys.has('reference') && rows.reference ? String(rows.reference).slice(0, 60) : f.reference,
    }));
    setExpFile(file);
  };

  return (
    <div className="page">
      <PageHeader title="Expenses" subtitle="Day-to-day running costs — rent, salaries, electricity, travel and more."
        actions={canWrite && <button className="btn btn-primary" onClick={() => start()}><Plus size={16} /> Record Expense</button>} />
      <Hint id="expenses" title="Track where your money goes">
        <p>Record each expense as you pay it. It’s deducted from the bank/cash account you choose, shows up in <strong>Profit &amp; Loss</strong>, and GST paid to registered vendors is added to your input tax credit.</p>
      </Hint>
      <div className="stat-grid">
        <StatCard label="Spent this month" value={money(thisMonth.reduce((s, e) => s + e.total, 0))} icon={Wallet} tone="red" foot={`${thisMonth.length} expenses`} />
        <StatCard label="Biggest category" value={byCat[0]?.[0] ?? '—'} icon={PieChart} tone="violet" foot={byCat[0] ? money(byCat[0][1]) : 'No expenses yet'} />
        <StatCard label="GST paid on expenses" value={money(thisMonth.reduce((s, e) => s + e.taxAmount, 0))} icon={Landmark} tone="green" foot="This month" />
        <StatCard label="All-time" value={moneyShort(expenses.reduce((s, e) => s + e.total, 0))} icon={Wallet} tone="blue" foot={`${expenses.length} records`} />
      </div>

      {canWrite && (
        <div className="cat-quick mt-16">
          {EXPENSE_CATEGORIES.slice(0, 8).map((c) => (
            <button key={c.name} onClick={() => start(c.name)} title={`Record ${c.name}`}>
              <span style={{ background: 'var(--ink-100)', color: 'var(--ink-600)' }}><c.icon size={18} /></span>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid-2-1 mt-16">
        <div className="card">
          <div className="toolbar">
            <div className="toolbar-left">
              <SearchInput value={q} onChange={setQ} placeholder="Search expenses…" />
              <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="all">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}</select>
            </div>
          </div>
          <div className="table-wrap">
            {isLoading ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : rows.length === 0 ? (
              <EmptyState icon={Wallet} title={expenses.length ? 'No expenses match' : 'No expenses yet'} text="Record rent, salaries, bills and other running costs." action={canWrite && <button className="btn btn-primary" onClick={() => start()}><Plus size={15} /> Record Expense</button>} />
            ) : (
              <table className="table">
                <thead><tr><th>Date</th><th>Category</th><th>Paid via</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {rows.map((e) => {
                    const c = catMeta(e.category);
                    return (
                      <tr key={e.id}>
                        <td className="muted">{fmtDate(e.date)}</td>
                        <td>
                          <div className="name-cell">
                            <span className="stat-icon" style={{ width: 34, height: 34, background: 'var(--ink-100)', color: 'var(--ink-600)' }}><c.icon size={16} /></span>
                            <div><div className="title">{e.category}</div><div className="sub">{[e.description, e.vendorName, e.reference && `Ref ${e.reference}`].filter(Boolean).join(' · ') || '—'}</div></div>
                          </div>
                        </td>
                        <td className="muted">{e.accountName ?? '—'}</td>
                        <td className="num strong">{money(e.total)}{e.taxAmount > 0 && <div className="muted">incl. GST {money(e.taxAmount)}</div>}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}><button className="icon-btn" title="Receipts and files" onClick={() => setFilesFor(e)}><Paperclip size={15} /></button>{canWrite && <button className="icon-btn danger" title="Delete" onClick={() => setDel(e)}><Trash2 size={15} /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>This month by category</h3><p>Where the money went</p></div></div>
          <div className="card-body">{byCat.length ? <MeterList rows={byCat.map(([label, value]) => ({ label, value }))} format={money} /> : <p className="small muted">Nothing recorded this month.</p>}</div>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Record expense" footer={<><button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={save}>{create.isPending && <Loader2 size={15} className="spin" />} Save expense</button></>}>
        <div style={{ marginBottom: 16 }}>
          <SmartUpload kind="expense" toRows={expRows} onApply={applyExp} title="Fill from a receipt" hint="Upload or photograph the bill (electricity, rent receipt, fuel, internet…). The receipt is kept with the expense." />
          {expFile && <div className="small muted" style={{ marginTop: 6 }}>{expFile.file.name} will be attached to this expense.</div>}
        </div>
        <Field label="Category" required error={err('category')}>
          <div className="cat-pick">
            {EXPENSE_CATEGORIES.map((c) => (
              <button key={c.name} type="button" className={form.category === c.name ? 'active' : ''} onClick={() => setForm({ ...form, category: c.name })} >
                <c.icon size={16} style={{ color: 'var(--ink-500)' }} /> {c.name}
              </button>
            ))}
          </div>
        </Field>
        <div className="form-grid mt-16">
          <Field label="Amount (before GST)" required error={err('amount')}><div className="input-addon"><span>₹</span><input className={`input ${err('amount') ? 'invalid' : ''}`} type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></div></Field>
          <Field label="GST paid" hint="Leave empty if there’s no GST">
            <div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={form.taxAmount} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })} /></div>
            {Number(form.amount) > 0 && <div className="suggest">{[5, 12, 18].map((r) => <button key={r} type="button" onClick={() => setForm({ ...form, taxAmount: String(Math.round(Number(form.amount) * r) / 100) })}>{r}%</button>)}</div>}
          </Field>
          <Field label="Date"><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Paid from" required error={err('accountId')}><select className={`select ${err('accountId') ? 'invalid' : ''}`} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}><option value="">Choose account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}</select></Field>
          <Field label="Vendor" hint="Optional — needed to claim GST credit"><select className="select" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">No vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Reference #"><input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Receipt / UTR no." /></Field>
          <Field label="Notes" className="span-all"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. October shop rent" /></Field>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Total paid: <strong style={{ color: 'var(--ink-900)' }}>{money(Number(form.amount || 0) + Number(form.taxAmount || 0))}</strong></p>
      </Modal>

      <Modal open={!!filesFor} onClose={() => setFilesFor(null)} title="Receipts and files" subtitle={filesFor ? `${filesFor.category} · ${fmtDate(filesFor.date)} · ${money(filesFor.total)}` : ''}>
        {filesFor && <Attachments entity="expense" entityId={filesFor.id} canWrite={canWrite} title="Files" />}
      </Modal>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Delete expense?" confirmLabel="Delete" text={<>The {del?.category} expense of {del && money(del.total)} will be removed and the amount returned to {del?.accountName ?? 'the account'}.</>} onConfirm={() => remove.mutate(del!.id)} />
    </div>
  );
}
