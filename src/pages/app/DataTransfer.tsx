import { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, FileSpreadsheet, FileUp, Loader2, Sparkles, AlertTriangle, BookOpen, Users, Truck, Package } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, download } from '@/api/client';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/ui';
import { DateRange, periodPresets, type Range } from '@/components/DateRange';
import { parseCsvRaw } from '../../../shared/csv';
import { IMPORT_FIELDS, applyMapping, type ImportKind } from '../../../shared/columnMap';

interface ImportResult { created: number; skipped: number; errors: Array<{ row: number; error: string }>; warnings: string[] }
interface TallyPreview { company: string | null; counts: { customers: number; vendors: number; items: number; otherLedgers: number }; sample: { customers: Array<{ name: string; gstin: string; state: string }>; vendors: Array<{ name: string; gstin: string }>; items: Array<{ name: string; hsn: string; taxRate: number | null; price: number | null }> } }
const KIND_LABEL: Record<ImportKind, string> = { customers: 'Customers', vendors: 'Vendors', items: 'Items' };
const KIND_ICON = { customers: Users, vendors: Truck, items: Package };

/** Tally files can be UTF-16 (Tally's default) or UTF-8; read either. */
async function readText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

function Results({ r, title }: { r: ImportResult; title: string }) {
  return (
    <div className="import-result">
      <div className="row" style={{ gap: 8, fontWeight: 700, color: 'var(--green-700)' }}><CheckCircle2 size={16} /> {title}: {r.created} added{r.skipped ? `, ${r.skipped} already here (skipped)` : ''}</div>
      {r.warnings.map((w) => <div key={w} className="small" style={{ color: 'var(--amber-700)' }}><AlertTriangle size={12} /> {w}</div>)}
      {r.errors.length > 0 && <details className="small"><summary>{r.errors.length} row{r.errors.length === 1 ? '' : 's'} not imported</summary>{r.errors.slice(0, 50).map((e) => <div key={e.row}>Row {e.row}: {e.error}</div>)}</details>}
    </div>
  );
}

