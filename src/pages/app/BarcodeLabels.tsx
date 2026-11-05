import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Layers, Minus, Plus, Printer, RotateCw, Save, ScanBarcode, Settings2, Tag, Trash2, X } from 'lucide-react';
import { api } from '@/api/client';
import type { Item } from '@/api/types';
import { useItems, useMut, useOrg, usePrintSettings } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { BarcodeLabel, printWithPage } from '@/components/printing';
import { SearchInput, Segmented } from '@/components/ui';
import { withPrintDefaults, type PrintSettings } from '../../../shared/printSettings';
import {
  LAYOUT_PRESETS, ROLLS, labelPageCss, layoutProblems, legacySizeFor, resolveLayout, rowWidth, symbologyFor, type LabelLayout,
} from '../../../shared/labelLayout';

const MAX_COPIES = 500;
const clampCopies = (n: number) => Math.max(0, Math.min(MAX_COPIES, Math.round(Number(n) || 0)));
const same = (a: LabelLayout, b: LabelLayout) => (Object.keys(a) as Array<keyof LabelLayout>).every((k) => a[k] === b[k]);

/** A number box in mm (or a count) that keeps what is being typed and reports a number. */
function Num({ label, value, onChange, min = 0, max = 300, unit = 'mm', id }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: string; id: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]);
  return (
    <div className="field ls-num">
      <label htmlFor={id}>{label}</label>
      <div className="ls-num-box">
        <input id={id} className="input" inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); }} />
        {unit && <span className="muted small">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Label studio: pick items, choose the label stock (a 2 / 3 / 4 inch thermal roll, or an A4 sticker sheet), the label
 * size, how many labels sit side by side, the gaps, and the turn, then print. The preview is drawn at the real size.
 * Opened with ?ids=… (from Items or a stock bill) it starts with those items; on its own it starts at the picker.
 */
export default function BarcodeLabels() {
  const me = useShopUser();
  const [params] = useSearchParams();
  const { data: items = [] } = useItems();
  const org = useOrg();
  const ps = usePrintSettings();
  const settings = withPrintDefaults(ps.data);
  const s = settings.barcode;
  const savedLayout = useMemo(() => resolveLayout(s), [ps.data]);
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const l = layout ?? savedLayout;
  const set = (p: Partial<LabelLayout>) => setLayout({ ...l, ...p });
  const problems = layoutProblems(l);
  const dirty = !!layout && !same(layout, savedLayout);

  // Copies per item, in the order they were added. ?ids=a,b&qty=20,5 (one per piece received on a bill), ?per=stock
  // (one per piece on the shelf), otherwise one row of labels each.
  const [copies, setCopies] = useState<Array<[string, number]> | null>(null);
  useEffect(() => {
    if (copies || !items.length) return;
    const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
    const qty = (params.get('qty') ?? '').split(',').map((n) => clampCopies(Number(n)));
    const perStock = params.get('per') === 'stock';
    setCopies(ids.flatMap((id, i) => {
      const it = items.find((x) => x.id === id);
      if (!it) return [];
      return [[id, qty[i] || (perStock ? Math.max(1, clampCopies(it.stock)) : savedLayout.across)] as [string, number]];
    }));
  }, [items, copies]);
  const chosen = (copies ?? []).map(([id, n]) => ({ it: items.find((x) => x.id === id)!, n })).filter((c) => c.it);
  const setCount = (id: string, n: number) => setCopies((copies ?? []).map(([x, c]) => (x === id ? [x, clampCopies(n)] : [x, c])));
  const add = (it: Item) => { if (!(copies ?? []).some(([x]) => x === it.id)) setCopies([...(copies ?? []), [it.id, l.across]]); };
  const remove = (id: string) => setCopies((copies ?? []).filter(([x]) => x !== id));

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => i.type === 'Goods' && (!cat || i.category === cat) && (!t || i.name.toLowerCase().includes(t) || i.sku.toLowerCase().includes(t) || (i.barcode ?? '').includes(t)));
  }, [items, q, cat]);

  const labels = chosen.flatMap(({ it, n }) => Array.from({ length: n }, () => it));
  const perPage = l.stock === 'a4' ? l.across * l.rows : l.across;
  const pages: Item[][] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  const shop = org.data?.companyName ?? '';
  const bad = chosen.filter(({ it }) => 'error' in symbologyFor(it.barcode || it.sku));

  const [testOnly, setTestOnly] = useState(false);
  const print = (test = false) => {
    setTestOnly(test);
    // Let React draw just the test row first, then print.
    requestAnimationFrame(() => requestAnimationFrame(() => { printWithPage(labelPageCss(l), 'print-labels'); setTestOnly(false); }));
  };
  const shown = testOnly ? pages.slice(0, 1) : pages;

  const save = useMut((b: PrintSettings) => api.put<PrintSettings>('/shop/print-settings', b), [['printSettings']], { success: 'Label layout saved as this shop’s default' });
  const saveDefault = () => save.mutate({ ...settings, barcode: { ...s, ...legacySizeFor(l), layout: l } }, { onSuccess: () => setLayout(null) });

  const presetId = LAYOUT_PRESETS.find((p) => same({ ...p.layout, rotate: l.rotate }, l))?.id ?? '';
  const turnLabel = l.rotate === 90 ? 'turned 90°' : l.rotate === 270 ? 'turned 270°' : '';
  const pageW = l.stock === 'a4' ? 210 : l.rotate ? l.h : rowWidth(l);
  const pageH = l.stock === 'a4' ? 297 : l.rotate ? rowWidth(l) : l.h;

  return (
    <div className="page ls-page">
      <div className="page-header no-print">
        <div>
          <h1 className="row" style={{ gap: 8 }}><Tag size={20} /> Barcode labels</h1>
          <p>Pick items, choose your label roll or sticker sheet, and print. What you see is the real label size.</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {me.can('admin') && <Link to="/app/print-settings?tab=barcode" className="btn btn-secondary"><Settings2 size={15} /> What prints on a label</Link>}
          <button className="btn btn-secondary" onClick={() => print(true)} disabled={!labels.length || problems.length > 0} title="Prints only the first row or sheet, to check the alignment"><Printer size={15} /> Test print</button>
          <button className="btn btn-primary" onClick={() => print(false)} disabled={!labels.length || problems.length > 0}><Printer size={15} /> Print labels</button>
        </div>
      </div>

      <div className="ls-grid">
        {/* ---------- Items ---------- */}
        <section className="card ls-panel no-print" aria-label="Items to label">
          <h3>1 · Items</h3>
          {chosen.length > 0 && (
            <ul className="ls-chosen">
              {chosen.map(({ it, n }) => {
                const sym = symbologyFor(it.barcode || it.sku);
                return (
                  <li key={it.id} className={'error' in sym ? 'bad' : ''}>
                    <div className="ls-chosen-name">
                      <span className="strong">{it.name}</span>
                      <span className="small muted mono">{it.barcode || it.sku || 'no code'}{'format' in sym ? ` · ${sym.format === 'CODE128' ? 'Code 128' : sym.format === 'UPC' ? 'UPC-A' : sym.format.replace('EAN', 'EAN-')}` : ''}</span>
                      {'error' in sym && <span className="small ls-err"><AlertTriangle size={12} /> {sym.error}</span>}
                    </div>
                    <div className="ls-step" aria-label={`Copies of ${it.name}`}>
                      <button type="button" onClick={() => setCount(it.id, n - 1)} disabled={n <= 0} aria-label="One less"><Minus size={13} /></button>
                      <input type="number" min={0} max={MAX_COPIES} value={n} onChange={(e) => setCount(it.id, Number(e.target.value))} aria-label={`Copies of ${it.name}`} />
                      <button type="button" onClick={() => setCount(it.id, n + 1)} disabled={n >= MAX_COPIES} aria-label="One more"><Plus size={13} /></button>
                    </div>
                    <button type="button" className="icon-btn sm" aria-label={`Remove ${it.name}`} onClick={() => remove(it.id)}><X size={14} /></button>
                  </li>
                );
              })}
            </ul>
          )}
          {chosen.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setCopies(chosen.map(({ it }) => [it.id, Math.max(1, clampCopies(it.stock))]))}>One per piece in stock</button>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setCopies(chosen.map(({ it }) => [it.id, l.across]))}>One row each</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCopies([])}><Trash2 size={13} /> Clear</button>
            </div>
          )}
          <div className="ls-pick">
            <SearchInput value={q} onChange={setQ} placeholder="Find items by name, SKU or barcode" />
            {cats.length > 1 && (
              <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <ul className="ls-results" aria-label="Items">
              {matches.slice(0, 60).map((it) => {
                const inList = chosen.some((c) => c.it.id === it.id);
                return (
                  <li key={it.id}>
                    <button type="button" className={inList ? 'on' : ''} onClick={() => (inList ? remove(it.id) : add(it))} aria-pressed={inList}>
                      <span className="ls-tick">{inList ? <Check size={13} /> : <Plus size={13} />}</span>
                      <span className="ls-res-name">{it.name}<span className="small muted"> · {it.barcode || it.sku || 'no barcode'} · {it.stock} in stock</span></span>
                    </button>
                  </li>
                );
              })}
              {!matches.length && <li className="small muted" style={{ padding: 8 }}>No goods match.</li>}
            </ul>
            {matches.length > 1 && <button type="button" className="btn btn-soft btn-sm" onClick={() => setCopies([...(copies ?? []), ...matches.slice(0, 200).filter((m) => !chosen.some((c) => c.it.id === m.id)).map((m) => [m.id, l.across] as [string, number])])}>Add all {Math.min(200, matches.length)} shown</button>}
          </div>
        </section>

        {/* ---------- Preview ---------- */}
        <section className="ls-stage" aria-label="Label preview">
          {!chosen.length ? (
            <div className="card ls-home no-print">
              <ScanBarcode size={34} />
              <h2>Print barcode labels in three steps</h2>
              <ol>
                <li><strong>Pick items</strong> on the left. Each starts with one row of labels; set how many you need, or one per piece in stock.</li>
                <li><strong>Choose your label stock</strong> on the right: a 2, 3 or 4 inch thermal roll with 1, 2 or 3 labels across, or an A4 sticker sheet.</li>
                <li><strong>Test print</strong> one row to check the alignment, then <strong>Print labels</strong>.</li>
              </ol>
              <p className="small muted">Items without a barcode print their SKU as a Code 128 barcode. To give them their own barcode, open <Link to="/app/items">Items</Link> and choose <em>Generate barcodes</em>. Item names can be in any language; the barcode itself holds English letters, digits and - . / only.</p>
            </div>
          ) : (
            <>
              <div className="ls-summary no-print">
                <span><strong>{labels.length}</strong> label{labels.length === 1 ? '' : 's'}</span>
                <span>{pages.length} {l.stock === 'a4' ? `A4 sheet${pages.length === 1 ? '' : 's'}` : `row${pages.length === 1 ? '' : 's'}`}</span>
                <span>Page sent to the printer: <strong className="mono">{pageW} × {pageH} mm</strong>{turnLabel && ` (${turnLabel})`}</span>
              </div>
              {bad.length > 0 && <div className="ls-warn no-print"><AlertTriangle size={14} /> {bad.length} item{bad.length === 1 ? '' : 's'} can’t be printed as a barcode (shown in red). Fix the barcode or SKU on the item.</div>}
              {pages.length > 40 && !testOnly && <div className="small muted no-print" style={{ marginBottom: 8 }}>Showing every label; long runs take a moment to send to the printer.</div>}
            </>
          )}
          <div className={`print-area ls-sheets ls-${l.stock}`}>
            {l.stock === 'roll'
              ? shown.map((row, i) => {
                  const r = (
                    <div className="label-row" style={{ width: `${rowWidth(l)}mm`, height: `${l.h}mm`, padding: `0 ${l.marginX}mm`, gap: `${l.gapX}mm` }}>
                      {row.map((it, j) => <BarcodeLabel key={it.id + j} item={it} shop={shop} s={s} w={l.w} h={l.h} />)}
                    </div>
                  );
                  return l.rotate
                    ? <div key={i} className={`label-turn turn-${l.rotate}`} style={{ '--rw': `${rowWidth(l)}mm`, '--rh': `${l.h}mm` } as React.CSSProperties}>{r}</div>
                    : <div key={i} className="label-page">{r}</div>;
                })
              : shown.map((sheet, i) => (
                  <div key={i} className="label-a4" style={{ padding: `${l.marginY}mm ${l.marginX}mm 0`, gridTemplateColumns: `repeat(${l.across}, ${l.w}mm)`, gridAutoRows: `${l.h}mm`, columnGap: `${l.gapX}mm`, rowGap: `${l.gapY}mm` }}>
                    {sheet.map((it, j) => <BarcodeLabel key={it.id + j} item={it} shop={shop} s={s} w={l.w} h={l.h} />)}
                  </div>
                ))}
          </div>
        </section>

        {/* ---------- Label stock ---------- */}
        <section className="card ls-panel no-print" aria-label="Label stock and layout">
          <h3>2 · Label stock</h3>
          <Segmented value={l.stock} onChange={(v) => setLayout(v === 'a4' ? { ...LAYOUT_PRESETS.find((p) => p.layout.stock === 'a4')!.layout } : { ...LAYOUT_PRESETS[0]!.layout })}
            options={[{ value: 'roll', label: 'Label roll' }, { value: 'a4', label: 'A4 sheet' }]} />
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="ls-preset">Common sizes</label>
            <select id="ls-preset" className="select" value={presetId} onChange={(e) => { const p = LAYOUT_PRESETS.find((x) => x.id === e.target.value); if (p) setLayout({ ...p.layout, rotate: l.rotate }); }}>
              {!presetId && <option value="">{dirty ? 'Custom size' : 'Your saved size'}: {l.w} × {l.h} mm, {l.stock === 'a4' ? `${l.across * l.rows} per sheet` : `${l.across} across`}</option>}
              {LAYOUT_PRESETS.filter((p) => p.layout.stock === l.stock).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          {l.stock === 'roll' && (
            <div className="field">
              <label>Roll width</label>
              <div className="ls-chips" role="radiogroup" aria-label="Roll width">
                {ROLLS.map((r) => <button key={r.id} type="button" role="radio" aria-checked={l.rollMm === r.mm} className={l.rollMm === r.mm ? 'on' : ''} onClick={() => set({ rollMm: r.mm })}>{r.label}</button>)}
              </div>
            </div>
          )}
          <div className="ls-two">
            <Num id="ls-w" label="Label width" value={l.w} onChange={(w) => set({ w })} min={10} max={200} />
            <Num id="ls-h" label="Label height" value={l.h} onChange={(h) => set({ h })} min={8} max={300} />
          </div>
          <div className="field">
            <label>{l.stock === 'a4' ? 'Labels across the sheet' : 'Labels side by side'}</label>
            <div className="ls-chips" role="radiogroup" aria-label="Labels across">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={l.across === n} className={l.across === n ? 'on' : ''} onClick={() => set({ across: n })}>{n}</button>)}
            </div>
          </div>
          <div className="ls-two">
            <Num id="ls-gx" label="Gap between labels" value={l.gapX} onChange={(gapX) => set({ gapX })} max={20} />
            <Num id="ls-mx" label={l.stock === 'a4' ? 'Left margin' : 'Left edge'} value={l.marginX} onChange={(marginX) => set({ marginX })} max={30} />
          </div>
          {l.stock === 'a4' && (
            <div className="ls-two">
              <Num id="ls-rows" label="Rows per sheet" value={l.rows} onChange={(rows) => set({ rows: Math.round(rows) })} min={1} max={40} unit="" />
              <Num id="ls-my" label="Top margin" value={l.marginY} onChange={(marginY) => set({ marginY })} max={40} />
              <Num id="ls-gy" label="Gap between rows" value={l.gapY} onChange={(gapY) => set({ gapY })} max={20} />
            </div>
          )}
          {l.stock === 'roll' && (
            <div className="field">
              <label className="row" style={{ gap: 6 }}><RotateCw size={14} /> Labels come out sideways?</label>
              <div className="ls-chips" role="radiogroup" aria-label="Turn the label">
                {([0, 90, 270] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={l.rotate === r} className={l.rotate === r ? 'on' : ''} onClick={() => set({ rotate: r })}>{r === 0 ? 'As shown' : `Turn ${r}°`}</button>)}
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>Some printer drivers feed the label the other way round. Turn 90°; if the text then comes out upside down, use 270°.</p>
            </div>
          )}
          {problems.length > 0 && <div className="ls-warn" role="alert">{problems.map((p) => <div key={p}><AlertTriangle size={13} /> {p}</div>)}</div>}
          {me.can('admin') && (
            <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }} disabled={!dirty || problems.length > 0 || save.isPending} onClick={saveDefault}>
              <Save size={15} /> {dirty ? 'Save as this shop’s default' : 'Saved as default'}
            </button>
          )}
          {dirty && <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => setLayout(null)}>Back to the saved layout</button>}

          <details className="ls-tips">
            <summary><Layers size={14} /> Setting up the label printer</summary>
            <ol>
              <li><strong>Printer driver (once):</strong> Windows Settings → Printers → your label printer → <em>Printing preferences</em> → add a paper / stock of <strong className="mono">{pageW} × {pageH} mm</strong>{l.stock === 'roll' ? ', type “Labels with gaps”, gap 2–3 mm' : ''}.</li>
              <li><strong>Print box (once):</strong> choose that paper size, Margins <em>None</em>, Scale <em>Default</em> or <em>100</em> (never “Fit to page”), and untick <em>Headers and footers</em>. Chrome remembers it.</li>
              <li><strong>Labels sideways:</strong> use <em>Turn 90°</em> above. <strong>Labels drifting down the roll:</strong> calibrate the printer (most TSC / Zebra / TVS printers: hold the feed button until it feeds a few labels).</li>
              <li><strong>Won’t scan:</strong> keep the barcode at least 30% of the label height (<Link to="/app/print-settings?tab=barcode">label content</Link>), and print at 100% scale. Bars are drawn on whole printer dots with blank margins, so do not stretch them.</li>
            </ol>
          </details>
        </section>
      </div>
    </div>
  );
}
