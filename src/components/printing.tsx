import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import type { Invoice, Item, Organization } from '@/api/types';
import { fmtDate, money } from '@/lib/format';
import {
  labelFontMm, labelSize, paperWidthMm, type BarcodeFieldKey, type BarcodeSettings, type ThermalSettings,
} from '../../shared/printSettings';
import { upiLink, useQr } from './qr';

/** Print just the `.print-area`, with a page size that matches the paper (receipt roll or label stock). */
export function printWithPage(pageCss: string, bodyClass: string) {
  const style = document.createElement('style');
  style.textContent = `@media print { @page { ${pageCss} } }`;
  document.head.appendChild(style);
  document.body.classList.add(bodyClass);
  const done = () => { style.remove(); document.body.classList.remove(bodyClass); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
export const printReceipt = (s: ThermalSettings) => printWithPage(`size: ${s.paper === '2in' ? 58 : 80}mm auto; margin: 0;`, 'print-receipt');

/* ---------------- Thermal receipt ---------------- */

export interface ReceiptLine { name: string; description?: string; hsn?: string; qty: number; unit?: string; rate: number; mrp?: number | null; taxRate: number; amount: number }
export interface ReceiptData {
  number: string; date: string; time?: string;
  customer: { name: string; phone?: string; gstin?: string };
  lines: ReceiptLine[];
  withGst: boolean; interState: boolean; subTotal: number; discount: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number;
  amountPaid: number; paymentMode?: string; partyBalance?: number;
}
type ReceiptOrg = Pick<Organization, 'companyName' | 'address' | 'gstin' | 'phone' | 'logo' | 'invoiceFooter' | 'upiId'>;

export function receiptFromInvoice(inv: Invoice, items: Item[] = [], partyBalance?: number, paymentMode?: string): ReceiptData {
  const at = inv.issuedAt ?? inv.createdAt;
  return {
    number: inv.number ?? 'DRAFT', date: inv.date, time: at ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : undefined,
    customer: { name: inv.customer.companyName || inv.customer.name, phone: inv.customer.phone, gstin: inv.customer.gstin },
    lines: inv.lines.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      return { name: l.name, description: it?.description, hsn: l.hsn, qty: l.qty, unit: l.unit, rate: l.rate, mrp: it?.mrp ?? null, taxRate: l.taxRate, amount: l.amount };
    }),
    withGst: inv.withGst, interState: inv.interState, subTotal: inv.subTotal, discount: inv.discount, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, roundOff: inv.roundOff,
    total: inv.total, amountPaid: inv.amountPaid, paymentMode, partyBalance,
  };
}

const n2 = (v: number) => v.toFixed(2);

