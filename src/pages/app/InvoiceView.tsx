import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Printer, Wallet, Trash2, FileX, Share2, MessageCircle, Mail, Link2, Bell, FileJson, Truck, Ban, Send, ChevronDown, Receipt, Undo2, Loader2, Download, ExternalLink, BadgeCheck } from 'lucide-react';
import { api, download, fieldErrors } from '@/api/client';
import { SALES_KEYS, useBankAccounts, useBranches, useInvoice, useMut, useOrg, usePrintSettings } from '@/api/hooks';
import { printInvoice, printRoute, type PrintPaper } from '@/lib/printInvoice';
import { withPrintDefaults } from '../../../shared/printSettings';
import type { InvoiceDetail, Organization } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal, EmptyState, Field, Modal, Segmented } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { TaxInvoice } from '@/components/TaxInvoice';
import { useClickOutside } from '@/components/useClickOutside';
import { fmtDate, money, todayISO } from '@/lib/format';

const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

export function whatsappText(inv: InvoiceDetail, org: Pick<Organization, 'companyName' | 'upiId'>, reminder = false) {
  const who = inv.customer.companyName || inv.customer.name;
  const link = inv.publicToken ? shareUrl(inv.publicToken) : '';
  const lines = reminder
    ? [`Dear ${who},`, `This is a gentle reminder that invoice ${inv.number} dated ${fmtDate(inv.date)} has ${money(inv.balance)} due${inv.paymentStatus === 'Overdue' ? ` (was due on ${fmtDate(inv.dueDate)})` : ` by ${fmtDate(inv.dueDate)}`}.`]
    : [`Dear ${who},`, `Thank you for your business! Here is invoice ${inv.number} for ${money(inv.total)}.`];
  if (link) lines.push(`View / download: ${link}`);
  if (org.upiId && inv.balance > 0) lines.push(`Pay by UPI: ${org.upiId}`);
  lines.push(`— ${org.companyName}`);
  return lines.join('\n');
}

export const waLink = (phone: string, text: string) => {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return `https://wa.me/${digits.length === 10 ? '91' + digits : ''}?text=${encodeURIComponent(text)}`;
};

function Menu({ label, icon: Icon, children, primary }: { label: string; icon: typeof Share2; children: (close: () => void) => React.ReactNode; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}><Icon size={15} /> {label} <ChevronDown size={14} /></button>
      {open && <div className="dropdown" role="menu">{children(close)}</div>}
    </div>
  );
}

