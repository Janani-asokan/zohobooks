import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Building2, UserRound, Info, Save, Send, Plus, Wallet, Loader2, AlertTriangle } from 'lucide-react';
import { api, ApiError, fieldErrors } from '@/api/client';
import { SALES_KEYS, useBranches, useCustomers, useInvoice, useItems, useMut, useNextInvoiceNumber, useOrg, useSalesOrders } from '@/api/hooks';
import { TIER_LABEL, type Invoice } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal, Field, PageHeader, Toggle } from '@/components/ui';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { LineItemsEditor, TaxModeToggle, TotalsPanel, emptyLine, toDraft, toInput, useCalcLines, type DraftLine } from '@/components/LineItems';
import { useShortcuts } from '@/components/useShortcuts';
import { addDays, todayISO } from '@/lib/format';
import { fyLabel } from '@/lib/fy';
import { INDIAN_STATES, isInterState } from '../../../shared/gst';

const TERMS = [
  { label: 'Due on receipt', days: 0 }, { label: 'Net 7', days: 7 }, { label: 'Net 15', days: 15 }, { label: 'Net 30', days: 30 }, { label: 'Net 45', days: 45 },
];

export default function InvoiceForm() {
  const { id } = useParams();
  const existing = useInvoice(id);
  if (id && !existing.data) return <FullPageSpinner />;
  return <Form key={id ?? 'new'} existing={existing.data} />;
}

