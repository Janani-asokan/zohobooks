import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Printer, CheckCircle2, Trash2, FileX } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState } from '@/components/ui';
import { docTotals, effectiveStatus, isInterState } from '@/lib/invoice';
import { lineAmount } from '@/lib/calc';
import { amountInWords, fmtDate, initials, money } from '@/lib/format';
import type { Invoice, Tenant } from '@/lib/types';

export function InvoiceDocument({ tenant, inv }: { tenant: Tenant; inv: Invoice }) {
  const org = tenant.org;
  const c = tenant.customers.find((x) => x.id === inv.customerId);
  const branch = tenant.branches.find((b) => b.id === inv.branchId);
  const inter = isInterState(tenant, inv.customerId);
  const t = docTotals(tenant, inv);
  const status = effectiveStatus(inv);
  const hsnOf = (itemId: string) => tenant.items.find((i) => i.id === itemId)?.hsn ?? '';

  return (
    <div className="a4" style={{ position: 'relative' }}>
      <div className="doc-head">
        <div className="doc-company">
          <div className="doc-logo">{org.logo ? <img src={org.logo} alt="" /> : initials(org.companyName)}</div>
          <div>
            <h2>{org.companyName}</h2>
            {org.legalName && org.legalName !== org.companyName && <div style={{ color: '#475569', fontWeight: 600 }}>{org.legalName}</div>}
            <div className="addr">{org.address}</div>
            <div style={{ marginTop: 4, color: '#475569' }}>
              {org.phone} {org.email && `· ${org.email}`}
            </div>
            {org.gstin && <div style={{ marginTop: 2, fontWeight: 700 }}>GSTIN: {org.gstin}</div>}
          </div>
        </div>
        <div className="doc-title">
          <h1>{inv.withGst ? 'TAX INVOICE' : 'INVOICE'}</h1>
          <div className="no"># {inv.number}</div>
          <span className={`mode-tag ${inv.withGst ? 'gst' : 'net'}`}>{inv.withGst ? 'GST APPLIED' : 'NET PRICE · NO TAX'}</span>
          {status === 'Paid' && (
            <div style={{ marginTop: 14 }}>
              <span className="paid-stamp">PAID</span>
            </div>
          )}
        </div>
      </div>

      <div className="doc-meta">
        <div className="box">
          <div className="lbl">Bill to</div>
          {c ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{c.companyName || c.name}</div>
              {c.companyName && <div>Attn: {c.name}</div>}
              {c.address && <div style={{ color: '#475569', whiteSpace: 'pre-line' }}>{c.address}</div>}
              <div style={{ color: '#475569' }}>{c.state}</div>
              <div style={{ color: '#475569' }}>{c.phone}</div>
              {c.type === 'Business' && <div style={{ marginTop: 4, fontWeight: 700 }}>GSTIN: {c.gstin}</div>}
              <div style={{ marginTop: 4, color: '#64748b' }}>Customer ID: {c.customId}</div>
            </>
          ) : (
            <div>—</div>
          )}
        </div>
        <div className="box">
          <div className="kv">
            <span>Invoice date</span>
            <span>{fmtDate(inv.date)}</span>
            <span>Due date</span>
            <span>{fmtDate(inv.dueDate)}</span>
            <span>Financial year</span>
            <span>{inv.fy}</span>
            <span>Place of supply</span>
            <span>{c?.state || org.state}</span>
            {branch && (
              <>
                <span>Branch</span>
                <span>{branch.name}</span>
              </>
            )}
            <span>Supply type</span>
            <span>{c?.type === 'Business' ? 'B2B' : 'B2C'}</span>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Item &amp; description</th>
            <th>HSN/SAC</th>
            <th className="r">Qty</th>
            <th className="r">Rate</th>
            {inv.lines.some((l) => l.discount) && <th className="r">Disc.</th>}
            {inv.withGst && <th className="r">GST</th>}
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{l.name}</div>
                <div style={{ color: '#94a3b8', fontSize: 10.5 }}>Price tier {l.tier}</div>
              </td>
              <td>{hsnOf(l.itemId) || '—'}</td>
              <td className="r">{l.qty}</td>
              <td className="r">{money(l.rate)}</td>
              {inv.lines.some((x) => x.discount) && <td className="r">{l.discount ? `${l.discount}%` : '—'}</td>}
              {inv.withGst && <td className="r">{l.taxRate}%</td>}
              <td className="r" style={{ fontWeight: 600 }}>{money(lineAmount(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-bottom">
        <div>
          {inv.withGst && t.breakup.length > 0 && (
            <table style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th>Tax rate</th>
                  <th className="r">Taxable value</th>
                  {inter ? <th className="r">IGST</th> : (<><th className="r">CGST</th><th className="r">SGST</th></>)}
                </tr>
              </thead>
              <tbody>
                {t.breakup.map((b) => (
                  <tr key={b.rate}>
                    <td>{b.rate}%</td>
                    <td className="r">{money(b.taxable)}</td>
                    {inter ? <td className="r">{money(b.tax)}</td> : (<><td className="r">{money(b.tax / 2)}</td><td className="r">{money(b.tax / 2)}</td></>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lbl" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#64748b', fontWeight: 700 }}>Total in words</div>
          <div className="words">{amountInWords(t.total)}</div>
          {inv.notes && (
            <>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#64748b', fontWeight: 700, marginTop: 14 }}>Notes</div>
              <div style={{ color: '#475569', whiteSpace: 'pre-line' }}>{inv.notes}</div>
            </>
          )}
        </div>
        <div className="totals">
          <div className="tr"><span>Sub total</span><span>{money(t.subTotal)}</span></div>
          {inv.withGst &&
            (inter ? (
              <div className="tr"><span>IGST</span><span>{money(t.igst)}</span></div>
            ) : (
              <>
                <div className="tr"><span>CGST</span><span>{money(t.cgst)}</span></div>
                <div className="tr"><span>SGST</span><span>{money(t.sgst)}</span></div>
              </>
            ))}
          {Math.abs(t.roundOff) > 0.001 && <div className="tr"><span>Round off</span><span>{money(t.roundOff)}</span></div>}
          <div className="tr grand"><span>Total</span><span>{money(t.total)}</span></div>
          {status === 'Paid' ? (
            <div className="tr" style={{ color: '#15803d', fontWeight: 700 }}><span>Payment made</span><span>(−) {money(t.total)}</span></div>
          ) : (
            <div className="tr" style={{ fontWeight: 700 }}><span>Balance due</span><span>{money(t.total)}</span></div>
          )}
        </div>
      </div>

      <div className="doc-foot">
        <div style={{ color: '#64748b', maxWidth: 380 }}>
          <div style={{ fontWeight: 700, color: '#334155' }}>{org.invoiceFooter}</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>This is a computer-generated invoice. {inv.withGst ? 'Tax is payable on reverse charge: No.' : 'Prices are net and exclusive of GST.'}</div>
        </div>
        <div className="sign">
          <div style={{ fontWeight: 600 }}>For {org.companyName}</div>
          <div className="line">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { tenant, mutate } = useTenant();
  const inv = tenant.invoices.find((i) => i.id === id);
  const [del, setDel] = useState(false);

  useEffect(() => {
    if (inv && params.get('print')) {
      params.delete('print');
      setParams(params, { replace: true });
      setTimeout(() => window.print(), 300);
    }
  }, [inv]);

  if (!inv) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState icon={FileX} title="Invoice not found" text="It may have been deleted." action={<Link to="/app/sales/invoices" className="btn btn-primary">Back to invoices</Link>} />
        </div>
      </div>
    );
  }
  const status = effectiveStatus(inv);
  const c = tenant.customers.find((x) => x.id === inv.customerId);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="row between no-print" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div className="row">
          <button className="icon-btn" onClick={() => navigate('/app/sales/invoices')} aria-label="Back"><ArrowLeft size={18} /></button>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800 }}>{inv.number}</h1>
              <Badge>{status}</Badge>
            </div>
            <div className="small muted">{c?.companyName || c?.name} · {money(docTotals(tenant, inv).total)}</div>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Link to={`/app/sales/invoices/${inv.id}/edit`} className="btn btn-secondary"><Pencil size={15} /> Edit</Link>
          {status !== 'Paid' && (
            <button className="btn btn-secondary" onClick={() => { mutate((t) => void (t.invoices.find((x) => x.id === inv.id)!.status = 'Paid')); toast('success', 'Payment recorded', inv.number); }}>
              <CheckCircle2 size={15} /> Mark as paid
            </button>
          )}
          {inv.status === 'Draft' && (
            <button className="btn btn-secondary" onClick={() => setDel(true)}><Trash2 size={15} /> Delete draft</button>
          )}
          <button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
        </div>
      </div>
      <div className="doc-stage print-area">
        <InvoiceDocument tenant={tenant} inv={inv} />
      </div>
      <ConfirmModal
        open={del}
        onClose={() => setDel(false)}
        title="Delete draft invoice?"
        text="Draft invoices can be deleted. The invoice number will not be reused, to keep your sequence audit-safe."
        onConfirm={() => {
          mutate((t) => void (t.invoices = t.invoices.filter((x) => x.id !== inv.id)));
          toast('success', 'Draft deleted');
          navigate('/app/sales/invoices');
        }}
      />
    </div>
  );
}
