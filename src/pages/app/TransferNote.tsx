import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/api/client';
import { useOrg } from '@/api/hooks';
import type { TransferDetail } from '@/api/types';
import { fmtDate, money } from '@/lib/format';
import { EWAY_BILL_THRESHOLD } from '../../../shared/transfers';

/**
 * Stock Transfer Note / delivery challan for moving goods between branches (Rule 55, CGST Rules): batch, HSN, tax
 * rate, quantity, value at cost and the destination price. Between two branches on one GSTIN this is not a sale, so no
 * tax is charged; between different GSTINs it is a supply between distinct persons and needs a tax invoice.
 */
export default function TransferNote() {
  const { id } = useParams();
  const org = useOrg().data;
  const q = useQuery({ queryKey: ['transfer', id], queryFn: () => api.get<TransferDetail>(`/shop/stock/transfers/${id}`) });
  const t = q.data;
  if (!t || !org) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;
  const fromGstin = t.fromGstin || org.gstin;
  const toGstin = t.toGstin || org.gstin;
  const distinct = !!fromGstin && !!toGstin && fromGstin !== toGstin;
  const rows = t.lines.map((l) => ({ ...l, value: Math.round(l.qty * l.unitCost * 100) / 100 }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const tax = rows.reduce((s, r) => s + (r.value * r.taxRate) / 100, 0);

  return (
    <div className="page">
      <div className="row between no-print" style={{ marginBottom: 12 }}>
        <Link to="/app/inventory/transfers" className="small">← Transfers</Link>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>
      <div className="print-area tn">
        <header className="tn-head">
          <div>
            <div className="tn-title">{distinct ? 'Delivery Challan (inter-GSTIN stock transfer)' : 'Stock Transfer Note / Delivery Challan'}</div>
            <div className="small">Not a tax invoice{distinct ? ' · a tax invoice is required for this movement' : ' · goods moved within the same registration, no supply'}</div>
          </div>
          <div className="tn-meta">
            <div><span>No.</span><strong>{t.number}</strong></div>
            <div><span>Date</span><strong>{fmtDate(t.date)}</strong></div>
            <div><span>Status</span><strong>{t.status}</strong></div>
          </div>
        </header>
        <section className="tn-parties">
          <div><h5>From</h5><strong>{org.companyName} · {t.fromName}</strong><div>{t.fromAddress}</div><div>{t.fromState || org.state}</div>{fromGstin && <div>GSTIN <strong>{fromGstin}</strong></div>}</div>
          <div><h5>To</h5><strong>{org.companyName} · {t.toName}</strong><div>{t.toAddress}</div><div>{t.toState || org.state}</div>{toGstin && <div>GSTIN <strong>{toGstin}</strong></div>}</div>
          <div><h5>Transport</h5><div>Vehicle: {t.vehicleNo || '—'}</div><div>E-way bill: {t.ewayBillNo || (total > EWAY_BILL_THRESHOLD ? <strong>required (value over ₹50,000)</strong> : 'not needed')}</div><div>Sent by {t.createdBy}</div></div>
        </section>
        <table className="tn-table">
          <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th className="num">Cost / unit</th><th className="num">Value</th><th className="num">GST %</th><th className="num">Price at destination</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td><td>{r.name}{r.serials.length > 0 && <div className="small">S/N: {r.serials.join(', ')}</div>}</td><td>{r.hsn || '—'}</td><td>{r.batchNo || '—'}{r.season && <div className="small">{r.season}</div>}</td>
                <td>{r.expiryDate ? fmtDate(r.expiryDate) : '—'}</td><td className="num">{r.qty} {r.unit}</td><td className="num">{money(r.unitCost)}</td><td className="num">{money(r.value)}</td><td className="num">{r.taxRate}</td>
                <td className="num">{money(r.destPriceApplied ?? r.destPrice ?? 0)}{r.priceRules.length > 0 && <div className="small">{r.priceRules.map((p) => `${p.name} ${p.change}`).join(', ')}</div>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={7} className="num">Value of goods (at cost)</td><td className="num strong">{money(total)}</td><td colSpan={2} /></tr>
            {distinct && <tr><td colSpan={7} className="num">GST on a tax invoice at these rates would be about</td><td className="num">{money(tax)}</td><td colSpan={2} /></tr>}
          </tfoot>
        </table>
        {t.status === 'Received' && (
          <p className="small">Received at {t.toName} on {fmtDate((t.receivedAt ?? '').slice(0, 10))} by {t.receivedBy}{t.verifiedVia === 'otp' ? ', verified with the emailed code' : t.verifiedVia === 'owner_override' ? `, by owner override (${t.overrideReason})` : ''}.
            {t.discrepancyNote ? ` Damaged / missing: ${t.discrepancyNote} (loss at cost ${money(t.lossValue)}).` : ''}</p>
        )}
        {t.notes && <p className="small">Notes: {t.notes}</p>}
        <div className="tn-sign"><div>Dispatched by<br /><br />______________________</div><div>Driver<br /><br />______________________</div><div>Received by<br /><br />______________________</div></div>
      </div>
    </div>
  );
}