function Form({ existing }: { existing?: Invoice }) {
  const me = useShopUser();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const org = useOrg().data;
  const { data: customers = [] } = useCustomers();
  const { data: branches = [] } = useBranches();
  const { data: items = [] } = useItems();
  const orders = useSalesOrders('order');
  const quotes = useSalesOrders('quote');
  const fromSO = params.get('fromSO') ? [...(orders.data ?? []), ...(quotes.data ?? [])].find((s) => s.id === params.get('fromSO')) : undefined;

  const [customerId, setCustomerId] = useState(existing?.customerId ?? params.get('customer') ?? '');
  const customer = customers.find((c) => c.id === customerId);
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [terms, setTerms] = useState(15);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addDays(todayISO(), 15));
  const [branchId, setBranchId] = useState(existing?.branchId ?? me.user.branchId ?? '');
  const [withGst, setWithGst] = useState(existing?.withGst ?? true);
  const [reverseCharge, setReverseCharge] = useState(existing?.reverseCharge ?? false);
  const [tcsRate, setTcsRate] = useState(existing?.tcsRate ?? 0);
  const [lines, setLines] = useState<DraftLine[]>(() => existing?.lines.map(toDraft) ?? [emptyLine('SP1')]);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [docTerms, setDocTerms] = useState(existing?.terms ?? '');
  const [shipTo, setShipTo] = useState(existing?.shipTo ?? null);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const nextNo = useNextInvoiceNumber(date);

  useEffect(() => { if (!branchId && branches.length) setBranchId(branches.find((b) => b.isPrimary)?.id ?? branches[0]!.id); }, [branches, branchId]);
  useEffect(() => {
    if (fromSO && !existing) {
      setCustomerId(fromSO.customerId);
      setWithGst(fromSO.withGst);
      setNotes(fromSO.notes);
      setLines(fromSO.lines.map(toDraft));
    }
  }, [fromSO, existing]);
  useEffect(() => { if (org?.compositionScheme) setWithGst(false); }, [org?.compositionScheme]);
  // "Sell on invoice" from the item drawer pre-fills the first line.
  const preItem = params.get('item');
  useEffect(() => {
    const it = preItem && !existing ? items.find((i) => i.id === preItem) : undefined;
    if (it) setLines((ls) => (ls.length === 1 && !ls[0]!.itemId ? [{ ...ls[0]!, itemId: it.id, rate: it.sp1, tier: 'SP1' }] : ls));
  }, [preItem, items, existing]);

  const calc = useCalcLines(lines);
  const interState = !!org && !!customer && isInterState(org.state, customer.state || org.state);
  const gstBlocked = org?.compositionScheme ? 'Composition dealers issue a Bill of Supply without GST' : org && !org.gstin ? 'Add your GSTIN in Organization profile to charge GST' : undefined;

  const selectCustomer = (cid: string) => {
    setCustomerId(cid);
    const c = customers.find((x) => x.id === cid);
    if (!c) return;
    // Re-price lines to the customer's default tier.
    setLines((ls) => ls.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      return { ...l, tier: c.tier, rate: it ? (c.tier === 'SP1' ? it.sp1 : c.tier === 'SP2' ? it.sp2 : it.sp3) : l.rate };
    }));
    if (c.type === 'Business' && !gstBlocked) setWithGst(true);
  };

  const filled = lines.filter((l) => l.itemId);
  const invalidLines = useMemo(() => new Set(lines.filter((l) => (l.itemId ? l.qty <= 0 : filled.length === 0)).map((l) => l.key)), [lines, filled.length]);
  const errs = {
    customer: !customerId ? 'Select a customer' : '',
    lines: filled.length === 0 ? 'Add at least one item' : filled.some((l) => l.qty <= 0) ? 'Quantity must be at least 1' : '',
    due: dueDate < date ? 'Due date can’t be before invoice date' : '',
  };

  const keys = SALES_KEYS;
  const create = useMut((b: Record<string, unknown>) => api.post<Invoice>('/shop/invoices', b), keys, { silentError: true });
  const update = useMut((b: Record<string, unknown>) => api.put<Invoice>(`/shop/invoices/${existing!.id}`, b), keys, { silentError: true });
  const busy = create.isPending || update.isPending;

  const [creditPrompt, setCreditPrompt] = useState<{ mode: 'issue' | 'issue-pay'; message: string } | null>(null);
  const save = (mode: 'draft' | 'issue' | 'issue-pay', overrideCreditLimit = false) => {
    setTouched(true);
    setServerErr({});
    if (Object.values(errs).some(Boolean)) return toast('error', 'Please fix the highlighted fields');
    const body = { customerId, date, dueDate, branchId: branchId || null, lines: toInput(lines), withGst, reverseCharge, tcsRate, notes, terms: docTerms, shipTo: shipTo && (shipTo.name || shipTo.address) ? shipTo : null, salesOrderId: fromSO?.id ?? existing?.salesOrderId ?? null, issue: mode !== 'draft', overrideCreditLimit };
    const onSuccess = (inv: Invoice) => {
      toast('success', inv.status === 'Draft' ? 'Draft saved' : existing?.status === 'Issued' ? 'Invoice updated' : 'Invoice issued', inv.number ?? undefined);
      navigate(`/app/sales/invoices/${inv.id}${mode === 'issue-pay' ? '?pay=1' : ''}`);
    };
    const onError = (err: Error) => {
      if (err instanceof ApiError && err.code === 'credit_limit' && mode !== 'draft') return setCreditPrompt({ mode, message: err.message });
      const f = fieldErrors(err); setServerErr(f); toast('error', err.message);
    };
    if (existing) update.mutate(body, { onSuccess, onError });
    else create.mutate(body, { onSuccess, onError });
  };

  useShortcuts({ 'mod+enter': () => !busy && save('issue') });

  const isIssued = existing?.status === 'Issued';
  const number = existing?.number ?? (nextNo.data ? `${nextNo.data.number} (on issue)` : '…');

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <PageHeader
        crumbs={<><Link to="/app/sales/invoices">Invoices</Link> / {existing ? existing.number ?? 'Draft' : 'New'}</>}
        title={existing ? `Edit ${existing.number ?? 'draft'}` : 'New Invoice'}
        subtitle={fromSO ? `Converting ${fromSO.kind === 'quote' ? 'quote' : 'sales order'} ${fromSO.number}` : `Financial year ${fyLabel(date, me.platform.fyStartMonth)}`}
      />

      {isIssued && (
        <div className="row small" style={{ gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--amber-50)', color: 'var(--amber-700)', marginBottom: 14 }}>
          <AlertTriangle size={15} /> This invoice is already issued. Editing keeps its number and re-applies stock. Once it has payments or credit notes, raise a credit note instead.
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="form-grid">
            <Field label="Customer" required error={(touched ? errs.customer : '') || serverErr.customerId}>
              <div className="row" style={{ gap: 8 }}>
                <select className={`select ${touched && errs.customer ? 'invalid' : ''}`} value={customerId} onChange={(e) => selectCustomer(e.target.value)} autoFocus={!existing} aria-label="Customer">
                  <option value="">Select a customer…</option>
                  <optgroup label="Business (B2B)">{customers.filter((c) => c.type === 'Business').map((c) => <option key={c.id} value={c.id}>{c.companyName} · {c.customId}</option>)}</optgroup>
                  <optgroup label="Individuals">{customers.filter((c) => c.type === 'Individual').map((c) => <option key={c.id} value={c.id}>{c.name} · {c.customId}</option>)}</optgroup>
                </select>
                {me.can('customers.write') && <Link to="/app/sales/customers?new=1" className="btn btn-secondary" title="New customer"><Plus size={15} /></Link>}
              </div>
            </Field>
            <div>
              {customer && (
                <div className="card" style={{ boxShadow: 'none', padding: '12px 14px', background: customer.type === 'Business' ? 'var(--violet-50)' : 'var(--ink-50)', borderColor: 'transparent', marginTop: 22 }}>
                  <div className="row" style={{ gap: 10 }}>
                    {customer.type === 'Business' ? <Building2 size={18} style={{ color: 'var(--violet-600)' }} /> : <UserRound size={18} className="muted" />}
                    <div className="small" style={{ lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--ink-900)' }}>{customer.companyName || customer.name}</strong> <span className="chip mono">{customer.customId}</span>
                      <div className="muted">{customer.type === 'Business' ? `GSTIN ${customer.gstin}` : 'Individual (B2C)'} · {customer.state} · Tier {customer.tier} ({TIER_LABEL[customer.tier]}){customer.due > 0 ? ` · ₹${customer.due.toLocaleString('en-IN')} outstanding` : ''}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Field label="Invoice #" hint={existing?.number ? 'Invoice numbers are permanent' : me.platform.autoResetInvoiceNumbering ? 'Assigned when issued · resets every 1 April' : 'Assigned when issued · continuous'}>
              <input className="input" readOnly value={number} style={{ fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace' }} />
            </Field>
            <Field label="Branch" hint="Stock is taken from this branch">
              <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
            <Field label="Invoice date" required>
              <input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setDueDate(addDays(e.target.value, terms)); }} disabled={isIssued} />
            </Field>
            <div className="form-grid" style={{ gap: 12 }}>
              <Field label="Terms"><select className="select" value={terms} onChange={(e) => { const d = Number(e.target.value); setTerms(d); setDueDate(addDays(date, d)); }}>{TERMS.map((t) => <option key={t.days} value={t.days}>{t.label}</option>)}</select></Field>
              <Field label="Due date" error={(touched ? errs.due : '') || serverErr.dueDate}><input className={`input ${touched && errs.due ? 'invalid' : ''}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            </div>
          </div>
        </div>

        <div className="card-body" style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <TaxModeToggle withGst={withGst} onChange={setWithGst} disabled={gstBlocked} />
            <span className="row small muted" style={{ gap: 6 }}>
              <Info size={14} />
              {gstBlocked ?? (withGst ? (interState ? 'Inter-state supply → IGST' : 'Intra-state supply → CGST + SGST') : 'Totals shown without any tax')}
            </span>
          </div>
          <LineItemsEditor lines={lines} onChange={setLines} defaultTier={customer?.tier ?? 'SP1'} withGst={withGst} invalidKeys={touched ? invalidLines : undefined} branchId={branchId} />
          {touched && errs.lines && <div className="field-error" style={{ marginTop: 8 }}>{errs.lines}</div>}

          <div className="grid-2 mt-24" style={{ alignItems: 'start' }}>
            <div className="stack" style={{ gap: 14 }}>
              <Field label="Customer notes" hint="Printed on the invoice">
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thanks for your business." />
              </Field>
              <Field label="Terms and conditions" hint="Leave blank to use the default terms from Print settings">
                <textarea className="textarea" rows={3} maxLength={1500} value={docTerms} onChange={(e) => setDocTerms(e.target.value)} placeholder="Default terms" />
              </Field>
              <div className="card" style={{ padding: 14, boxShadow: 'none' }}>
                <div className="row between">
                  <div><div className="strong" style={{ color: 'var(--ink-900)' }}>Ship to a different address</div><div className="small muted">Printed next to the billing address</div></div>
                  <Toggle checked={!!shipTo} onChange={(v) => setShipTo(v ? { name: customer?.companyName || customer?.name || '', address: '', state: customer?.state ?? '', gstin: '' } : null)} />
                </div>
                {shipTo && (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <Field label="Name"><input className="input" value={shipTo.name} maxLength={120} onChange={(e) => setShipTo({ ...shipTo, name: e.target.value })} /></Field>
                    <Field label="State"><select className="select" value={shipTo.state} onChange={(e) => setShipTo({ ...shipTo, state: e.target.value })}><option value="">Select</option>{INDIAN_STATES.map((st) => <option key={st}>{st}</option>)}</select></Field>
                    <Field label="Address" className="span-all"><textarea className="textarea" rows={2} maxLength={500} value={shipTo.address} onChange={(e) => setShipTo({ ...shipTo, address: e.target.value })} /></Field>
                  </div>
                )}
              </div>
              {withGst && (
                <div className="card" style={{ padding: 14, boxShadow: 'none' }}>
                  <div className="row between">
                    <div><div className="strong" style={{ color: 'var(--ink-900)' }}>Reverse charge</div><div className="small muted">The recipient pays GST to the government (RCM)</div></div>
                    <Toggle checked={reverseCharge} onChange={setReverseCharge} />
                  </div>
                  <div className="divider" style={{ margin: '12px 0' }} />
                  <div className="row between">
                    <div><div className="strong" style={{ color: 'var(--ink-900)' }}>TCS</div><div className="small muted">Tax collected at source, if applicable</div></div>
                    <select className="select" style={{ width: 120 }} value={tcsRate} onChange={(e) => setTcsRate(Number(e.target.value))} aria-label="TCS rate">{[0, 0.1, 1, 5].map((r) => <option key={r} value={r}>{r ? `${r}%` : 'None'}</option>)}</select>
                  </div>
                </div>
              )}
            </div>
            <TotalsPanel lines={calc} withGst={withGst} interState={interState} tcsRate={withGst ? tcsRate : 0} />
          </div>
        </div>

        <div className="card-footer doc-footer">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(!existing || existing.status === 'Draft') && <button className="btn btn-secondary" disabled={busy} onClick={() => save('draft')}><Save size={15} /> Save as Draft</button>}
            {(!existing || existing.status === 'Draft') && me.can('payments.write') && <button className="btn btn-secondary" disabled={busy} onClick={() => save('issue-pay')}><Wallet size={15} /> Issue &amp; record payment</button>}
            <button className="btn btn-primary" disabled={busy} onClick={() => save('issue')} title="Ctrl Enter">{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {isIssued ? 'Save invoice' : 'Issue invoice'}</button>
          </div>
        </div>
      </div>
      <ConfirmModal open={!!creditPrompt} onClose={() => setCreditPrompt(null)} title="Over the credit limit" confirmLabel="Issue anyway"
        text={<>{creditPrompt?.message} Issue the invoice anyway? This is recorded in the audit log.</>}
        onConfirm={() => { const m = creditPrompt!.mode; setCreditPrompt(null); save(m, true); }} />
    </div>
  );
}
