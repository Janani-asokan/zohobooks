import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { ArrowLeft, Printer } from 'lucide-react';
import { useItems, useOrg } from '@/api/hooks';
import type { Item } from '@/api/types';
import { money } from '@/lib/format';

const isEan13 = (c: string) => /^\d{13}$/.test(c);

function Label({ item, shop }: { item: Item; shop: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const code = item.barcode || item.sku;
  useEffect(() => {
    if (!ref.current || !code) return;
    try {
      JsBarcode(ref.current, code, { format: isEan13(code) ? 'EAN13' : 'CODE128', height: 46, width: 1.6, fontSize: 12, margin: 0, displayValue: true });
    } catch {
      JsBarcode(ref.current, code, { format: 'CODE128', height: 46, width: 1.4, fontSize: 12, margin: 0 });
    }
  }, [code]);
  return (
    <div className="label">
      <div className="ln">{item.name}</div>
      {code ? <svg ref={ref} /> : <div className="small muted">No barcode / SKU</div>}
      <div className="lp">{money(item.sp1)} <span style={{ fontWeight: 500, fontSize: 9 }}>· {shop}</span></div>
    </div>
  );
}

/** Printable A4 sheet of barcode labels (3 × 8 = 24 per page). */
export default function BarcodeLabels() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const { data: items = [] } = useItems();
  const org = useOrg();
  const chosen = items.filter((i) => ids.includes(i.id));
  const [copies, setCopies] = useState<Record<string, number>>({});
  const labels = chosen.flatMap((it) => Array.from({ length: copies[it.id] ?? 3 }, () => it));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 24 }}>
      <div className="no-print card" style={{ maxWidth: 900, margin: '0 auto 20px', padding: 16 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row"><Link to="/app/items" className="icon-btn" aria-label="Back"><ArrowLeft size={18} /></Link><div><h1 style={{ fontSize: 18 }}>Barcode labels</h1><p className="small muted">{labels.length} labels · A4 sheet, 24 per page (63 × 34 mm)</p></div></div>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!labels.length}><Printer size={15} /> Print labels</button>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {chosen.map((it) => (
            <label key={it.id} className="chip-btn" style={{ cursor: 'default' }}>
              {it.name.slice(0, 28)}
              <input type="number" min={0} max={240} value={copies[it.id] ?? 3} onChange={(e) => setCopies({ ...copies, [it.id]: Math.max(0, Math.min(240, Number(e.target.value))) })} style={{ width: 52, border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink-900)' }} aria-label={`Copies of ${it.name}`} />
            </label>
          ))}
        </div>
      </div>
      <div className="print-area">
        <div className="label-sheet">{labels.map((it, i) => <Label key={it.id + i} item={it} shop={org.data?.companyName ?? ''} />)}</div>
      </div>
    </div>
  );
}
