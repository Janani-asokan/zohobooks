import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, UserRound, Info, Save, Send, CheckCircle2, Plus } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Field, PageHeader } from '@/components/ui';
import { LineItemsEditor, TaxModeToggle, TotalsPanel, emptyLine } from '@/components/LineItems';
import { addDays, todayISO, uid } from '@/lib/format';
import { fyLabel } from '@/lib/fy';
import { isInterState } from '@/lib/invoice';
import { TIER_LABEL, type Invoice, type Item, type LineItem } from '@/lib/types';

/** Finalised (non-draft) invoices reduce stock on hand for goods. */
function deductStock(items: Item[], lines: LineItem[]) {
  for (const l of lines) {
    const it = items.find((i) => i.id === l.itemId);
    if (it && it.type === 'Goods') it.stock = Math.max(0, it.stock - l.qty);
  }
}

const TERMS = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
];

export default function InvoiceForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { tenant, mutate, nextInvoiceNumber, platform } = useTenant();
  const existing = id ? tenant.invoices.find((i) => i.id === id) : undefined;
  const fromSO = params.get('fromSO') ? tenant.salesOrders.find((s) => s.id === params.get('fromSO')) : undefined;

  const initialCustomer = existing?.customerId ?? fromSO?.customerId ?? params.get('customer') ?? '';
  const [customerId, setCustomerId] = useState(initialCustomer);
  const customer = tenant.customers.find((c) => c.id === customerId);
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [terms, setTerms] = useState(15);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addDays(todayISO(), 15));
  const [branchId, setBranchId] = useState(existing?.branchId ?? tenant.branches.find((b) => b.isPrimary)?.id ?? tenant.branches[0]?.id ?? '');
  const [withGst, setWithGst] = useState(existing?.withGst ?? fromSO?.withGst ?? true);
  const [lines, setLines] = useState<LineItem[]>(() => existing?.lines.map((l) => ({ ...l })) ?? fromSO?.lines.map((l) => ({ ...l, id: uid('ln_') })) ?? [emptyLine(customer?.tier ?? 'SP1')]);
  const [notes, setNotes] = useState(existing?.notes ?? fromSO?.notes ?? '');
  const [touched, setTouched] = useState(false);

  const preview = useMemo(() => nextInvoiceNumber(date), [nextInvoiceNumber, date]);
  const number = existing?.number ?? preview.number;
  const interState = customerId ? isInterState(tenant, customerId) : false;

  const selectCustomer = (cid: string) => {
    setCustomerId(cid);
    const c = tenant.customers.find((x) => x.id === cid);
    if (!c) return;
    // Re-price untouched lines to the customer's default tier.
    setLines((ls) =>
      ls.map((l) => {
        const it = tenant.items.find((i) => i.id === l.itemId);
        return { ...l, tier: c.tier, rate: it ? (c.tier === 'SP1' ? it.sp1 : c.tier === 'SP2' ? it.sp2 : it.sp3) : l.rate };
      }),
    );
    if (c.type === 'Business') setWithGst(true);
  };

  const filled = lines.filter((l) => l.itemId || l.name);
  const invalidLines = new Set(lines.filter((l) => (l.itemId || l.name ? l.qty <= 0 : filled.length === 0)).map((l) => l.id));
  const errs = {
    customer: !customerId ? 'Select a customer' : '',
    gst: customer?.type === 'Business' && !customer.gstin ? 'Business customers need a GST number — update the customer first' : '',
    lines: filled.length === 0 ? 'Add at least one item' : filled.some((l) => l.qty <= 0) ? 'Quantity must be at least 1' : '',
    due: dueDate < date ? 'Due date can’t be before invoice date' : '',
  };

  const save = (status: Invoice['status']) => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) {
      toast('error', 'Please fix the highlighted fields');
      return;
    }
    const cleanLines = filled;
    if (existing) {
      mutate((t) => {
        const inv = t.invoices.find((x) => x.id === existing.id)!;
        if (inv.status === 'Draft' && status !== 'Draft') deductStock(t.items, cleanLines);
        Object.assign(inv, { customerId, date, dueDate, branchId, withGst, lines: cleanLines, notes, status });
      });
      toast('success', 'Invoice updated', existing.number);
      return navigate(`/app/sales/invoices/${existing.id}`);
    }
    const newId = uid('inv_');
    const { key, fy, n, number: num } = nextInvoiceNumber(date);
    mutate((t) => {
      t.counters.invoice[key] = n;
      t.invoices.unshift({ id: newId, number: num, fy, customerId, date, dueDate, branchId, withGst, lines: cleanLines, notes, status, salesOrderId: fromSO?.id });
      if (status !== 'Draft') deductStock(t.items, cleanLines);
    });
    toast('success', status === 'Draft' ? 'Draft saved' : 'Invoice created', `${num}${status === 'Paid' ? ' · marked as paid' : ''}`);
    navigate(`/app/sales/invoices/${newId}`);
  };

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <PageHeader
        crumbs={<><Link to="/app/sales/invoices">Invoices</Link> / {existing ? existing.number : 'New'}</>}
        title={existing ? `Edit ${existing.number}` : 'New Invoice'}
        subtitle={fromSO ? `Converting sales order ${fromSO.number}` : `Financial year ${fyLabel(date, platform.fyStartMonth)}`}
      />

      <div className="card">
        <div className="card-body">
          <div className="form-grid">
            <Field label="Customer" required error={touched ? errs.customer || errs.gst : ''}>
              <div className="row" style={{ gap: 8 }}>
                <select className={`select ${touched && (errs.customer || errs.gst) ? 'invalid' : ''}`} value={customerId} onChange={(e) => selectCustomer(e.target.value)}>
                  <option value="">Select or search a customer…</option>
                  <optgroup label="Business (B2B)">
                    {tenant.customers.filter((c) => c.type === 'Business').map((c) => <option key={c.id} value={c.id}>{c.companyName} · {c.customId}</option>)}
                  </optgroup>
                  <optgroup label="Individuals">
                    {tenant.customers.filter((c) => c.type === 'Individual').map((c) => <option key={c.id} value={c.id}>{c.name} · {c.customId}</option>)}
                  </optgroup>
                </select>
                <Link to="/app/sales/customers?new=1" className="btn btn-secondary" title="New customer"><Plus size={15} /></Link>
              </div>
            </Field>
            <div>
              {customer && (
                <div className="card" style={{ boxShadow: 'none', padding: '12px 14px', background: customer.type === 'Business' ? 'var(--violet-50)' : 'var(--ink-50)', borderColor: 'transparent', marginTop: 22 }}>
                  <div className="row" style={{ gap: 10 }}>
                    {customer.type === 'Business' ? <Building2 size={18} style={{ color: 'var(--violet-600)' }} /> : <UserRound size={18} className="muted" />}
                    <div className="small" style={{ lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--ink-900)' }}>{customer.companyName || customer.name}</strong> <span className="chip mono">{customer.customId}</span>
                      <div className="muted">
                        {customer.type === 'Business' ? `GSTIN ${customer.gstin}` : 'Individual (B2C)'} · {customer.state} · Tier {customer.tier} ({TIER_LABEL[customer.tier]})
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Field label="Invoice #" hint={existing ? 'Invoice numbers are permanent' : platform.autoResetInvoiceNumbering ? 'Auto-generated · resets every 1 April' : 'Auto-generated · continuous'}>
              <input className="input" readOnly value={number} style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }} />
            </Field>
            <Field label="Branch">
              <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {tenant.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Invoice date" required>
              <input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setDueDate(addDays(e.target.value, terms)); }} disabled={!!existing} />
            </Field>
            <div className="form-grid" style={{ gap: 12 }}>
              <Field label="Terms">
                <select className="select" value={terms} onChange={(e) => { const d = Number(e.target.value); setTerms(d); setDueDate(addDays(date, d)); }}>
                  {TERMS.map((t) => <option key={t.days} value={t.days}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Due date" error={touched ? errs.due : ''}>
                <input className={`input ${touched && errs.due ? 'invalid' : ''}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <TaxModeToggle withGst={withGst} onChange={setWithGst} />
            <span className="row small muted" style={{ gap: 6 }}>
              <Info size={14} />
              {withGst ? (interState ? 'Inter-state supply → IGST' : 'Intra-state supply → CGST + SGST') : 'Totals shown without any tax'}
            </span>
          </div>
          <LineItemsEditor lines={lines} onChange={setLines} defaultTier={customer?.tier ?? 'SP1'} withGst={withGst} invalidIds={touched ? invalidLines : undefined} />
          {touched && errs.lines && <div className="field-error" style={{ marginTop: 8 }}>{errs.lines}</div>}

          <div className="grid-2 mt-24" style={{ alignItems: 'start' }}>
            <Field label="Customer notes" hint="Printed on the invoice">
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thanks for your business." />
            </Field>
            <TotalsPanel lines={filled} withGst={withGst} interState={interState} />
          </div>
        </div>

        <div className="card-footer" style={{ justifyContent: 'space-between', position: 'sticky', bottom: 0 }}>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <div className="row">
            {(!existing || existing.status === 'Draft') && (
              <button className="btn btn-secondary" onClick={() => save('Draft')}><Save size={15} /> Save as Draft</button>
            )}
            <button className="btn btn-secondary" onClick={() => save('Paid')}><CheckCircle2 size={15} /> Save &amp; mark paid</button>
            <button className="btn btn-primary" onClick={() => save(existing && existing.status !== 'Draft' ? existing.status : 'Unpaid')}><Send size={15} /> {existing ? 'Save invoice' : 'Save & send'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
