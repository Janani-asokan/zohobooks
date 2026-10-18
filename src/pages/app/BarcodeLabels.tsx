import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, Settings2 } from 'lucide-react';
import { useItems, useOrg, usePrintSettings } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { BarcodeLabel, printWithPage } from '@/components/printing';
import { labelSize, withPrintDefaults } from '../../../shared/printSettings';

/** Prints barcode labels for the chosen items using the shop's Barcode Print settings. */
export default function BarcodeLabels() {
  const me = useShopUser();
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const { data: items = [] } = useItems();
  const org = useOrg();
  const s = withPrintDefaults(usePrintSettings().data).barcode;
  const size = labelSize(s.labelSize);
  const chosen = items.filter((i) => ids.includes(i.id));
  const [copies, setCopies] = useState<Record<string, number>>({});
  const labels = chosen.flatMap((it) => Array.from({ length: copies[it.id] ?? size.perRow }, () => it));
  const shop = org.data?.companyName ?? '';

  // Label printers feed one row at a time; A4 sheets hold a fixed grid.
  const rows: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += size.perRow) rows.push(labels.slice(i, i + size.perRow));
  const perSheet = size.perRow * (size.rowsPerPage ?? 1);
  const sheets: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += perSheet) sheets.push(labels.slice(i, i + perSheet));

  const print = () =>
    s.printer === 'label'
      ? printWithPage(`size: ${size.perRow * size.w + (size.perRow - 1) * 2}mm ${size.h}mm; margin: 0;`, 'print-labels')
      : printWithPage('size: A4; margin: 0;', 'print-labels');

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 24 }}>
      <div className="no-print card" style={{ maxWidth: 960, margin: '0 auto 20px', padding: 16 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row">
            <Link to="/app/items" className="icon-btn" aria-label="Back"><ArrowLeft size={18} /></Link>
            <div>
              <h1 style={{ fontSize: 18 }}>Barcode labels</h1>
              <p className="small muted">{labels.length} labels · {size.label} · {s.printer === 'label' ? 'label printer' : 'A4 sheet'}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {me.can('admin') && <Link to="/app/print-settings" className="btn btn-secondary"><Settings2 size={15} /> Label settings</Link>}
            <button className="btn btn-primary" onClick={print} disabled={!labels.length}><Printer size={15} /> Print labels</button>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {chosen.map((it) => (
            <label key={it.id} className="chip-btn" style={{ cursor: 'default' }}>
              {it.name.slice(0, 28)}
              <input type="number" min={0} max={500} value={copies[it.id] ?? size.perRow} onChange={(e) => setCopies({ ...copies, [it.id]: Math.max(0, Math.min(500, Number(e.target.value))) })} style={{ width: 56, border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 4px', background: 'var(--surface)', color: 'var(--ink-900)' }} aria-label={`Copies of ${it.name}`} />
            </label>
          ))}
          {chosen.length === 0 && <span className="small muted">No items selected. Go back and tick the items you want labels for.</span>}
        </div>
      </div>
      <div className="print-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s.printer === 'label' ? 8 : 16 }}>
        {s.printer === 'label'
          ? rows.map((r, i) => <div key={i} className="label-row">{r.map((it, j) => <BarcodeLabel key={it.id + j} item={it} shop={shop} s={s} />)}</div>)
          : sheets.map((sh, i) => (
              <div key={i} className="label-a4" style={{ gridTemplateColumns: `repeat(${size.perRow}, ${size.w}mm)`, gridAutoRows: `${size.h}mm` }}>
                {sh.map((it, j) => <BarcodeLabel key={it.id + j} item={it} shop={shop} s={s} />)}
              </div>
            ))}
      </div>
    </div>
  );
}