/** Tally export/import and lists from any other software, with AI matching the columns. */
export default function DataTransfer() {
  const me = useShopUser();
  const toast = useToast();
  const qc = useQueryClient();
  const canExport = me.can('accounting.read') || me.can('reports.read');
  const fy = useMemo(() => periodPresets(me.platform.fyStartMonth).find((p) => p.id === 'this_fy')!, [me.platform.fyStartMonth]);
  const [range, setRange] = useState<Range>({ from: fy.from, to: fy.to });
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => ['customers', 'vendors', 'items', 'stockInsights'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const exportXml = async (what: 'masters' | 'vouchers') => {
    setBusy(what);
    try {
      await download(what === 'masters' ? '/shop/tally/masters.xml' : `/shop/tally/vouchers.xml?from=${range.from}&to=${range.to}`, what === 'masters' ? 'tally-masters.xml' : `tally-vouchers-${range.from}-to-${range.to}.xml`);
      toast('success', what === 'masters' ? 'Masters downloaded' : 'Vouchers downloaded', 'Import it in Tally: Gateway of Tally → Import → ' + (what === 'masters' ? 'Masters' : 'Transactions'));
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };

  /* ---- Tally import ---- */
  const tallyRef = useRef<HTMLInputElement>(null);
  const [tally, setTally] = useState<{ file: string; xml: string; preview: TallyPreview } | null>(null);
  const [tallyInc, setTallyInc] = useState({ customers: true, vendors: true, items: true });
  const [tallyRes, setTallyRes] = useState<Record<string, ImportResult> | null>(null);
  const pickTally = async (f?: File | null) => {
    if (!f) return;
    setTallyRes(null);
    setBusy('tally-preview');
    try {
      const xml = await readText(f);
      const preview = await api.post<TallyPreview>('/shop/tally/preview', { xml });
      setTally({ file: f.name, xml, preview });
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const runTally = async () => {
    if (!tally) return;
    setBusy('tally-import');
    try { setTallyRes(await api.post<Record<string, ImportResult>>('/shop/tally/import', { xml: tally.xml, include: tallyInc })); refresh(); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };

  /* ---- Any software: CSV with column mapping ---- */
  const csvRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<{ file: string; headers: string[]; rows: Array<Record<string, string>>; kind: ImportKind; mapping: Record<string, string | null>; method: 'ai' | 'names'; note: string | null } | null>(null);
  const [sheetRes, setSheetRes] = useState<ImportResult | null>(null);
  const pickCsv = async (f?: File | null) => {
    if (!f) return;
    setSheetRes(null);
    if (/\.xlsx?$/i.test(f.name)) return toast('info', 'Save the sheet as CSV first', 'In Excel: File → Save As → CSV (Comma delimited). In Google Sheets: File → Download → CSV.');
    setBusy('map');
    try {
      const { headers, rows } = parseCsvRaw(await readText(f));
      if (!rows.length) throw new Error('The file has no data rows under the header row');
      const m = await api.post<{ kind: ImportKind; mapping: Record<string, string | null>; note: string | null; method: 'ai' | 'names' }>('/shop/data-import/map', { headers, sample: rows.slice(0, 5) });
      setSheet({ file: f.name, headers, rows, kind: m.kind, mapping: { ...Object.fromEntries(IMPORT_FIELDS[m.kind].map((x) => [x.key, null])), ...m.mapping }, method: m.method, note: m.note });
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const remap = async (kind: ImportKind) => {
    if (!sheet) return;
    setBusy('map');
    try {
      const m = await api.post<{ kind: ImportKind; mapping: Record<string, string | null>; note: string | null; method: 'ai' | 'names' }>('/shop/data-import/map', { kind, headers: sheet.headers, sample: sheet.rows.slice(0, 5) });
      setSheet({ ...sheet, kind, mapping: { ...Object.fromEntries(IMPORT_FIELDS[kind].map((x) => [x.key, null])), ...m.mapping }, method: m.method, note: m.note });
    } finally { setBusy(null); }
  };
  const mapped = sheet ? applyMapping(sheet.rows, sheet.mapping) : [];
  const missing = sheet ? IMPORT_FIELDS[sheet.kind].filter((f) => f.required && !sheet.mapping[f.key]) : [];
  const runSheet = async () => {
    if (!sheet) return;
    setBusy('sheet');
    try { setSheetRes(await api.post<ImportResult>('/shop/data-import', { kind: sheet.kind, rows: mapped })); refresh(); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <PageHeader title="Tally & Import" crumbs={<>Accounting <span>/</span> Tally &amp; Import</>}
        subtitle="Send your books to Tally for your CA, or bring customers, vendors and items in from Tally, Vyapar, Busy, Zoho or any Excel sheet." />

      {canExport && (
        <section className="card dt-card">
          <div className="dt-head"><span className="dt-icon"><ArrowUpFromLine size={18} /></span><div><h3>Export to Tally</h3><p className="small muted">TallyPrime and Tally.ERP 9. Import masters first, then vouchers.</p></div></div>
          <div className="dt-body">
            <div className="dt-steps">
              <div className="dt-step"><span>1</span><div><strong>Masters</strong><div className="small muted">Customers, vendors, stock items with HSN and GST, units, tax and bank ledgers.</div></div>
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => exportXml('masters')}>{busy === 'masters' ? <Loader2 size={15} className="spin" /> : <ArrowDownToLine size={15} />} Download masters.xml</button></div>
              <div className="dt-step"><span>2</span><div><strong>Vouchers</strong><div className="small muted">Sales invoices with items and GST, receipts, purchase bills and vendor payments.</div>
                <div style={{ marginTop: 8 }}><DateRange value={range} onChange={setRange} fyStartMonth={me.platform.fyStartMonth} /></div></div>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => exportXml('vouchers')}>{busy === 'vouchers' ? <Loader2 size={15} className="spin" /> : <ArrowDownToLine size={15} />} Download vouchers.xml</button></div>
            </div>
            <div className="dt-howto small"><BookOpen size={14} /><span>In Tally: open the company → <strong>Gateway of Tally → Import → Masters</strong> (choose masters.xml), then <strong>Import → Transactions</strong> (vouchers.xml). Ledgers are named Sales, Purchase, Output/Input CGST, SGST, IGST and Round Off.</span></div>
          </div>
        </section>
      )}

      <section className="card dt-card mt-16">
        <div className="dt-head"><span className="dt-icon sage"><ArrowDownToLine size={18} /></span><div><h3>Import from Tally</h3><p className="small muted">In Tally: Export → Masters → All Masters, format XML. Customers come from Sundry Debtors, vendors from Sundry Creditors.</p></div></div>
        <div className="dt-body">
          <input ref={tallyRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { void pickTally(e.target.files?.[0]); e.target.value = ''; }} />
          {!tally ? (
            <button className="dt-drop" onClick={() => tallyRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pickTally(e.dataTransfer.files[0]); }}>
              {busy === 'tally-preview' ? <Loader2 size={26} className="spin" /> : <FileUp size={26} />}<strong>Choose Tally XML file</strong><span className="small muted">or drop it here</span>
            </button>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="small muted">{tally.file}{tally.preview.company ? ` · company “${tally.preview.company}”` : ''}</div>
              <div className="dt-kinds">
                {(['customers', 'vendors', 'items'] as const).map((k) => { const I = KIND_ICON[k]; return (
                  <label key={k} className={`dt-kind ${tallyInc[k] ? 'on' : ''}`}>
                    <input type="checkbox" className="checkbox" checked={tallyInc[k]} onChange={(e) => setTallyInc({ ...tallyInc, [k]: e.target.checked })} disabled={!tally.preview.counts[k]} />
                    <I size={16} /><span><strong>{tally.preview.counts[k]}</strong> {KIND_LABEL[k].toLowerCase()}</span>
                    <span className="small muted">{tally.preview.sample[k].slice(0, 3).map((x) => x.name).join(', ')}</span>
                  </label>
                ); })}
              </div>
              {tallyRes ? Object.entries(tallyRes).map(([k, r]) => <Results key={k} r={r} title={KIND_LABEL[k as ImportKind]} />) : (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => setTally(null)}>Choose another file</button>
                  <button className="btn btn-primary" disabled={!!busy} onClick={runTally}>{busy === 'tally-import' && <Loader2 size={15} className="spin" />} Import</button>
                </div>
              )}
              {tallyRes && <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => { setTally(null); setTallyRes(null); }}>Import another file</button>}
            </div>
          )}
        </div>
      </section>

      <section className="card dt-card mt-16">
        <div className="dt-head"><span className="dt-icon gold"><FileSpreadsheet size={18} /></span><div><h3>Import from any software</h3><p className="small muted">Vyapar, Busy, Marg, Zoho, Tally reports or your own Excel sheet saved as CSV. AI works out which column is which; check it before importing.</p></div></div>
        <div className="dt-body">
          <input ref={csvRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv" hidden onChange={(e) => { void pickCsv(e.target.files?.[0]); e.target.value = ''; }} />
          {!sheet ? (
            <button className="dt-drop" onClick={() => csvRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pickCsv(e.dataTransfer.files[0]); }}>
              {busy === 'map' ? <Loader2 size={26} className="spin" /> : <FileUp size={26} />}<strong>Choose a CSV file</strong><span className="small muted">customers, vendors or items</span>
            </button>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="small muted">{sheet.file} · {sheet.rows.length} rows</span>
                <span className={`badge ${sheet.method === 'ai' ? 'badge-blue' : 'badge-gray'}`}>{sheet.method === 'ai' ? <><Sparkles size={11} /> Matched by AI</> : 'Matched by column names'}</span>
                <label className="row small" style={{ gap: 6, marginLeft: 'auto' }}>This file has
                  <select className="select" style={{ width: 130 }} value={sheet.kind} aria-label="What the file has" onChange={(e) => void remap(e.target.value as ImportKind)}>{(['customers', 'vendors', 'items'] as const).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
                </label>
              </div>
              {sheet.note && <div className="small" style={{ color: 'var(--amber-700)' }}><AlertTriangle size={12} /> {sheet.note}</div>}
              <div className="dt-map">
                {IMPORT_FIELDS[sheet.kind].map((f) => (
                  <label key={f.key} className={`dt-field ${f.required && !sheet.mapping[f.key] ? 'need' : ''}`}>
                    <span>{f.label}{f.required && ' *'}</span>
                    <select className="select" value={sheet.mapping[f.key] ?? ''} aria-label={`Column for ${f.label}`} onChange={(e) => setSheet({ ...sheet, mapping: { ...sheet.mapping, [f.key]: e.target.value || null } })}>
                      <option value="">— not in file —</option>{sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="table-wrap"><table className="table">
                <thead><tr>{IMPORT_FIELDS[sheet.kind].filter((f) => sheet.mapping[f.key]).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>{mapped.slice(0, 5).map((r, i) => <tr key={i}>{IMPORT_FIELDS[sheet.kind].filter((f) => sheet.mapping[f.key]).map((f) => <td key={f.key}>{r[f.key]}</td>)}</tr>)}</tbody>
              </table></div>
              {sheetRes ? (
                <><Results r={sheetRes} title={KIND_LABEL[sheet.kind]} /><button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => { setSheet(null); setSheetRes(null); }}>Import another file</button></>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => setSheet(null)}>Choose another file</button>
                  <button className="btn btn-primary" disabled={!!busy || missing.length > 0} onClick={runSheet}>{busy === 'sheet' && <Loader2 size={15} className="spin" />} Import {sheet.rows.length} {KIND_LABEL[sheet.kind].toLowerCase()}</button>
                  {missing.length > 0 && <span className="small text-red">Choose the column for {missing.map((m) => m.label).join(', ')}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
