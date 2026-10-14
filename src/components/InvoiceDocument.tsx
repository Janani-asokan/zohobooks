import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { amountInWords, fmtDate, initials, money } from '@/lib/format';
import type { Invoice, Organization } from '@/api/types';

/** UPI deep link (NPCI spec) — any UPI app can scan it. */
export const upiLink = (org: Pick<Organization, 'upiId' | 'companyName'>, amount: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(org.upiId)}&pn=${encodeURIComponent(org.companyName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

export function useQr(text: string | null) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!text) return setSrc('');
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then((d) => alive && setSrc(d)).catch(() => setSrc(''));
    return () => { alive = false; };
  }, [text]);
  return src;
}

type Org = Pick<Organization, 'companyName' | 'legalName' | 'gstin' | 'email' | 'phone' | 'address' | 'state' | 'logo' | 'invoiceFooter' | 'upiId' | 'bankDetails' | 'invoiceTemplate' | 'compositionScheme'>;

export function InvoiceDocument({ inv, org, branchName, template }: { inv: Invoice; org: Org; branchName?: string; template?: Org['invoiceTemplate'] }) {
  const c = inv.customer;
  const tpl = template ?? org.invoiceTemplate ?? 'classic';
  const showDisc = inv.lines.some((l) => l.discount);
  const qr = useQr(org.upiId && inv.status === 'Issued' && inv.balance > 0 ? upiLink(org, inv.balance, inv.number ?? '') : null);
  const breakup = new Map<number, { taxable: number; tax: number }>();
  if (inv.withGst)
    for (const l of inv.lines) {
      if (!l.taxRate) continue;
      const b = breakup.get(l.taxRate) ?? { taxable: 0, tax: 0 };
      b.taxable += l.amount;
      b.tax += (l.amount * l.taxRate) / 100;
      breakup.set(l.taxRate, b);
    }

  return (
    <div className={`a4 light-scope tpl-${tpl}`} style={{ position: 'relative' }}>
      {inv.status === 'Cancelled' && <div className="void-mark">CANCELLED</div>}
      <div className="doc-head">
        <div className="doc-company">
          <div className="doc-logo">{org.logo ? <img src={org.logo} alt="" /> : initials(org.companyName)}</div>
          <div>
            <h2>{org.companyName}</h2>
            {org.legalName && org.legalName !== org.companyName && <div className="doc-legal">{org.legalName}</div>}
            <div className="addr">{org.address}</div>
            <div className="doc-contact">{org.phone} {org.email && `· ${org.email}`}</div>
            {org.gstin && <div style={{ marginTop: 2, fontWeight: 700 }}>GSTIN: {org.gstin}</div>}
          </div>
        </div>
        <div className="doc-title">
          <h1>{inv.docType}</h1>
          <div className="no"># {inv.number ?? 'DRAFT'}</div>
          <span className={`mode-tag ${inv.withGst ? 'gst' : 'net'}`}>{inv.withGst ? 'GST APPLIED' : org.compositionScheme ? 'COMPOSITION DEALER' : 'NET PRICE · NO TAX'}</span>
          {inv.paymentStatus === 'Paid' && <div style={{ marginTop: 14 }}><span className="paid-stamp">PAID</span></div>}
        </div>
      </div>

      <div className="doc-meta">
        <div className="box">
          <div className="lbl">Bill to</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{c.companyName || c.name}</div>
          {c.companyName && <div>Attn: {c.name}</div>}
          {c.address && <div style={{ color: '#475569', whiteSpace: 'pre-line' }}>{c.address}</div>}
          <div style={{ color: '#475569' }}>{c.state}</div>
          {c.phone && <div style={{ color: '#475569' }}>{c.phone}</div>}
          {c.gstin && <div style={{ marginTop: 4, fontWeight: 700 }}>GSTIN: {c.gstin}</div>}
          {c.customId && <div style={{ marginTop: 4, color: '#64748b' }}>Customer ID: {c.customId}</div>}
        </div>
        <div className="box">
          <div className="kv">
            <span>Invoice date</span><span>{fmtDate(inv.date)}</span>
            <span>Due date</span><span>{fmtDate(inv.dueDate)}</span>
            <span>Financial year</span><span>{inv.fy}</span>
            <span>Place of supply</span><span>{inv.placeOfSupply}</span>
            {branchName && (<><span>Branch</span><span>{branchName}</span></>)}
            <span>Supply type</span><span>{c.gstin ? 'B2B' : 'B2C'}{inv.interState ? ' · Inter-state' : ''}</span>
            <span>Reverse charge</span><span>{inv.reverseCharge ? 'Yes' : 'No'}</span>
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
            {showDisc && <th className="r">Disc.</th>}
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
                {l.batches?.length ? <div className="doc-sub">Batch {l.batches.map((b) => `${b.batchNo}${b.expiryDate ? ` (exp ${fmtDate(b.expiryDate)})` : ''}`).join(', ')}</div> : null}
              </td>
              <td>{l.hsn || '—'}</td>
              <td className="r">{l.qty} {l.unit}</td>
              <td className="r">{money(l.rate)}</td>
              {showDisc && <td className="r">{l.discount ? `${l.discount}%` : '—'}</td>}
              {inv.withGst && <td className="r">{l.taxRate}%</td>}
              <td className="r" style={{ fontWeight: 600 }}>{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-bottom">
        <div>
          {breakup.size > 0 && (
            <table style={{ marginBottom: 14 }}>
              <thead>
                <tr><th>Tax rate</th><th className="r">Taxable value</th>{inv.interState ? <th className="r">IGST</th> : (<><th className="r">CGST</th><th className="r">SGST</th></>)}</tr>
              </thead>
              <tbody>
                {[...breakup.entries()].sort((a, b) => a[0] - b[0]).map(([rate, b]) => (
                  <tr key={rate}>
                    <td>{rate}%</td>
                    <td className="r">{money(b.taxable)}</td>
                    {inv.interState ? <td className="r">{money(b.tax)}</td> : (<><td className="r">{money(b.tax / 2)}</td><td className="r">{money(b.tax / 2)}</td></>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lbl-sm">Total in words</div>
          <div className="words">{amountInWords(inv.total)}</div>
          {inv.notes && (<><div className="lbl-sm" style={{ marginTop: 14 }}>Notes</div><div style={{ color: '#475569', whiteSpace: 'pre-line' }}>{inv.notes}</div></>)}
          {(org.bankDetails || qr) && (
            <div className="pay-box">
              {qr && <img src={qr} alt="UPI QR code" className="upi-qr" />}
              <div>
                <div className="lbl-sm">Pay to</div>
                {org.upiId && <div style={{ fontWeight: 700, color: '#0f172a' }}>UPI: {org.upiId}</div>}
                {qr && <div style={{ color: '#64748b', fontSize: 10.5 }}>Scan with any UPI app to pay {money(inv.balance)}</div>}
                {org.bankDetails && <div style={{ color: '#475569', whiteSpace: 'pre-line', marginTop: 4 }}>{org.bankDetails}</div>}
              </div>
            </div>
          )}
        </div>
        <div className="totals">
          <div className="tr"><span>Sub total</span><span>{money(inv.subTotal)}</span></div>
          {inv.withGst && (inv.interState ? <div className="tr"><span>IGST</span><span>{money(inv.igst)}</span></div> : (<><div className="tr"><span>CGST</span><span>{money(inv.cgst)}</span></div><div className="tr"><span>SGST</span><span>{money(inv.sgst)}</span></div></>))}
          {inv.tcs > 0 && <div className="tr"><span>TCS @ {inv.tcsRate}%</span><span>{money(inv.tcs)}</span></div>}
          {Math.abs(inv.roundOff) > 0.001 && <div className="tr"><span>Round off</span><span>{money(inv.roundOff)}</span></div>}
          <div className="tr grand"><span>Total</span><span>{money(inv.total)}</span></div>
          {inv.amountPaid > 0 && <div className="tr" style={{ color: '#15803d' }}><span>Payments received</span><span>(−) {money(inv.amountPaid)}</span></div>}
          {inv.amountCredited > 0 && <div className="tr" style={{ color: '#15803d' }}><span>Credit notes</span><span>(−) {money(inv.amountCredited)}</span></div>}
          <div className="tr" style={{ fontWeight: 700 }}><span>{inv.balance < 0 ? 'Refund due' : 'Balance due'}</span><span>{money(Math.abs(inv.balance))}</span></div>
        </div>
      </div>

      <div className="doc-foot">
        <div style={{ color: '#64748b', maxWidth: 380 }}>
          <div style={{ fontWeight: 700, color: '#334155' }}>{org.invoiceFooter}</div>
          <div style={{ fontSize: 10.5, marginTop: 4 }}>
            This is a computer-generated document.{' '}
            {org.compositionScheme ? 'Composition taxable person, not eligible to collect tax on supplies.' : inv.withGst ? `Tax payable on reverse charge: ${inv.reverseCharge ? 'Yes' : 'No'}.` : 'Prices are net; no GST charged.'}
          </div>
        </div>
        <div className="sign">
          <div style={{ fontWeight: 600 }}>For {org.companyName}</div>
          <div className="line">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}
