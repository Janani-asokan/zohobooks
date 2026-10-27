import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink, Printer, Download, Wallet, Pencil } from 'lucide-react';

import { useInvoice } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { downloadInvoicePdf } from '@/lib/report';
import { useToast } from '@/context/ToastContext';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDate, money, num2 } from '@/lib/format';
import { preparePrint, printInvoice } from '@/lib/printInvoice';

/** Quick look at an invoice beside the list: totals, lines, payments and the common actions. */
export function InvoicePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useShopUser();
  const toast = useToast();
  const q = useInvoice(id);
  const inv = q.data;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="split-panel" aria-label="Invoice details">
      <div className="split-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2>{inv ? inv.number ?? 'Draft invoice' : 'Invoice'}</h2>
            {inv && <StatusBadge status={inv.paymentStatus} />}
          </div>
          {inv && <div className="small muted">{inv.customer.companyName || inv.customer.name} · {fmtDate(inv.date)}</div>}
        </div>
        <Link className="icon-btn" to={`/app/sales/invoices/${id}`} aria-label="Open full invoice" title="Open"><ExternalLink size={16} /></Link>
        <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Esc"><X size={18} /></button>
      </div>
      <div className="split-panel-body">
        {q.isLoading ? <div className="skeleton" style={{ height: 320 }} /> : q.isError || !inv ? (
          <div className="error-state">Couldn’t load this invoice. <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {inv.status === 'Issued' && inv.balance > 0 && me.can('payments.write') && <Link className="btn btn-primary btn-sm" to={`/app/sales/invoices/${id}?pay=1`}><Wallet size={14} /> Record payment</Link>}
              {me.can('sales.write') && (inv.status === 'Draft' || (inv.status === 'Issued' && inv.amountPaid === 0 && inv.amountCredited === 0)) && <Link className="btn btn-secondary btn-sm" to={`/app/sales/invoices/${id}/edit`}><Pencil size={14} /> Edit</Link>}
              <button className="btn btn-secondary btn-sm" onPointerEnter={() => preparePrint(id, 'a4')} onFocus={() => preparePrint(id, 'a4')} onClick={() => printInvoice(id, 'a4').catch((e) => toast('error', 'Could not print', e.message))}><Printer size={14} /> Print</button>
              <button className="btn btn-secondary btn-sm" onClick={() => downloadInvoicePdf(id, `${inv.number ?? 'draft-invoice'}.pdf`).then((how) => how === 'print' && toast('info', 'Print window opened', 'Choose “Save as PDF” as the printer to keep a copy.')).catch((e) => toast('error', 'PDF not ready', e.message))}><Download size={14} /> PDF</button>
            </div>
            <div className="kpi-row">
              <div><div className="k">Total</div><div className="v">{money(inv.total)}</div></div>
              <div><div className="k">{inv.status === 'Issued' ? 'Balance due' : 'Status'}</div><div className="v">{inv.status === 'Issued' ? money(Math.max(0, inv.balance)) : inv.paymentStatus}</div></div>
              <div><div className="k">Due date</div><div className="v">{fmtDate(inv.dueDate)}</div></div>
              <div><div className="k">Place of supply</div><div className="v" style={{ fontSize: 14 }}>{inv.placeOfSupply}</div></div>
            </div>
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l) => <tr key={l.id}><td>{l.name}<div className="small muted">{num2(l.rate)} × {l.qty} {l.unit}{l.discount ? ` · ${l.discount}% off` : ''}</div></td><td className="num">{l.qty}</td><td className="num">{num2(l.amount)}</td></tr>)}
              </tbody>
              <tfoot>
                <tr><td colSpan={2} className="muted">Taxable</td><td className="num">{num2(inv.subTotal)}</td></tr>
                {inv.withGst && <tr><td colSpan={2} className="muted">GST</td><td className="num">{num2(inv.taxTotal)}</td></tr>}
                <tr><td colSpan={2} className="strong">Total</td><td className="num strong">{money(inv.total)}</td></tr>
              </tfoot>
            </table>
            <div>
              <div className="strong" style={{ marginBottom: 6 }}>Payments</div>
              {inv.payments.length === 0 ? <p className="small muted">No payments yet.</p> : inv.payments.map((p) => (
                <div key={p.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{fmtDate(p.date)} · {p.mode}{p.reference ? ` · ${p.reference}` : ''}</span><span className="strong">{money(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