export function ThermalReceipt({ data, org, s }: { data: ReceiptData; org: ReceiptOrg; s: ThermalSettings }) {
  const qr = useQr(s.showUpiQr && org.upiId && data.total - data.amountPaid > 0 ? upiLink(org, data.total - data.amountPaid, data.number) : null);
  const savings = data.lines.reduce((sum, l) => sum + (l.mrp && l.mrp > l.rate ? (l.mrp - l.rate) * l.qty : 0), 0);
  const slabs = Object.values(
    data.lines.reduce<Record<string, { rate: number; taxable: number; tax: number }>>((acc, l) => {
      const k = String(l.taxRate);
      acc[k] ??= { rate: l.taxRate, taxable: 0, tax: 0 };
      acc[k].taxable += l.amount;
      acc[k].tax += (l.amount * l.taxRate) / 100;
      return acc;
    }, {}),
  ).filter((x) => x.rate > 0);
  const t = s.theme;
  const footer = s.footer || org.invoiceFooter;
  const firstAddr = org.address.split('\n').filter(Boolean);

  const header = (
    <div className={`rc-head ${t}`}>
      {s.showLogo && org.logo && <img className="rc-logo" src={org.logo} alt="" />}
      <div className="rc-shop">{org.companyName}</div>
      {(t === 'simple' ? firstAddr.slice(0, 1) : firstAddr).map((a) => <div key={a} className="c">{a}</div>)}
      {org.phone && t !== 'simple' && <div className="c">Ph: {org.phone}</div>}
      {s.showGstin && org.gstin && data.withGst && <div className="c b">GSTIN: {org.gstin}</div>}
      {t === 'classic' && <div className="rc-title">{data.withGst ? 'TAX INVOICE' : 'BILL OF SUPPLY'}</div>}
    </div>
  );

  const meta = (
    <div className="rc-meta">
      <div className="rr"><span>Bill No: <b>{data.number}</b></span><span>{fmtDate(data.date)}{s.showTime && data.time ? ` ${data.time}` : ''}</span></div>
      <div>To: <b>{data.customer.name}</b>{data.customer.phone && t !== 'simple' ? ` · ${data.customer.phone}` : ''}</div>
      {s.showGstin && data.customer.gstin && <div>GSTIN: {data.customer.gstin}</div>}
    </div>
  );

  const itemsCompact = data.lines.map((l, i) => (
    <div key={i} className="rc-line">
      <div className="b">{l.name}</div>
      {s.showItemDescription && l.description && <div className="rc-desc">{l.description}</div>}
      {s.showHsn && l.hsn && <div className="rc-desc">HSN {l.hsn}{data.withGst ? ` · GST ${l.taxRate}%` : ''}</div>}
      <div className="rr"><span>{l.qty} × {n2(l.rate)}</span><span>{n2(l.amount)}</span></div>
    </div>
  ));

  const itemsTable = (
    <table className="rc-table">
      <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amt</th></tr></thead>
      <tbody>
        {data.lines.map((l, i) => (
          <tr key={i}>
            <td>
              <div className="b">{l.name}</div>
              {s.showItemDescription && l.description && <div className="rc-desc">{l.description}</div>}
              {(s.showHsn && l.hsn) || (t === 'advanced' && data.withGst) ? <div className="rc-desc">{[s.showHsn && l.hsn ? `HSN ${l.hsn}` : '', data.withGst ? `GST ${l.taxRate}%` : ''].filter(Boolean).join(' · ')}</div> : null}
              {t === 'advanced' && l.mrp && l.mrp > l.rate ? <div className="rc-desc">MRP {n2(l.mrp)}</div> : null}
            </td>
            <td className="r">{l.qty}</td>
            <td className="r">{n2(l.rate)}</td>
            <td className="r">{n2(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const totals = (
    <div className="rc-totals">
      <div className="rr"><span>Sub total ({data.lines.reduce((q, l) => q + l.qty, 0)} items)</span><span>{n2(data.subTotal)}</span></div>
      {data.discount > 0 && <div className="rr"><span>Discount</span><span>-{n2(data.discount)}</span></div>}
      {data.withGst && (data.interState
        ? <div className="rr"><span>IGST</span><span>{n2(data.igst)}</span></div>
        : <><div className="rr"><span>CGST</span><span>{n2(data.cgst)}</span></div><div className="rr"><span>SGST</span><span>{n2(data.sgst)}</span></div></>)}
      {Math.abs(data.roundOff) > 0 && <div className="rr"><span>Round off</span><span>{n2(data.roundOff)}</span></div>}
      <div className={`rr rc-grand ${t}`}><span>TOTAL</span><span>₹{n2(data.total)}</span></div>
      {data.amountPaid > 0 && <div className="rr"><span>Paid{data.paymentMode ? ` (${data.paymentMode})` : ''}</span><span>{n2(data.amountPaid)}</span></div>}
      {data.total - data.amountPaid > 0.005 && <div className="rr b"><span>Balance due</span><span>{n2(data.total - data.amountPaid)}</span></div>}
      {s.showPartyBalance && data.partyBalance !== undefined && <div className="rr"><span>Party balance (total due)</span><span>{n2(data.partyBalance)}</span></div>}
    </div>
  );

  const breakup = s.showTaxBreakup && data.withGst && slabs.length > 0 && t !== 'simple' && (
    <table className="rc-table rc-tax">
      <thead><tr><th>GST%</th><th className="r">Taxable</th><th className="r">{data.interState ? 'IGST' : 'CGST'}</th>{!data.interState && <th className="r">SGST</th>}</tr></thead>
      <tbody>
        {slabs.map((x) => (
          <tr key={x.rate}><td>{x.rate}%</td><td className="r">{n2(x.taxable)}</td>{data.interState ? <td className="r">{n2(x.tax)}</td> : <><td className="r">{n2(x.tax / 2)}</td><td className="r">{n2(x.tax / 2)}</td></>}</tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className={`receipt rc-${t} rc-${s.paper} light-scope`} style={{ width: `${paperWidthMm(s.paper)}mm` }}>
      {header}
      <hr />
      {meta}
      <hr />
      {t === 'compact' || t === 'simple' ? itemsCompact : itemsTable}
      <hr />
      {totals}
      {breakup && <><hr />{breakup}</>}
      {s.showSavings && savings > 0 && <div className="rc-saved">** YOU SAVED ₹{n2(savings)} **</div>}
      {qr && <div className="c" style={{ marginTop: 6 }}><img src={qr} alt="UPI QR" style={{ width: '28mm', height: '28mm' }} /><div>Scan to pay via UPI</div></div>}
      {footer && <><hr /><div className="c">{footer}</div></>}
    </div>
  );
}

/** A realistic sample bill for the settings preview. */
export const SAMPLE_RECEIPT: ReceiptData = {
  number: 'INV-2026-27-0042', date: new Date().toISOString().slice(0, 10), time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  customer: { name: 'Nila Textiles', phone: '+91 94440 11223', gstin: '33AAFCN5678K1Z2' },
  lines: [
    { name: 'Laptop Stand', description: 'Aluminium, adjustable', hsn: '8473', qty: 2, rate: 1200, mrp: 1499, taxRate: 18, amount: 2400 },
    { name: 'Wireless Mouse', description: '2.4 GHz, silent click', hsn: '8471', qty: 1, rate: 800, mrp: 999, taxRate: 18, amount: 800 },
    { name: 'A4 Copier Paper', hsn: '4802', qty: 3, rate: 320, mrp: 350, taxRate: 12, amount: 960 },
  ],
  withGst: true, interState: false, subTotal: 4160, discount: 0, cgst: 345.6, sgst: 345.6, igst: 0, roundOff: -0.2, total: 4851, amountPaid: 4851, paymentMode: 'UPI', partyBalance: 2450,
};

/* ---------------- Barcode label ---------------- */

const isEan13 = (c: string) => /^\d{13}$/.test(c);

export interface LabelItem { name: string; barcode: string; sku: string; mrp: number | null; sp1: number; category?: string; brand?: string; unit?: string }

export function BarcodeLabel({ item, shop, s, preview }: { item: LabelItem; shop: string; s: BarcodeSettings; preview?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const size = labelSize(s.labelSize);
  const code = item.barcode || item.sku;
  const on = (k: BarcodeFieldKey) => s.fields.find((f) => f.key === k && f.enabled);
  const style = (k: BarcodeFieldKey) => {
    const f = s.fields.find((x) => x.key === k)!;
    return { fontSize: `${labelFontMm(f.size)}mm`, fontWeight: f.bold ? 800 : 500, lineHeight: 1.12 };
  };
  useEffect(() => {
    if (!ref.current || !code) return;
    const opts = { height: 60, width: 2, margin: 0, displayValue: false } as const;
    try {
      JsBarcode(ref.current, code, { ...opts, format: isEan13(code) ? 'EAN13' : 'CODE128' });
    } catch {
      JsBarcode(ref.current, code, { ...opts, format: 'CODE128' });
    }
  }, [code]);
  const order = s.fields.filter((f) => f.enabled).map((f) => f.key);
  const before = order.filter((k) => k === 'businessName');
  const priceRow = order.filter((k) => k === 'mrp' || k === 'sellingPrice');
  const after = order.filter((k) => !['businessName', 'itemCode', 'mrp', 'sellingPrice'].includes(k));
  const text = (k: BarcodeFieldKey) =>
    k === 'businessName' ? shop : k === 'itemName' ? item.name : k === 'category' ? item.category : k === 'brand' ? item.brand : k === 'unit' ? item.unit : '';
  return (
    <div className={`blabel ${preview ? 'preview' : ''}`} style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
      {before.map((k) => <div key={k} className="bl-t" style={style(k)}>{text(k)}</div>)}
      {code ? <svg ref={ref} className="bl-code" style={{ maxHeight: `${(size.h * s.barcodeHeight) / 100}mm` }} preserveAspectRatio="none" /> : <div className="bl-t" style={{ fontSize: '2.4mm', color: '#a00' }}>No barcode / SKU</div>}
      {on('itemCode') && code && <div className="bl-t" style={style('itemCode')}>{code}</div>}
      {after.map((k) => text(k) ? <div key={k} className="bl-t" style={style(k)}>{text(k)}</div> : null)}
      {priceRow.length > 0 && (
        <div className="bl-prices">
          {on('mrp') && item.mrp != null && <span style={style('mrp')}>MRP: {money(item.mrp).replace('.00', '')}</span>}
          {on('sellingPrice') && <span style={style('sellingPrice')}>SP: {money(item.sp1)}</span>}
        </div>
      )}
    </div>
  );
}

export const SAMPLE_LABEL_ITEM: LabelItem = { name: 'Item 1', barcode: '1234567890', sku: 'ITEM-1', mrp: 100, sp1: 100, category: 'General', brand: 'Brand', unit: 'pcs' };
