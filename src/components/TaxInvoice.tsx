import { useEffect, type CSSProperties } from 'react';
import { amountInWords, fmtDate, initials, money, num2 } from '@/lib/format';
import type { Invoice, Organization } from '@/api/types';
import type { InvoicePaper, InvoicePrintSettings } from '../../shared/printSettings';
import { stateCode } from '../../shared/gst';
import { upiLink, useQrState } from './qr';

export type PrintOrg = Pick<Organization, 'companyName' | 'legalName' | 'gstin' | 'email' | 'phone' | 'address' | 'state' | 'logo' | 'invoiceFooter' | 'upiId' | 'bankDetails' | 'compositionScheme'>;
export interface PrintBranch { name: string; address: string; phone: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per-line figures as printed: gross, discount, taxable value, tax and line total. */
export function printedLines(inv: Invoice) {
  return inv.lines.map((l) => {
    const gross = r2(l.qty * l.rate);
    const taxable = l.amount;
    const tax = inv.withGst ? r2((taxable * l.taxRate) / 100) : 0;
    return { ...l, gross, discountAmt: r2(gross - taxable), taxable, tax, total: r2(taxable + tax) };
  });
}

/** Tax summary grouped by GST rate, the way GSTR-1 and most auditors read it. */
export function taxBreakup(inv: Invoice) {
  const map = new Map<number, { rate: number; taxable: number; tax: number }>();
  if (!inv.withGst) return [];
  for (const l of inv.lines) {
    const b = map.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0 };
    b.taxable = r2(b.taxable + l.amount);
    b.tax = r2(b.tax + (l.amount * l.taxRate) / 100);
    map.set(l.taxRate, b);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

const placeLabel = (state: string) => (state ? `${state}${stateCode(state) ? ` (${stateCode(state)})` : ''}` : '—');

/**
 * The tax invoice as printed. One component renders the on-screen preview, the browser print, the server PDF and the
 * shared link, so every channel produces the same document. Layout rules (repeating header, unsplit rows, totals kept
 * together) live in styles/print.css.
 */
export function TaxInvoice({ inv, org, branch, s, paper, onReady }: {
  inv: Invoice; org: PrintOrg; branch?: PrintBranch | null; s: InvoicePrintSettings; paper?: InvoicePaper; onReady?: () => void;
}) {
  const narrow = (paper ?? s.paper) === 'a5';
  // A5 has room for nine columns: unit joins quantity and the line total is left to the totals block.
  const f = narrow ? { ...s.fields, unit: false } : s.fields;
  const showAmount = !narrow || !inv.withGst;
  const c = inv.customer;
  const lines = printedLines(inv);
  const slabs = f.taxBreakup ? taxBreakup(inv) : [];
  const showDisc = f.discount && lines.some((l) => l.discountAmt > 0);
  const gst = inv.withGst;
  const due = inv.status === 'Issued' ? inv.balance : inv.total;
  const upi = useQrState(f.upiQr && org.upiId && inv.status !== 'Cancelled' && due > 0 ? upiLink(org, due, inv.number ?? '') : null);
  const irn = f.eInvoice && inv.einvoice?.irn ? inv.einvoice : null;
  const irnQr = useQrState(irn ? irn.signedQr || irn.irn : null);
  const ready = upi.ready && irnQr.ready;
  useEffect(() => { if (ready) onReady?.(); }, [ready, onReady]);

  const terms = (inv.terms || s.terms).trim();
  const ship = f.shipTo ? inv.shipTo : null;
  const cols = 4 + (showAmount ? 1 : 0) + (f.hsn ? 1 : 0) + (f.unit ? 1 : 0) + (showDisc ? 1 : 0) + (gst ? 3 : 0);
  const mark = inv.status === 'Cancelled' ? 'VOID' : inv.status === 'Draft' ? 'DRAFT' : '';

  return (
    <article className={`print-doc ti ti-${s.template} ti-${paper ?? s.paper}`} style={{ '--ti-color': s.color } as CSSProperties} aria-label={`${inv.docType} ${inv.number ?? 'draft'}`}>
      {mark && <div className="ti-mark" aria-hidden>{mark}</div>}

      <header className="ti-head">
        <div className="ti-from">
          {f.logo && (org.logo ? <img className="ti-logo" src={org.logo} alt="" /> : <div className="ti-logo ti-logo-text" aria-hidden>{initials(org.companyName)}</div>)}
          <div>
            <div className="ti-company">{org.companyName}</div>
            {org.legalName && org.legalName !== org.companyName && <div className="ti-muted">{org.legalName}</div>}
            <div className="ti-pre">{org.address}</div>
            <div>{[org.phone, org.email].filter(Boolean).join(' · ')}</div>
            {org.gstin && <div className="ti-strong">GSTIN {org.gstin}</div>}
          </div>
        </div>
        <div className="ti-title">
          <h1>{inv.docType}</h1>
          <dl className="ti-kv">
            <dt>Invoice no.</dt><dd className="ti-strong">{inv.number ?? 'Draft'}</dd>
            <dt>Invoice date</dt><dd>{fmtDate(inv.date)}</dd>
            <dt>Due date</dt><dd>{fmtDate(inv.dueDate)}</dd>
            {inv.eway?.number && (<><dt>E-way bill</dt><dd>{inv.eway.number}{inv.eway.vehicleNo ? ` · ${inv.eway.vehicleNo}` : ''}</dd></>)}
          </dl>
        </div>
      </header>

      {irn && (
        <section className="ti-irn">
          {irnQr.src && <img src={irnQr.src} alt="E-invoice QR code" />}
          <dl className="ti-kv">
            <dt>IRN</dt><dd className="ti-mono">{irn.irn}</dd>
            {irn.ackNo && (<><dt>Ack no.</dt><dd>{irn.ackNo}</dd></>)}
            {irn.ackDate && (<><dt>Ack date</dt><dd>{irn.ackDate}</dd></>)}
          </dl>
        </section>
      )}

      <section className={`ti-parties ${f.shipTo ? 'three' : ''}`}>
        <div>
          <div className="ti-label">Bill to</div>
          <div className="ti-strong">{c.companyName || c.name}</div>
          {c.companyName && c.name && <div>{c.name}</div>}
          {c.address && <div className="ti-pre">{c.address}</div>}
          {c.phone && <div>{c.phone}</div>}
          {c.gstin && <div className="ti-strong">GSTIN {c.gstin}</div>}
        </div>
        {f.shipTo && (
          <div>
            <div className="ti-label">Ship to</div>
            {ship ? (
              <>
                <div className="ti-strong">{ship.name || c.companyName || c.name}</div>
                {ship.address && <div className="ti-pre">{ship.address}</div>}
                {ship.state && <div>{ship.state}</div>}
                {ship.gstin && <div className="ti-strong">GSTIN {ship.gstin}</div>}
              </>
            ) : <div className="ti-muted">Same as billing address</div>}
          </div>
        )}
        <div>
          {f.placeOfSupply && (<><div className="ti-label">Place of supply</div><div className="ti-strong">{placeLabel(inv.placeOfSupply)}</div></>)}
          <dl className="ti-kv ti-kv-left">
            <dt>Supply</dt><dd>{c.gstin ? 'B2B' : 'B2C'} · {inv.interState ? 'Inter-state' : 'Intra-state'}</dd>
            <dt>Reverse charge</dt><dd>{inv.reverseCharge ? 'Yes' : 'No'}</dd>
            {branch?.name && (<><dt>Dispatch from</dt><dd>{branch.name}</dd></>)}
          </dl>
        </div>
      </section>

      <table className="ti-items">
        <thead>
          <tr>
            <th className="c-sno">S.No</th>
            <th className="c-item">Item</th>
            {f.hsn && <th>HSN/SAC</th>}
            <th className="r">Qty</th>
            {f.unit && <th>Unit</th>}
            <th className="r">Rate</th>
            {showDisc && <th className="r">Discount</th>}
            {gst && <th className="r">Taxable value</th>}
            {gst && <th className="r">GST %</th>}
            {gst && <th className="r">Tax</th>}
            {showAmount && <th className="r">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td className="c-sno">{i + 1}</td>
              <td className="c-item">
                <div className="ti-strong">{l.name}</div>
                {l.batches?.length ? <div className="ti-muted">Batch {l.batches.map((b) => `${b.batchNo}${b.expiryDate ? ` · exp ${fmtDate(b.expiryDate)}` : ''}`).join(', ')}</div> : null}
              </td>
              {f.hsn && <td>{l.hsn || '—'}</td>}
              <td className="r">{l.qty}{!f.unit && l.unit ? ` ${l.unit}` : ''}</td>
              {f.unit && <td>{l.unit}</td>}
              <td className="r">{num2(l.rate)}</td>
              {showDisc && <td className="r">{l.discountAmt > 0 ? (narrow ? `${l.discount}%` : <>{num2(l.discountAmt)}<div className="ti-muted">{l.discount}%</div></>) : '—'}</td>}
              {gst && <td className="r">{num2(l.taxable)}</td>}
              {gst && <td className="r">{l.taxRate}%</td>}
              {gst && <td className="r">{num2(l.tax)}</td>}
              {showAmount && <td className="r ti-strong">{num2(gst ? l.total : l.taxable)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={cols - (gst ? 3 : 0) - (showAmount ? 1 : 0)} className="r ti-muted">Total</td>
            {gst && <td className="r">{num2(inv.subTotal)}</td>}
            {gst && <td />}
            {gst && <td className="r">{num2(inv.taxTotal)}</td>}
            {showAmount && <td className="r ti-strong">{num2(r2(inv.subTotal + (gst ? inv.taxTotal : 0)))}</td>}
          </tr>
        </tfoot>
      </table>

      <section className="ti-summary">
        <div className="ti-summary-left">
          {slabs.length > 0 && (
            <table className="ti-tax">
              <thead>
                <tr><th>GST rate</th><th className="r">Taxable value</th>{inv.interState ? <th className="r">IGST</th> : <><th className="r">CGST</th><th className="r">SGST</th></>}<th className="r">Total tax</th></tr>
              </thead>
              <tbody>
                {slabs.map((b) => (
                  <tr key={b.rate}>
                    <td>{b.rate}%</td>
                    <td className="r">{num2(b.taxable)}</td>
                    {inv.interState ? <td className="r">{num2(b.tax)}</td> : <><td className="r">{num2(b.tax / 2)}</td><td className="r">{num2(b.tax / 2)}</td></>}
                    <td className="r">{num2(b.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {f.amountInWords && (
            <div className="ti-words">
              <div className="ti-label">Amount in words</div>
              <div className="ti-strong">{amountInWords(inv.total)}</div>
            </div>
          )}
        </div>
        <dl className="ti-totals">
          <dt>Taxable amount</dt><dd>{money(inv.subTotal)}</dd>
          {gst && (inv.interState
            ? <><dt>IGST</dt><dd>{money(inv.igst)}</dd></>
            : <><dt>CGST</dt><dd>{money(inv.cgst)}</dd><dt>SGST</dt><dd>{money(inv.sgst)}</dd></>)}
          {inv.tcs > 0 && <><dt>TCS @ {inv.tcsRate}%</dt><dd>{money(inv.tcs)}</dd></>}
          {Math.abs(inv.roundOff) > 0.001 && <><dt>Round off</dt><dd>{inv.roundOff > 0 ? '+' : '−'}{money(Math.abs(inv.roundOff))}</dd></>}
          <dt className="ti-grand">Total</dt><dd className="ti-grand">{money(inv.total)}</dd>
          {inv.amountPaid > 0 && <><dt>Received</dt><dd>−{money(inv.amountPaid)}</dd></>}
          {inv.amountCredited > 0 && <><dt>Credit notes</dt><dd>−{money(inv.amountCredited)}</dd></>}
          {inv.status === 'Issued' && (inv.amountPaid > 0 || inv.amountCredited > 0) && <><dt className="ti-strong">Balance due</dt><dd className="ti-strong">{money(Math.max(0, inv.balance))}</dd></>}
        </dl>
      </section>

      <section className="ti-foot">
        <div className="ti-foot-left">
          {((f.bankDetails && org.bankDetails) || upi.src) && (
            <div className="ti-pay">
              {upi.src && <img src={upi.src} alt="UPI QR code" />}
              <div>
                <div className="ti-label">Payment details</div>
                {f.bankDetails && org.bankDetails && <div className="ti-pre">{org.bankDetails}</div>}
                {org.upiId && upi.src && <div>UPI <span className="ti-strong">{org.upiId}</span> · scan to pay {money(due)}</div>}
              </div>
            </div>
          )}
          {f.terms && terms && (<div><div className="ti-label">Terms and conditions</div><div className="ti-pre ti-small">{terms}</div></div>)}
          {f.notes && inv.notes && (<div><div className="ti-label">Notes</div><div className="ti-pre ti-small">{inv.notes}</div></div>)}
        </div>
        {f.signature && (
          <div className="ti-sign">
            <div>For {org.companyName}</div>
            <div className="ti-sign-space">{s.signatureImage && <img src={s.signatureImage} alt="" />}</div>
            <div className="ti-sign-line">{s.signatoryLabel}</div>
          </div>
        )}
      </section>

      <footer className="ti-fine">
        {org.invoiceFooter && <span>{org.invoiceFooter} · </span>}
        {org.compositionScheme ? 'Composition taxable person, not eligible to collect tax on supplies.' : 'This is a computer-generated invoice.'}
      </footer>
    </article>
  );
}