export default function InvoiceView() {
  const { id } = useParams();
  const me = useShopUser();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useInvoice(id);
  const org = useOrg().data;
  const printCfg = withPrintDefaults(usePrintSettings().data);
  const branches = useBranches().data ?? [];
  const accounts = useBankAccounts().data ?? [];
  const inv = q.data;

  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', tdsAmount: '', mode: 'UPI' as 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Cheque', reference: '', date: todayISO(), accountId: '' });
  const [payErr, setPayErr] = useState<Record<string, string>>({});
  const [cnOpen, setCnOpen] = useState(false);
  const [cnReason, setCnReason] = useState<'Sales return' | 'Post-sale discount' | 'Deficiency in service' | 'Correction in invoice' | 'Other'>('Sales return');
  const [cnQty, setCnQty] = useState<Record<string, string>>({});
  const [cnRestock, setCnRestock] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delPayment, setDelPayment] = useState<string | null>(null);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewb, setEwb] = useState({ distanceKm: '', vehicleNo: '', transporterName: '', transporterId: '' });
  const [ewbErr, setEwbErr] = useState('');
  const [mailOpen, setMailOpen] = useState(false);
  const [mail, setMail] = useState({ to: '', cc: '', message: '' });
  const [refsOpen, setRefsOpen] = useState(false);
  const [refs, setRefs] = useState({ irn: '', ackNo: '', ackDate: '', signedQr: '', ewayBillNo: '', ewayDate: '', vehicleNo: '' });
  const [refsErr, setRefsErr] = useState<Record<string, string>>({});
  const [pdfBusy, setPdfBusy] = useState(false);

  const keys = SALES_KEYS;
  const payMut = useMut((b: Record<string, unknown>) => api.post(`/shop/invoices/${id}/payments`, b), keys, { silentError: true });
  const delPay = useMut((pid: string) => api.del(`/shop/payments/${pid}`), keys, { success: 'Payment removed' });
  const cnMut = useMut((b: Record<string, unknown>) => api.post<{ number: string }>('/shop/credit-notes', b), keys, { success: (r) => `Credit note ${r.number} created` });
  const cancelMut = useMut((reason: string) => api.post(`/shop/invoices/${id}/cancel`, { reason }), keys, { success: 'Invoice cancelled — stock restored' });
  const delMut = useMut(() => api.del(`/shop/invoices/${id}`), keys, { success: 'Draft deleted' });
  const issueMut = useMut((b: Record<string, unknown>) => api.put(`/shop/invoices/${id}`, b), keys, { success: 'Invoice issued' });
  const mailMut = useMut((b: typeof mail) => api.post<{ status: string; detail: string }>(`/shop/invoices/${id}/email`, b), [['invoice']], { silentError: true });
  const refsMut = useMut((b: typeof refs) => api.put(`/shop/invoices/${id}/gst-refs`, b), keys, { silentError: true });
  const remind = useMut((channel: 'email' | 'whatsapp') => api.post<{ status: string; detail: string }>(`/shop/invoices/${id}/reminders`, { channel }), [['invoice']], {});

  useEffect(() => {
    if (!inv) return;
    if (params.get('pay') && inv.status === 'Issued' && inv.balance > 0) { openPay(); params.delete('pay'); setParams(params, { replace: true }); }
    if (params.get('print')) { params.delete('print'); setParams(params, { replace: true }); doPrint('a4'); }
  }, [inv?.id]);

  if (q.isError) return <div className="page"><div className="card"><EmptyState icon={FileX} title="Invoice not found" text={q.error.message} action={<Link to="/app/sales/invoices" className="btn btn-primary">Back to invoices</Link>} /></div></div>;
  if (!inv || !org) return <div className="page"><div className="skeleton" style={{ height: 600 }} /></div>;

  function doPrint(paper: PrintPaper) {
    printInvoice(id!, paper).catch((e) => toast('error', 'Could not print', e.message));
  }
  const downloadPdf = (paper: PrintPaper = 'a4') => {
    setPdfBusy(true);
    download(`/shop/invoices/${id}/pdf?paper=${paper}`, `${inv?.number ?? 'draft-invoice'}.pdf`)
      .catch((e) => toast('error', 'PDF not ready', e.message))
      .finally(() => setPdfBusy(false));
  };
  const openPay = () => { setPay({ amount: String(inv.balance), tdsAmount: '', mode: 'UPI', reference: '', date: todayISO(), accountId: '' }); setPayErr({}); setPayOpen(true); };
  const savePay = () => {
    const amount = Number(pay.amount);
    const tds = Number(pay.tdsAmount || 0);
    if (!(amount > 0)) return setPayErr({ amount: 'Enter the amount received' });
    if (amount + tds > inv.balance + 0.009) return setPayErr({ amount: `More than the balance due (${money(inv.balance)})` });
    payMut.mutate({ amount, tdsAmount: tds, mode: pay.mode, reference: pay.reference, date: pay.date, accountId: pay.accountId || null }, {
      onSuccess: () => { setPayOpen(false); toast('success', 'Payment recorded', `${money(amount)} via ${pay.mode}`); },
      onError: (e) => { setPayErr(fieldErrors(e)); toast('error', e.message); },
    });
  };

  const credited = new Map<string, number>();
  for (const cn of inv.creditNotes) for (const l of cn.lines) credited.set(l.lineId, (credited.get(l.lineId) ?? 0) + l.qty);
  const saveCn = () => {
    const lines = inv.lines.map((l) => ({ lineId: l.id, qty: Number(cnQty[l.id] || 0) })).filter((l) => l.qty > 0);
    if (!lines.length) return toast('error', 'Enter a quantity for at least one line');
    cnMut.mutate({ invoiceId: inv.id, date: todayISO(), reason: cnReason, restock: cnRestock, lines }, { onSuccess: () => setCnOpen(false) });
  };

  const branchRow = branches.find((b) => b.id === inv.branchId);
  const branchInfo = branchRow ? { name: branchRow.name, address: branchRow.address, phone: branchRow.phone } : null;
  const canSell = me.can('sales.write');
  const editable = canSell && (inv.status === 'Draft' || (inv.status === 'Issued' && inv.amountPaid === 0 && inv.amountCredited === 0));
  const hasGoods = inv.lines.some((l) => l.type === 'Goods');
  const phone = inv.customer.phone;

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="row between no-print" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div className="row">
          <button className="icon-btn" onClick={() => navigate('/app/sales/invoices')} aria-label="Back"><ArrowLeft size={18} /></button>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600 }}>{inv.number ?? 'Draft invoice'}</h1>
              <StatusBadge status={inv.paymentStatus} />
              {inv.source !== 'app' && <span className="chip">{inv.source === 'pos' ? 'POS' : 'Recurring'}</span>}
            </div>
            <div className="small muted">{inv.customer.companyName || inv.customer.name} · {money(inv.total)}{inv.balance > 0 && inv.status === 'Issued' ? ` · ${money(inv.balance)} due` : ''}</div>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {inv.status === 'Draft' && canSell && (
            <button className="btn btn-primary" disabled={issueMut.isPending} onClick={() => issueMut.mutate({ customerId: inv.customerId, date: inv.date, dueDate: inv.dueDate, branchId: inv.branchId, lines: inv.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, tier: l.tier, rate: l.rate, discount: l.discount })), withGst: inv.withGst, reverseCharge: inv.reverseCharge, tcsRate: inv.tcsRate, notes: inv.notes, issue: true })}>
              <Send size={15} /> Issue invoice
            </button>
          )}
          {editable && <Link to={`/app/sales/invoices/${inv.id}/edit`} className="btn btn-secondary"><Pencil size={15} /> Edit</Link>}
          {inv.status === 'Issued' && inv.balance > 0 && me.can('payments.write') && <button className="btn btn-primary" onClick={openPay}><Wallet size={15} /> Record payment</button>}
          {inv.status === 'Issued' && (
            <Menu label="Share" icon={Share2}>
              {(close) => (
                <>
                  <a className="dropdown-item" href={waLink(phone, whatsappText(inv, org))} target="_blank" rel="noreferrer" onClick={close}><MessageCircle size={16} /> Send on WhatsApp</a>
                  {inv.balance > 0 && (
                    <a className="dropdown-item" href={waLink(phone, whatsappText(inv, org, true))} target="_blank" rel="noreferrer" onClick={() => { close(); remind.mutate('whatsapp'); }}><Bell size={16} /> WhatsApp payment reminder</a>
                  )}
                  {canSell && <button className="dropdown-item" onClick={() => { close(); setMail({ to: inv.customer.email, cc: '', message: '' }); setMailOpen(true); }}><Mail size={16} /> Email invoice with PDF</button>}
                  <a className="dropdown-item" href={`mailto:${inv.customer.email}?subject=${encodeURIComponent(`Invoice ${inv.number} from ${org.companyName}`)}&body=${encodeURIComponent(whatsappText(inv, org))}`} onClick={close}><ExternalLink size={16} /> Email from my mail app</a>
                  {inv.balance > 0 && canSell && (
                    <button className="dropdown-item" onClick={() => { close(); remind.mutate('email', { onSuccess: (r) => toast(r.status === 'sent' ? 'success' : 'info', r.status === 'sent' ? 'Reminder emailed' : 'Reminder not emailed', r.detail) }); }}><Send size={16} /> Email reminder (from server)</button>
                  )}
                  <div className="dropdown-sep" />
                  <button className="dropdown-item" onClick={() => { close(); navigator.clipboard?.writeText(shareUrl(inv.publicToken!)); toast('success', 'Link copied', 'Anyone with the link can view this invoice.'); }}><Link2 size={16} /> Copy public link</button>
                </>
              )}
            </Menu>
          )}
          <Menu label="Print" icon={Printer}>
            {(close) => (
              <>
                <button className="dropdown-item" onClick={() => { close(); doPrint('a4'); }}><Printer size={16} /> Print A4</button>
                <button className="dropdown-item" onClick={() => { close(); doPrint('a5'); }}><Printer size={16} /> Print A5</button>
                <button className="dropdown-item" onClick={() => { close(); doPrint('thermal'); }}><Receipt size={16} /> Print receipt ({printCfg.thermal.paper === '2in' ? '58' : '80'}mm)</button>
                <div className="dropdown-sep" />
                <button className="dropdown-item" disabled={pdfBusy} onClick={() => { close(); downloadPdf(printCfg.invoice.paper); }}><Download size={16} /> Download PDF</button>
                <Link className="dropdown-item" to={printRoute(inv.id, printCfg.invoice.paper)} onClick={close}><ExternalLink size={16} /> Open print view</Link>
                {me.can('admin') && <><div className="dropdown-sep" /><button className="dropdown-item" onClick={() => { close(); navigate('/app/print-settings'); }}><Pencil size={16} /> Invoice layout settings</button></>}
              </>
            )}
          </Menu>
          {(inv.status === 'Issued' || inv.status === 'Draft') && (
            <Menu label="More" icon={Receipt}>
              {(close) => (
                <>
                  {inv.status === 'Issued' && canSell && <button className="dropdown-item" onClick={() => { close(); setCnQty({}); setCnRestock(true); setCnOpen(true); }}><Undo2 size={16} /> Create credit note</button>}
                  {inv.status === 'Issued' && inv.customer.gstin && <button className="dropdown-item" onClick={() => { close(); download(`/shop/invoices/${inv.id}/einvoice.json`, `einvoice-${inv.number}.json`).then(() => toast('success', 'E-invoice JSON downloaded', 'Upload it on the IRP portal (einvoice1.gst.gov.in).')).catch((e) => toast('error', e.message)); }}><FileJson size={16} /> E-invoice JSON</button>}
                  {inv.status === 'Issued' && hasGoods && <button className="dropdown-item" onClick={() => { close(); setEwbErr(''); setEwbOpen(true); }}><Truck size={16} /> E-way bill JSON</button>}
                  {inv.status === 'Issued' && canSell && <button className="dropdown-item" onClick={() => { close(); setRefs({ irn: inv.einvoice?.irn ?? '', ackNo: inv.einvoice?.ackNo ?? '', ackDate: inv.einvoice?.ackDate ?? '', signedQr: inv.einvoice?.signedQr ?? '', ewayBillNo: inv.eway?.number ?? '', ewayDate: inv.eway?.date ?? '', vehicleNo: inv.eway?.vehicleNo ?? '' }); setRefsErr({}); setRefsOpen(true); }}><BadgeCheck size={16} /> Record IRN / e-way bill no.</button>}
                  <div className="dropdown-sep" />
                  {inv.status === 'Issued' && canSell && <button className="dropdown-item danger" onClick={() => { close(); setCancelReason(''); setCancelOpen(true); }}><Ban size={16} /> Cancel invoice</button>}
                  {inv.status === 'Draft' && canSell && <button className="dropdown-item danger" onClick={() => { close(); setDelOpen(true); }}><Trash2 size={16} /> Delete draft</button>}
                </>
              )}
            </Menu>
          )}
        </div>
      </div>

      <div className="grid-3-1" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start' }}>
        <div>
          <div className="paper-stage">
            <div className="paper-scale" style={{ ['--paper-zoom' as string]: printCfg.invoice.paper === 'a5' ? 1 : 0.86 }}>
              <TaxInvoice inv={inv} org={org} branch={branchInfo} s={printCfg.invoice} />
            </div>
          </div>
        </div>

        <aside className="stack no-print" style={{ position: 'sticky', top: 84 }}>
          <div className="card">
            <div className="card-header"><h3>Payments</h3>{inv.status === 'Issued' && <span className="small strong">{money(inv.amountPaid)}</span>}</div>
            <div className="card-body" style={{ padding: 14 }}>
              {inv.payments.length === 0 && <p className="small muted">No payments yet.</p>}
              {inv.payments.map((p) => (
                <div key={p.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--ink-150)' }}>
                  <div>
                    <div className="strong" style={{ color: 'var(--ink-900)' }}>{money(p.amount)}{p.tdsAmount > 0 && <span className="small muted"> + TDS {money(p.tdsAmount)}</span>}</div>
                    <div className="small muted">{fmtDate(p.date)} · {p.mode}{p.reference ? ` · ${p.reference}` : ''}{p.account ? ` → ${p.account}` : ''}</div>
                  </div>
                  {me.can('payments.write') && <button className="icon-btn sm danger" title="Remove payment" onClick={() => setDelPayment(p.id)}><Trash2 size={13} /></button>}
                </div>
              ))}
            </div>
          </div>
          {inv.creditNotes.length > 0 && (
            <div className="card">
              <div className="card-header"><h3>Credit notes</h3><span className="small strong">{money(inv.amountCredited)}</span></div>
              <div className="card-body" style={{ padding: 14 }}>
                {inv.creditNotes.map((cn) => (
                  <div key={cn.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--ink-150)' }}>
                    <div className="row between"><span className="strong">{cn.number}</span><span className="strong">{money(cn.total)}</span></div>
                    <div className="small muted">{fmtDate(cn.date)} · {cn.reason}{cn.restock ? ' · restocked' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-header"><h3>Activity</h3></div>
            <div className="card-body" style={{ padding: 14 }}>
              <div className="timeline">
                <div className="timeline-item"><div className="small strong">Created</div><div className="small muted">{new Date(inv.createdAt).toLocaleString('en-IN')}</div></div>
                {inv.issuedAt && <div className="timeline-item"><div className="small strong">Issued {inv.number}</div><div className="small muted">{new Date(inv.issuedAt).toLocaleString('en-IN')}</div></div>}
                {inv.reminders.map((r, i) => <div key={i} className="timeline-item"><div className="small strong">Reminder · {r.channel}</div><div className="small muted">{new Date(r.at).toLocaleString('en-IN')} · {r.detail}</div></div>)}
                {inv.cancelledAt && <div className="timeline-item"><div className="small strong" style={{ color: 'var(--red-600)' }}>Cancelled</div><div className="small muted">{inv.cancelReason}</div></div>}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" subtitle={`${inv.number} · balance ${money(inv.balance)}`}
        footer={<><button className="btn btn-secondary" onClick={() => setPayOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={payMut.isPending} onClick={savePay}>{payMut.isPending && <Loader2 size={15} className="spin" />} Save payment</button></>}>
        <div className="form-grid">
          <Field label="Amount received" required error={payErr.amount}><div className="input-addon"><span>₹</span><input className={`input ${payErr.amount ? 'invalid' : ''}`} type="number" min={0} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus /></div></Field>
          <Field label="Payment date"><input className="input" type="date" value={pay.date} max={todayISO()} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          <Field label="Mode" className="span-all">
            <Segmented value={pay.mode} onChange={(v) => setPay({ ...pay, mode: v })} options={(['UPI', 'Cash', 'Card', 'Bank Transfer', 'Cheque'] as const).map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label="Reference" hint="UTR / cheque / card slip number"><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          <Field label="Deposit to"><select className="select" value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}><option value="">Auto ({pay.mode === 'Cash' ? 'cash account' : 'bank account'})</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {inv.customer.gstin && <Field label="TDS deducted by customer" hint="Counts towards settling the invoice"><div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={pay.tdsAmount} onChange={(e) => setPay({ ...pay, tdsAmount: e.target.value })} /></div></Field>}
        </div>
      </Modal>

      <Modal open={cnOpen} onClose={() => setCnOpen(false)} size="lg" title="Create credit note" subtitle={`Against ${inv.number}. Reduces the amount the customer owes and is reported in GSTR-1.`}
        footer={<><button className="btn btn-secondary" onClick={() => setCnOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={cnMut.isPending} onClick={saveCn}>Create credit note</button></>}>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <Field label="Reason"><select className="select" value={cnReason} onChange={(e) => setCnReason(e.target.value as typeof cnReason)}>{['Sales return', 'Post-sale discount', 'Deficiency in service', 'Correction in invoice', 'Other'].map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Stock"><label className="row" style={{ gap: 8, height: 40 }}><input type="checkbox" className="checkbox" checked={cnRestock} onChange={(e) => setCnRestock(e.target.checked)} /> Return goods to stock</label></Field>
        </div>
        <table className="table">
          <thead><tr><th>Item</th><th className="num">Invoiced</th><th className="num">Already credited</th><th className="num" style={{ width: 120 }}>Credit qty</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => {
              const left = l.qty - (credited.get(l.id) ?? 0);
              return (
                <tr key={l.id}>
                  <td className="strong">{l.name}<div className="muted">{money(l.rate)} each</div></td>
                  <td className="num">{l.qty}</td>
                  <td className="num muted">{credited.get(l.id) ?? 0}</td>
                  <td className="num"><input className="input" type="number" min={0} max={left} disabled={left <= 0} value={cnQty[l.id] ?? ''} placeholder={left > 0 ? `max ${left}` : '—'} onChange={(e) => setCnQty({ ...cnQty, [l.id]: String(Math.min(left, Math.max(0, Number(e.target.value)))) })} style={{ textAlign: 'right' }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>

      <Modal open={ewbOpen} onClose={() => setEwbOpen(false)} title="E-way bill details" subtitle="Required for moving goods worth over ₹50,000. Downloads JSON for the e-way bill portal’s bulk upload."
        footer={<><button className="btn btn-secondary" onClick={() => setEwbOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          setEwbErr('');
          download(`/shop/invoices/${inv.id}/ewaybill.json`, `ewaybill-${inv.number}.json`, { method: 'POST', body: { distanceKm: Number(ewb.distanceKm || 0), vehicleNo: ewb.vehicleNo, transporterName: ewb.transporterName || undefined, transporterId: ewb.transporterId || undefined, mode: 1 } })
            .then(() => { setEwbOpen(false); toast('success', 'E-way bill JSON downloaded', 'Upload it on ewaybillgst.gov.in → Bulk generation.'); })
            .catch((e) => setEwbErr(e.message));
        }}>Download JSON</button></>}>
        <div className="form-grid">
          <Field label="Vehicle number" required><input className="input" value={ewb.vehicleNo} onChange={(e) => setEwb({ ...ewb, vehicleNo: e.target.value.toUpperCase() })} placeholder="TN01AB1234" /></Field>
          <Field label="Distance (km)" required><input className="input" type="number" min={0} value={ewb.distanceKm} onChange={(e) => setEwb({ ...ewb, distanceKm: e.target.value })} /></Field>
          <Field label="Transporter name"><input className="input" value={ewb.transporterName} onChange={(e) => setEwb({ ...ewb, transporterName: e.target.value })} /></Field>
          <Field label="Transporter ID (GSTIN)"><input className="input" value={ewb.transporterId} onChange={(e) => setEwb({ ...ewb, transporterId: e.target.value.toUpperCase() })} maxLength={15} /></Field>
        </div>
        {ewbErr && <div className="field-error" style={{ marginTop: 10 }}>{ewbErr}</div>}
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel invoice?" subtitle="The number stays in your series (reported as cancelled in GSTR-1) and goods go back to stock."
        footer={<><button className="btn btn-secondary" onClick={() => setCancelOpen(false)}>Keep invoice</button><button className="btn btn-danger" disabled={cancelReason.trim().length < 3 || cancelMut.isPending} onClick={() => cancelMut.mutate(cancelReason, { onSuccess: () => setCancelOpen(false) })}>Cancel invoice</button></>}>
        <Field label="Reason" required><input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Order cancelled by customer" autoFocus /></Field>
        {inv.amountPaid > 0 && <p className="field-error" style={{ marginTop: 10 }}>Remove the recorded payments first.</p>}
      </Modal>

      <Modal open={mailOpen} onClose={() => setMailOpen(false)} title="Email invoice" subtitle={`${inv.number} goes as a PDF attachment, with a link to view it online.`}
        footer={<><button className="btn btn-secondary" onClick={() => setMailOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={mailMut.isPending || !mail.to} onClick={() => mailMut.mutate(mail, {
          onSuccess: (r) => { setMailOpen(false); toast(r.status === 'sent' ? 'success' : 'info', r.status === 'sent' ? 'Invoice emailed' : 'Email not sent', r.detail); },
          onError: (e) => toast('error', e.message),
        })}>{mailMut.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send</button></>}>
        <div className="form-grid">
          <Field label="To" required className="span-all"><input className="input" type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="customer@example.com" autoFocus /></Field>
          <Field label="Cc" className="span-all"><input className="input" type="email" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} /></Field>
          <Field label="Message" hint="Leave blank for the standard note with the amount and due date." className="span-all"><textarea className="textarea" rows={4} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={refsOpen} onClose={() => setRefsOpen(false)} title="IRN and e-way bill" subtitle="After you upload to the IRP and the e-way bill portal, paste the numbers here. They print on the invoice with the e-invoice QR."
        footer={<><button className="btn btn-secondary" onClick={() => setRefsOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={refsMut.isPending} onClick={() => refsMut.mutate(refs, {
          onSuccess: () => { setRefsOpen(false); toast('success', 'Saved', 'The invoice now shows these references.'); },
          onError: (e) => { setRefsErr(fieldErrors(e)); toast('error', e.message); },
        })}>Save</button></>}>
        <div className="form-grid">
          <Field label="IRN" hint="64 characters, from the IRP acknowledgement" error={refsErr.irn} className="span-all"><input className="input mono" value={refs.irn} onChange={(e) => setRefs({ ...refs, irn: e.target.value.trim() })} maxLength={64} /></Field>
          <Field label="Ack no." error={refsErr.ackNo}><input className="input" value={refs.ackNo} onChange={(e) => setRefs({ ...refs, ackNo: e.target.value })} /></Field>
          <Field label="Ack date" error={refsErr.ackDate}><input className="input" value={refs.ackDate} onChange={(e) => setRefs({ ...refs, ackDate: e.target.value })} placeholder="18-10-2026 14:05" /></Field>
          <Field label="Signed QR code" hint="Optional. Paste the SignedQRCode value; otherwise the QR encodes the IRN." className="span-all"><textarea className="textarea mono" rows={2} value={refs.signedQr} onChange={(e) => setRefs({ ...refs, signedQr: e.target.value.trim() })} /></Field>
          <Field label="E-way bill no." hint="12 digits" error={refsErr.ewayBillNo}><input className="input" inputMode="numeric" value={refs.ewayBillNo} onChange={(e) => setRefs({ ...refs, ewayBillNo: e.target.value.replace(/\D/g, '').slice(0, 12) })} /></Field>
          <Field label="Vehicle no."><input className="input" value={refs.vehicleNo} onChange={(e) => setRefs({ ...refs, vehicleNo: e.target.value.toUpperCase() })} placeholder="TN01AB1234" /></Field>
        </div>
      </Modal>

      <ConfirmModal open={delOpen} onClose={() => setDelOpen(false)} title="Delete draft?" text="Drafts have no invoice number yet, so deleting one leaves no gap in your series." onConfirm={() => delMut.mutate(undefined, { onSuccess: () => navigate('/app/sales/invoices') })} />
      <ConfirmModal open={!!delPayment} onClose={() => setDelPayment(null)} title="Remove payment?" confirmLabel="Remove" text="The invoice balance and the linked bank entry will be reversed." onConfirm={() => delPay.mutate(delPayment!)} />
    </div>
  );
}
