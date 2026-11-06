import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Printer, Ruler, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui';
import { printWithPage } from '@/components/printing';
import {
  SHEET_MM, calibrationRuler, rowPitchMm, rowWidthMm, type PrinterSettings, type StockGeometry,
} from '../../../../shared/labelEngine';
import { LabelView } from '@/components/labels/LabelView';
import { LABEL_KEYS, SAMPLE_DATA, allPrinters, allStocks, device, setDevice, useLabelSetup, type LabelStockRow, type PrinterRow } from '@/components/labels/labelsApi';

const IN = 25.4;
/** A number in mm (shown in inches when the user prefers; stored in mm). */
function Mm({ id, label, value, onChange, min = 0, max = 300, inches }: { id: string; label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; inches: boolean }) {
  const shown = inches ? Math.round((value / IN) * 1000) / 1000 : value;
  return (
    <div className="field ls-num">
      <label htmlFor={id}>{label}</label>
      <div className="ls-num-box">
        <input id={id} className="input" type="number" step={inches ? 0.01 : 0.1} value={shown} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round((inches ? n * IN : n) * 10) / 10))); }} />
        <span className="muted small">{inches ? 'in' : 'mm'}</span>
      </div>
    </div>
  );
}

/** Stock & Printers (spec 2.1, 4.2, 6.4): stock profiles, printer profiles, calibration print and offsets. */
export default function StockPrinters() {
  const me = useShopUser();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useLabelSetup();
  const manage = me.can('items.write');
  const stocks = allStocks(setup.data); const printers = allPrinters(setup.data);
  const [editStock, setEditStock] = useState<{ id?: string; name: string; g: StockGeometry } | null>(null);
  const [editPrinter, setEditPrinter] = useState<{ id?: string; name: string; s: PrinterSettings } | null>(null);
  const [inches, setInches] = useState(false);
  const [devPrinter, setDevPrinter] = useState(device().printerId ?? '');
  const refresh = () => qc.invalidateQueries({ queryKey: LABEL_KEYS.setup });
  const saveStock = async () => {
    if (!editStock) return;
    try { await (editStock.id ? api.put(`/shop/label/stocks/${editStock.id}`, { name: editStock.name, geometry: editStock.g }) : api.post('/shop/label/stocks', { name: editStock.name, geometry: editStock.g })); toast('success', 'Label stock saved'); setEditStock(null); refresh(); }
    catch (e) { toast('error', 'Could not save', (e as Error).message); }
  };
  const savePrinter = async () => {
    if (!editPrinter) return;
    try { await (editPrinter.id ? api.put(`/shop/label/printers/${editPrinter.id}`, { name: editPrinter.name, settings: editPrinter.s }) : api.post('/shop/label/printers', { name: editPrinter.name, settings: editPrinter.s })); toast('success', 'Printer saved'); setEditPrinter(null); refresh(); }
    catch (e) { toast('error', 'Could not save', (e as Error).message); }
  };

  /* ---------- Calibration (TP-11, TP-12) ---------- */
  const [cal, setCal] = useState<{ stock: LabelStockRow; printer: PrinterRow } | null>(null);
  const [calOff, setCalOff] = useState({ x: 0, y: 0, dark: 8, speed: 4, across: '', along: '' });
  const calStock = cal?.stock.geometry;
  const printCal = () => {
    if (!calStock) return;
    const page = calStock.sheet === 'roll' ? `size: ${rowWidthMm(calStock)}mm ${calStock.h}mm; margin: 0;` : `size: ${SHEET_MM[calStock.sheet].w}mm ${SHEET_MM[calStock.sheet].h}mm; margin: 0;`;
    requestAnimationFrame(() => printWithPage(page, 'print-labels'));
  };
  const saveCal = async () => {
    if (!cal || cal.printer.preset) { toast('info', 'Save this printer first', 'Calibration is kept on a saved printer profile.'); return; }
    // A measured ruler length gives the scale; offsets are entered directly (0.1 mm steps).
    try { await api.put(`/shop/label/printers/${cal.printer.id}/calibrate`, { offsetX: calOff.x, offsetY: calOff.y, darkness: calOff.dark, speed: calOff.speed }); toast('success', 'Calibration saved for this printer'); refresh(); }
    catch (e) { toast('error', 'Could not save', (e as Error).message); }
  };
  const rulers = calStock ? calibrationRuler(calStock) : { across: 0, along: 0 };
  const measured = (want: number, got: string) => { const n = Number(got); return n > 0 ? Math.round(((n - want) / want) * 1000) / 10 : null; };

  return (
    <div className="lb-two">
      <section className="card ls-panel" aria-label="Label stock">
        <div className="row between"><h3>Label stock</h3>
          <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={inches} onChange={(e) => setInches(e.target.checked)} /> Show inches</label></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Stock</th><th>Label</th><th>Across</th><th>Row</th><th /></tr></thead>
          <tbody>{stocks.map((s) => (
            <tr key={s.id}>
              <td>{s.name}{s.preset ? <span className="muted small"> · built-in</span> : ''}<div className="small muted">{s.geometry.sheet === 'roll' ? `${s.geometry.media} roll` : `${SHEET_MM[s.geometry.sheet].label} sheet, ${s.geometry.rows} rows`}</div></td>
              <td className="mono small">{inches ? `${(s.geometry.w / IN).toFixed(2)} × ${(s.geometry.h / IN).toFixed(2)} in` : `${s.geometry.w} × ${s.geometry.h}`}</td>
              <td>{s.geometry.across}</td>
              <td className="small">{s.geometry.sheet === 'roll' ? `${rowWidthMm(s.geometry)} mm · pitch ${rowPitchMm(s.geometry)}` : ''}</td>
              <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                <button className="icon-btn sm" title="Calibration print" aria-label={`Calibrate with ${s.name}`} onClick={() => { const p = printers.find((x) => x.id === devPrinter) ?? printers[0]!; setCal({ stock: s, printer: p }); setCalOff({ x: p.settings.offsetX, y: p.settings.offsetY, dark: p.settings.darkness, speed: p.settings.speed, across: '', along: '' }); }}><Ruler size={14} /></button>
                {manage && <button className="icon-btn sm" title={s.preset ? 'Copy and change' : 'Edit'} aria-label={`${s.preset ? 'Copy' : 'Edit'} ${s.name}`} onClick={() => setEditStock({ id: s.preset ? undefined : s.id, name: s.preset ? `${s.name} (mine)` : s.name, g: { ...s.geometry } })}>{s.preset ? <Copy size={14} /> : <Pencil size={14} />}</button>}
                {manage && !s.preset && <button className="icon-btn sm danger" aria-label={`Delete ${s.name}`} onClick={() => void api.del(`/shop/label/stocks/${s.id}`).then(refresh)}><Trash2 size={14} /></button>}
              </td>
            </tr>))}</tbody>
        </table></div>
        {manage && <button className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={() => setEditStock({ name: 'My labels', g: { ...stocks[2]!.geometry } })}><Plus size={14} /> Add label stock</button>}
      </section>

      <aside className="card ls-panel" aria-label="Printers">
        <h3>Printers</h3>
        <div className="field">
          <label htmlFor="dev-printer">This computer prints labels on</label>
          <select id="dev-printer" className="select" value={devPrinter} onChange={(e) => { setDevPrinter(e.target.value); setDevice({ printerId: e.target.value }); }}>
            <option value="">Choose…</option>
            {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <ul className="lb-plist">{printers.filter((p) => !p.preset).map((p) => (
          <li key={p.id}><div><strong>{p.name}</strong><div className="small muted">{p.settings.language.toUpperCase()} · {p.settings.dpi} dpi · {p.settings.headMm} mm head · offset {p.settings.offsetX}/{p.settings.offsetY} mm{p.branchName ? ` · ${p.branchName}` : ''}</div></div>
            <span className="row" style={{ gap: 4 }}>
              {manage && <button className="icon-btn sm" aria-label={`Edit ${p.name}`} onClick={() => setEditPrinter({ id: p.id, name: p.name, s: { ...p.settings } })}><Pencil size={14} /></button>}
              {p.canRestore && <button className="icon-btn sm" title="Back to the last good settings" aria-label={`Restore ${p.name}`} onClick={() => void api.post(`/shop/label/printers/${p.id}/restore`).then(() => { toast('success', 'Last good settings restored'); refresh(); })}><RotateCcw size={14} /></button>}
              {manage && <button className="icon-btn sm danger" aria-label={`Delete ${p.name}`} onClick={() => void api.del(`/shop/label/printers/${p.id}`).then(refresh)}><Trash2 size={14} /></button>}
            </span></li>))}
        </ul>
        {manage && <div className="field"><label htmlFor="add-printer">Add a printer</label>
          <select id="add-printer" className="select" value="" onChange={(e) => { const p = printers.find((x) => x.id === e.target.value); if (p) setEditPrinter({ name: p.name.split(' (')[0]!.split(' ·')[0]!, s: { ...p.settings } }); }}>
            <option value="">Start from a printer type…</option>
            {printers.filter((p) => p.preset).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>}
        <p className="small muted">Printing goes through the browser’s print box today, at exact size. Direct printing (TSPL, ZPL, ESC/POS) needs a small print helper on the computer, planned next; the commands are already made from the same layout.</p>
      </aside>

      <Modal open={!!editStock} onClose={() => setEditStock(null)} title={editStock?.id ? 'Edit label stock' : 'New label stock'} subtitle="Physical size only. Stored in mm."
        footer={<><button className="btn btn-secondary" onClick={() => setEditStock(null)}>Cancel</button><button className="btn btn-primary" onClick={() => void saveStock()}>Save</button></>}>
        {editStock && <div className="lb-form">
          <div className="field"><label htmlFor="st-name">Name</label><input id="st-name" className="input" value={editStock.name} onChange={(e) => setEditStock({ ...editStock, name: e.target.value })} /></div>
          <div className="field"><label>Sheet</label><select className="select" value={editStock.g.sheet} onChange={(e) => setEditStock({ ...editStock, g: { ...editStock.g, sheet: e.target.value as StockGeometry['sheet'], rows: e.target.value === 'roll' ? 0 : editStock.g.rows || 8 } })}><option value="roll">Roll</option><option value="a4">A4 sheet</option><option value="letter">Letter sheet</option></select></div>
          <div className="ls-two">
            <Mm id="st-w" label="Label width" value={editStock.g.w} onChange={(w) => setEditStock({ ...editStock, g: { ...editStock.g, w } })} min={10} max={200} inches={inches} />
            <Mm id="st-h" label="Label height" value={editStock.g.h} onChange={(h) => setEditStock({ ...editStock, g: { ...editStock.g, h } })} min={8} max={300} inches={inches} />
            <div className="field"><label htmlFor="st-n">Labels across</label><input id="st-n" className="input" type="number" min={1} max={editStock.g.sheet === 'roll' ? 4 : 8} value={editStock.g.across} onChange={(e) => setEditStock({ ...editStock, g: { ...editStock.g, across: Math.max(1, Math.min(8, Number(e.target.value) || 1)) } })} /></div>
            <Mm id="st-g" label="Gutter between" value={editStock.g.gutter} onChange={(gutter) => setEditStock({ ...editStock, g: { ...editStock.g, gutter } })} max={30} inches={inches} />
            <Mm id="st-ml" label="Left margin" value={editStock.g.marginL} onChange={(marginL) => setEditStock({ ...editStock, g: { ...editStock.g, marginL } })} max={40} inches={inches} />
            <Mm id="st-mr" label="Right margin" value={editStock.g.marginR} onChange={(marginR) => setEditStock({ ...editStock, g: { ...editStock.g, marginR } })} max={40} inches={inches} />
            <Mm id="st-rg" label="Row gap" value={editStock.g.rowGap} onChange={(rowGap) => setEditStock({ ...editStock, g: { ...editStock.g, rowGap } })} max={20} inches={inches} />
            <Mm id="st-safe" label="Safe area inset" value={editStock.g.safeInset} onChange={(safeInset) => setEditStock({ ...editStock, g: { ...editStock.g, safeInset } })} max={5} inches={inches} />
          </div>
          {editStock.g.sheet === 'roll' ? (
            <div className="field"><label>Media</label><select className="select" value={editStock.g.media} onChange={(e) => setEditStock({ ...editStock, g: { ...editStock.g, media: e.target.value as StockGeometry['media'] } })}><option value="die-cut">Die-cut labels with gaps</option><option value="black-mark">Black mark</option><option value="continuous">Continuous (receipt paper)</option></select></div>
          ) : (
            <div className="ls-two">
              <div className="field"><label htmlFor="st-rows">Rows per sheet</label><input id="st-rows" className="input" type="number" min={1} max={60} value={editStock.g.rows} onChange={(e) => setEditStock({ ...editStock, g: { ...editStock.g, rows: Math.max(1, Math.min(60, Number(e.target.value) || 1)) } })} /></div>
              <Mm id="st-mt" label="Top margin" value={editStock.g.marginTop} onChange={(marginTop) => setEditStock({ ...editStock, g: { ...editStock.g, marginTop } })} max={60} inches={inches} />
            </div>
          )}
          <p className="small muted">Row width: <strong>{rowWidthMm(editStock.g)} mm</strong>{editStock.g.sheet === 'roll' ? ` · fits a ${rowWidthMm(editStock.g) - editStock.g.marginL - editStock.g.marginR - 2 * editStock.g.safeInset <= 48 ? '2' : rowWidthMm(editStock.g) - editStock.g.marginL - editStock.g.marginR - 2 * editStock.g.safeInset <= 72 ? '3' : '4'}-inch head or wider` : ''}</p>
        </div>}
      </Modal>

      <Modal open={!!editPrinter} onClose={() => setEditPrinter(null)} title={editPrinter?.id ? 'Edit printer' : 'New printer'} subtitle="Saved for your shop; each computer picks the one it uses."
        footer={<><button className="btn btn-secondary" onClick={() => setEditPrinter(null)}>Cancel</button><button className="btn btn-primary" onClick={() => void savePrinter()}>Save</button></>}>
        {editPrinter && <div className="lb-form">
          <div className="field"><label htmlFor="pr-name">Name</label><input id="pr-name" className="input" value={editPrinter.name} onChange={(e) => setEditPrinter({ ...editPrinter, name: e.target.value })} placeholder="e.g. Counter TSC" /></div>
          <div className="ls-two">
            <div className="field"><label>Language</label><select className="select" value={editPrinter.s.language} onChange={(e) => setEditPrinter({ ...editPrinter, s: { ...editPrinter.s, language: e.target.value as PrinterSettings['language'] } })}><option value="tspl">TSPL (TSC, Xprinter, TVS…)</option><option value="zpl">ZPL (Zebra)</option><option value="escpos">ESC/POS (receipt printers)</option><option value="browser">Office printer (browser only)</option></select></div>
            <div className="field"><label>Resolution</label><select className="select" value={editPrinter.s.dpi} onChange={(e) => setEditPrinter({ ...editPrinter, s: { ...editPrinter.s, dpi: Number(e.target.value) as 203 | 300 | 600 } })}><option value={203}>203 dpi (8 dots/mm)</option><option value={300}>300 dpi (12 dots/mm)</option><option value={600}>600 dpi (office laser)</option></select></div>
            <Mm id="pr-head" label="Head width" value={editPrinter.s.headMm} onChange={(headMm) => setEditPrinter({ ...editPrinter, s: { ...editPrinter.s, headMm } })} min={20} max={220} inches={false} />
            <div className="field"><label>Media</label><select className="select" value={editPrinter.s.media} onChange={(e) => setEditPrinter({ ...editPrinter, s: { ...editPrinter.s, media: e.target.value as PrinterSettings['media'] } })}><option value="die-cut">Labels with gaps</option><option value="black-mark">Black mark</option><option value="continuous">Continuous</option></select></div>
          </div>
        </div>}
      </Modal>

      <Modal open={!!cal} onClose={() => setCal(null)} size="lg" title="Calibration print" subtitle={cal ? `${cal.stock.name} on ${cal.printer.name}` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setCal(null)}>Close</button><button className="btn btn-secondary" onClick={printCal}><Printer size={15} /> Print calibration</button><button className="btn btn-primary" onClick={() => void saveCal()}>Save offsets</button></>}>
        {cal && calStock && <div className="lb-cal">
          <div>
            <div className="ls-sheets ls-roll"><div className="print-area"><CalibrationPage stock={calStock} /></div></div>
            <p className="small muted" style={{ marginTop: 8 }}>Print it, then measure with a steel rule. The rulers should be exactly {rulers.across} mm across and {rulers.along} mm along the feed; the box marks the safe area.</p>
          </div>
          <div className="lb-form">
            <div className="ls-two">
              <div className="field"><label htmlFor="cal-a">Ruler across measures</label><input id="cal-a" className="input" inputMode="decimal" value={calOff.across} onChange={(e) => setCalOff({ ...calOff, across: e.target.value })} placeholder={`${rulers.across}`} /></div>
              <div className="field"><label htmlFor="cal-b">Ruler along measures</label><input id="cal-b" className="input" inputMode="decimal" value={calOff.along} onChange={(e) => setCalOff({ ...calOff, along: e.target.value })} placeholder={`${rulers.along}`} /></div>
            </div>
            {[measured(rulers.across, calOff.across), measured(rulers.along, calOff.along)].some((v) => v != null && Math.abs(v) > 0.5) && (
              <div className="ls-warn">The print is {measured(rulers.across, calOff.across) ?? measured(rulers.along, calOff.along)}% off size. That is the print box scaling the page: set Scale to 100 (not “Fit to page”) and the paper size to this stock, then print again.</div>
            )}
            <div className="ls-two">
              <div className="field"><label htmlFor="cal-x">Shift right (mm)</label><input id="cal-x" className="input" type="number" step={0.1} value={calOff.x} onChange={(e) => setCalOff({ ...calOff, x: Math.round(Number(e.target.value) * 10) / 10 })} /></div>
              <div className="field"><label htmlFor="cal-y">Shift down (mm)</label><input id="cal-y" className="input" type="number" step={0.1} value={calOff.y} onChange={(e) => setCalOff({ ...calOff, y: Math.round(Number(e.target.value) * 10) / 10 })} /></div>
              <div className="field"><label htmlFor="cal-d">Darkness (0–15)</label><input id="cal-d" className="input" type="number" min={0} max={15} value={calOff.dark} onChange={(e) => setCalOff({ ...calOff, dark: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })} /></div>
              <div className="field"><label htmlFor="cal-s">Speed (inch/s)</label><input id="cal-s" className="input" type="number" min={1} max={14} value={calOff.speed} onChange={(e) => setCalOff({ ...calOff, speed: Math.max(1, Math.min(14, Number(e.target.value) || 4)) })} /></div>
            </div>
            <p className="small muted">If the corner marks sit off the label, enter how far to move everything (0.1 mm steps). Saved on this printer; store staff can calibrate too.</p>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

/** TP-11: a ruler across and along the feed, the safe-area box, corner marks and a test barcode, at real size. */
export function CalibrationPage({ stock }: { stock: StockGeometry }) {
  const roll = stock.sheet === 'roll';
  const W = stock.sheet === 'roll' ? rowWidthMm(stock) : SHEET_MM[stock.sheet].w; const H = stock.sheet === 'roll' ? stock.h : SHEET_MM[stock.sheet].h;
  const r = calibrationRuler(stock);
  const ticks = (n: number, axis: 'x' | 'y') => Array.from({ length: n + 1 }, (_, i) => {
    const len = i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1;
    return axis === 'x' ? <line key={i} x1={i} y1={0} x2={i} y2={len} /> : <line key={i} x1={0} y1={i} x2={len} y2={i} />;
  });
  return (
    <div className="label-page lb-calpage" style={{ width: `${W}mm`, height: `${H}mm` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: `${W}mm`, height: `${H}mm` }} stroke="#000" strokeWidth={0.15} fill="none">
        {/* labels and safe areas */}
        {roll && Array.from({ length: stock.across }, (_, i) => { const x = stock.marginL + i * (stock.w + stock.gutter); return <g key={i}><rect x={x} y={0} width={stock.w} height={stock.h} strokeDasharray="0.6 0.6" /><rect x={x + stock.safeInset} y={stock.safeInset} width={stock.w - 2 * stock.safeInset} height={stock.h - 2 * stock.safeInset} /></g>; })}
        {/* corner marks */}
        {[[0.5, 0.5], [W - 0.5, 0.5], [0.5, H - 0.5], [W - 0.5, H - 0.5]].map(([x, y], i) => <g key={i}><line x1={x! - 0.5} y1={y} x2={x! + 0.5} y2={y} /><line x1={x} y1={y! - 0.5} x2={x} y2={y! + 0.5} /></g>)}
        <g transform={`translate(1, ${Math.min(H - 6, roll ? stock.h / 2 : 20)})`}>{ticks(r.across, 'x')}<text x={0} y={5.5} fontSize={2.6} fill="#000" stroke="none">0</text><text x={r.across - 4} y={5.5} fontSize={2.6} fill="#000" stroke="none">{r.across} mm</text></g>
        <g transform={`translate(${roll ? stock.marginL + 2 : 20}, 1)`}>{ticks(r.along, 'y')}</g>
      </svg>
      {/* a test barcode in the first label, below the ruler */}
      <div style={{ position: 'absolute', left: `${roll ? stock.marginL : 20}mm`, top: 0 }}>
        <LabelView tpl={{ w: stock.w, h: stock.h, elements: [{ id: 't', type: 'barcode', field: 'barcode', x: 1, y: Math.min(stock.h * 0.62, stock.h - 7), w: stock.w - 2, h: Math.max(4, Math.min(8, stock.h * 0.3)), symbology: 'CODE128' }] }} data={{ ...SAMPLE_DATA, barcode: 'TEST-1234' }} />
      </div>
    </div>
  );
}
