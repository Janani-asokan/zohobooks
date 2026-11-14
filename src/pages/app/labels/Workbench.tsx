import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, ArrowDown, Check, ChevronLeft, ChevronRight, FileUp, Layers, Minus, Plus, Printer, RotateCw, Save, ScanBarcode, Trash2, X } from 'lucide-react';
import { api } from '@/api/client';
import type { Bill, Item, PurchaseOrder } from '@/api/types';
import { useBills, useItems, useMut, useOrg, usePrintSettings, usePurchaseOrders } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { printWithPage } from '@/components/printing';
import { CheckCard, Choice, DriverSteps, LabelPaperSteps, TurnIcons, nextTurn } from '@/components/PrintCheck';
import { SearchInput } from '@/components/ui';
import { labelMemory, rememberLabel } from '@/lib/printerMemory';
import { parseCsv } from '../../../../shared/csv';
import { findByCode } from '../../../../shared/barcode';
import { type Turn } from '../../../../shared/labelLayout';
import { withPrintDefaults, type PrintSettings } from '../../../../shared/printSettings';
import {
  DEFAULT_IMPOSE, JOB_CONFIRM_ABOVE, JOB_MAX, SHEET_MM, blockedLines, driverPaperMm, impose, jobBlocked, jobMetrics, labelPageCss, rowPitchMm, rowWidthMm, validateJob,
  type ImposeOptions, type Issue, type JobLine, type LabelTemplateBody, type StockGeometry,
} from '../../../../shared/labelEngine';
import { LabelView } from '@/components/labels/LabelView';
import { DirectPrinterPicker, PcHelperPicker, useDirectConn } from '@/components/labels/DirectPrinter';
import { directSupported, printRowsDirect, rowBitmap } from '@/lib/labelDirect';
import { isNativeApp } from '@/lib/native';
import {
  LABEL_KEYS, allPrinters, allStocks, autoFromSettings, device, labelDataFor, newKey, sameGeom, setDevice, settingsWithStock, startPrinterId, stockFromSettings, templateFor, turnFromSettings, useLabelSetup, type JobRow, type PrinterRow,
} from '@/components/labels/labelsApi';

type Src = 'items' | 'purchase_order' | 'bill' | 'batches' | 'csv' | 'scan';
interface Line { key: string; itemId: string; batch: string; expiry: string; location: string; qty: number; onHand: number; ordered?: number; received?: number; printed?: number }
const clamp = (n: number) => Math.max(0, Math.min(JOB_MAX, Math.round(Number(n) || 0)));
const ROWS_PER_SCREEN = 12;
const CHUNK_ROWS = 100;          // BP-09: output in chunks of 100 rows
const IMMEDIATE_LABELS = 500;    // BP-08

/** The usual 3-inch and 4-inch printer rolls, drawn to scale, for "Which labels are in the printer?". */
const IN_PRINTER = [
  { roll: 3, id: 'preset:3in-38x25x2', label: '38 × 25, 2 across', across: 2, w: 80, h: 25 },
  { roll: 3, id: 'preset:50x25x1', label: '50 × 25', across: 1, w: 52, h: 25 },
  { roll: 3, id: 'preset:3in-75x25', label: '75 × 25', across: 1, w: 78, h: 25 },
  { roll: 3, id: 'preset:3in-75x38', label: '75 × 38', across: 1, w: 78, h: 38 },
  { roll: 3, id: 'preset:3in-75x50', label: '75 × 50', across: 1, w: 78, h: 50 },
  { roll: 3, id: 'preset:3in-50x75', label: '50 × 75 (tall)', across: 1, w: 52, h: 75 },
  { roll: 4, id: 'preset:4in-50x25x2', label: '50 × 25, 2 across', across: 2, w: 104, h: 25 },
  { roll: 4, id: 'preset:4in-100x50', label: '100 × 50', across: 1, w: 104, h: 50 },
  { roll: 4, id: 'preset:4in-100x75', label: '100 × 75', across: 1, w: 104, h: 75 },
  { roll: 4, id: 'preset:4in-100x100', label: '100 × 100', across: 1, w: 104, h: 100 },
  { roll: 4, id: 'preset:4in-100x150', label: '100 × 150 (4 × 6 in)', across: 1, w: 104, h: 150 },
].map((x) => ({ ...x, pw: x.w / 4, ph: x.h / 4 }));
const sideways = (t: Turn) => t === 90 || t === 270;
/**
 * The page for one printed row: always the row's exact size (Chrome's preview then shows label-sized pages, never A4,
 * and nothing is scaled). A printer profile set to "driver" leaves wide rows to the driver's own paper instead, for a
 * Windows driver that turns a wide page sideways. The phone app always gets the size (its print screen has no driver).
 */
const pageCss = (s: StockGeometry, turn: Turn, mode: 'exact' | 'driver' = 'exact', app = isNativeApp()) => labelPageCss(s, turn, app ? 'exact' : mode);

/** Print Workbench (spec 2.1): build a job from any source, check it, preview it at real size, print it. */
export default function Workbench({ reprintOf, onOpenTab }: { reprintOf?: JobRow | null; onOpenTab: (t: string) => void }) {
  const me = useShopUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: items = [] } = useItems();
  const org = useOrg();
  const ps = usePrintSettings();
  const settings = withPrintDefaults(ps.data);
  const setup = useLabelSetup();
  const canPurch = me.can('purchases.read');
  const pos = usePurchaseOrders(canPurch);
  const bills = useBills(canPurch);
  const company = org.data?.companyName ?? '';
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /* ---------- Stock, printer, template ---------- */
  const stocks = allStocks(setup.data);
  const printers = allPrinters(setup.data);
  const dev = device();
  const [stockId, setStockId] = useState<string>('');
  const [geom, setGeom] = useState<StockGeometry | null>(null);
  const saved = useMemo(() => stockFromSettings(settings), [ps.data]);
  useEffect(() => {
    if (geom || !ps.data || !setup.data) return;
    // A computer with no printer chosen starts with the shop's default printer, and the stock saved on it.
    const startP = printers.find((p) => p.id === startPrinterId(setup.data));
    if (startP && !printerId) setPrinterId(startP.id);
    const d = stocks.find((s) => s.id === dev.stockId) ?? (dev.stockId ? undefined : stocks.find((s) => s.id === startP?.settings.stockId));
    const g = d?.geometry ?? saved;
    setGeom(g); setStockId(d?.id ?? stocks.find((s) => sameGeom(s.geometry, g))?.id ?? '');
  }, [ps.data, setup.data]);
  const stock = geom ?? saved;
  const [printerId, setPrinterId] = useState<string>(() => dev.printerId ?? '');
  const printerRow = printers.find((p) => p.id === printerId) ?? printers.find((p) => p.preset && (stock.sheet !== 'roll' ? p.settings.language === 'browser' : p.settings.headMm >= rowWidthMm(stock) - 2 && p.settings.language !== 'browser')) ?? printers.at(-1)!;
  const printer = printerRow.settings;
  // Which roll width the label chips show: the chosen stock's (a row up to 80 mm is a 3-inch roll).
  const [rollPick, setRollIn] = useState<3 | 4 | null>(null);
  const rollIn: 3 | 4 = rollPick ?? (stock.sheet === 'roll' && rowWidthMm(stock) > 82 ? 4 : 3);
  const templates = (setup.data?.templates ?? []).filter((t) => t.published);
  const [templateId, setTemplateId] = useState<string>(() => dev.templateId ?? '');
  const sizeTemplates = templates.filter((t) => Math.abs(t.published!.w - stock.w) < 0.25 && Math.abs(t.published!.h - stock.h) < 0.25);
  const chosenTpl = sizeTemplates.find((t) => t.id === templateId);
  const tpl: LabelTemplateBody = chosenTpl?.published ?? autoFromSettings(stock.w, stock.h, settings.barcode);

  // Device turn for this label size (the one-question printer check), as before.
  const [, setTick] = useState(0);
  const mem = labelMemory(stock.w, stock.h);
  // This computer's answer to the printer check, else the turn saved with the shop's default stock of this size.
  const shopTurn = sameGeom(stock, saved) ? turnFromSettings(settings) : 0;
  const turn: Turn = stock.sheet === 'roll' ? (mem?.turn ?? shopTurn) : 0;
  // Phone app: straight to a Bluetooth / Wi-Fi label printer, told the exact label size (no print screen).
  const conn = useDirectConn();
  const [sending, setSending] = useState(false);
  const rememberTurn = (v: { turn: Turn; ok?: boolean }) => { rememberLabel(stock.w, stock.h, v); setTick((n) => n + 1); };
  /** Choosing a printer profile loads what is saved on it: its label stock and its turn. */
  const choosePrinter = (p: PrinterRow) => {
    setPrinterId(p.id); setDevice({ printerId: p.id });
    const st = stocks.find((x) => x.id === p.settings.stockId);
    const g = st?.geometry ?? stock;
    if (st) { setStockId(st.id); setGeom(st.geometry); setDevice({ stockId: st.id }); setView(0); setChunk(0); }
    if (p.settings.turn != null && g.sheet === 'roll') { rememberLabel(g.w, g.h, { turn: p.settings.turn, ok: labelMemory(g.w, g.h)?.ok }); setTick((n) => n + 1); }
  };

  /* ---------- Lines ---------- */
  const [lines, setLines] = useState<Line[]>([]);
  const [source, setSource] = useState<{ type: Src | 'reprint'; id: string | null; label: string }>({ type: 'items', id: null, label: 'Items list' });
  const [loaded, setLoaded] = useState(false);
  const mkLine = (it: Item, qty: number, extra: Partial<Line> = {}): Line => ({ key: newKey(), itemId: it.id, batch: '', expiry: '', location: '', qty: clamp(qty), onHand: Math.max(0, Math.floor(it.stock)), ...extra });
  // Start: ?source=bill|purchase_order&id=…, ?ids=…&qty=…, ?per=stock, or a job to reprint / resume.
  useEffect(() => {
    if (loaded || !items.length || !geom) return;
    setLoaded(true);
    const src = params.get('source'); const sid = params.get('id');
    if ((src === 'bill' || src === 'purchase_order') && sid) { void loadDoc(src, sid); return; }
    const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
    const qty = (params.get('qty') ?? '').split(',').map((n) => clamp(Number(n)));
    const perStock = params.get('per') === 'stock';
    setLines(ids.flatMap((id, i) => { const it = byId.get(id); return it ? [mkLine(it, qty[i] || (perStock ? Math.max(1, Math.floor(it.stock)) : stock.across))] : []; }));
  }, [items, geom]);
  useEffect(() => {
    if (!reprintOf?.lines) return;
    setLines(reprintOf.lines.filter((l) => l.itemId && byId.has(l.itemId)).map((l) => mkLine(byId.get(l.itemId!)!, l.qty, { batch: l.batch, expiry: l.data.expiry, location: l.data.location })));
    setSource({ type: 'reprint', id: reprintOf.id, label: `Reprint of ${reprintOf.source.label || 'job'}` });
    if (reprintOf.stock) { setGeom(reprintOf.stock); setStockId(stocks.find((s) => sameGeom(s.geometry, reprintOf.stock))?.id ?? ''); }
    if (reprintOf.templateId) setTemplateId(reprintOf.templateId);
    setFrom(Number(reprintOf.options?.from) > 1 ? Number(reprintOf.options.from) : 1);
  }, [reprintOf?.id]);
  async function loadDoc(type: 'bill' | 'purchase_order', id: string) {
    try {
      const r = await api.get<{ source: { type: string; id: string; label: string }; lines: Array<{ itemId: string; qty: number; ordered: number; received: number; printed: number }> }>(`/shop/label/sources/${type}/${id}`);
      setLines(r.lines.flatMap((l) => { const it = byId.get(l.itemId); return it ? [mkLine(it, l.qty, { ordered: l.ordered, received: l.received, printed: l.printed })] : []; }));
      setSource({ type, id, label: r.source.label });
      const already = r.lines.reduce((s, l) => s + l.printed, 0);
      if (already) toast('info', `${already} labels were already printed for ${r.source.label}`, type === 'purchase_order' ? 'Quantities show what is not labelled yet.' : 'Check the quantities before printing again.');
    } catch (e) { toast('error', 'Could not open it', (e as Error).message); }
  }
  const setQty = (key: string, q: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: clamp(q) } : l)));
  const add = (it: Item, qty = stock.across, extra: Partial<Line> = {}) => setLines((ls) => [...ls, mkLine(it, qty, extra)]);
  const [packFactor, setPackFactor] = useState(1);
  const [opts, setOpts] = useState<ImposeOptions>({ ...DEFAULT_IMPOSE });
  const [from, setFrom] = useState(1);

  /* ---------- Job lines for the engine ---------- */
  const jobLines: JobLine[] = useMemo(() => lines.map((l) => {
    const it = byId.get(l.itemId)!;
    return { key: l.key, itemId: l.itemId, batch: l.batch, qty: l.qty, expiry: l.expiry, location: l.location || it?.category || '', data: it ? labelDataFor(it, company, { batch: l.batch, expiry: l.expiry, location: l.location }) : labelDataFor({ name: '?', sku: '', barcode: '', sp1: 0, mrp: null, unit: '', brand: '', category: '' }, company) };
  }), [lines, byId, company]);
  const issues: Issue[] = useMemo(() => validateJob(jobLines, tpl, stock, printer), [jobLines, tpl, stock, printer]);
  const blocked = blockedLines(issues);
  const printable = jobLines.map((l, i) => (blocked.has(i) ? { ...l, qty: 0 } : l));
  const imp = useMemo(() => impose(printable, stock, { ...opts, packFactor, from }), [printable, stock, opts, packFactor, from]);
  const metrics = jobMetrics(imp, stock, printer);
  const pages = stock.sheet === 'roll' ? imp.rows.map((r) => [r]) : imp.pages;

  /* ---------- Preview paging (TP-17, TP-18: only visible rows render) ---------- */
  const [view, setView] = useState(0);
  const perView = stock.sheet === 'roll' ? ROWS_PER_SCREEN : 1;
  const viewCount = Math.max(1, Math.ceil(pages.length / perView));
  const vi = Math.min(view, viewCount - 1);
  const shownPages = pages.slice(vi * perView, vi * perView + perView);
  const [overlay, setOverlay] = useState(false);
  const [mono, setMono] = useState(false);
  const jumpToLine = (li: number) => { const r = pages.findIndex((pg) => pg.some((row) => row.some((s) => s?.line === li))); if (r >= 0) setView(Math.floor(r / perView)); };

  /* ---------- Printing ---------- */
  const [printRange, setPrintRange] = useState<{ from: number; to: number } | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const idem = useRef(newKey());
  useEffect(() => { idem.current = newKey(); setJob(null); }, [lines, stockId, templateId, packFactor, opts]);
  const [check, setCheck] = useState<'' | 'ask' | 'turned' | 'driver' | 'thanks'>('');
  const [confirm, setConfirm] = useState<null | { sent: number; total: number }>(null);
  const [stopAt, setStopAt] = useState('');
  const totalRows = pages.length;
  const chunks = metrics.labels > IMMEDIATE_LABELS ? Math.ceil(totalRows / CHUNK_ROWS) : 1;
  const [chunk, setChunk] = useState(0);

  const doPrint = (range: { from: number; to: number }, after?: () => void) => {
    setPrintRange(range);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (conn && stock.sheet === 'roll') {
        setSending(true);
        printRowsDirect(document.querySelector('.lb-print') ?? document, stock, printer, conn, turn)
          .then((n) => { toast('success', `${n} row${n === 1 ? '' : 's'} sent to ${conn.kind === 'bt' ? conn.name : conn.kind === 'pc' ? conn.printer : conn.host}`); after?.(); })
          .catch((e) => toast('error', 'Printer', (e as Error).message))
          .finally(() => { setPrintRange(null); setSending(false); });
        return;
      }
      printWithPage(pageCss(stock, turn, printer.pageSize), 'print-labels');
      setPrintRange(null);
      after?.();
    }));
  };
  // The "how did it come out?" check is for the print screen; a printer told the exact size needs none.
  const askCheck = () => { if (stock.sheet === 'roll' && !conn && !labelMemory(stock.w, stock.h)?.ok) setTimeout(() => setCheck('ask'), 1200); };
  const testPrint = () => doPrint({ from: 0, to: 1 }, askCheck);
  const ensureJob = async (): Promise<JobRow | null> => {
    if (job) return job;
    const out = lines.filter((_, i) => !blocked.has(i) && lines[i]!.qty > 0);
    try {
      const j = await api.post<JobRow>('/shop/label/jobs', {
        idemKey: idem.current, source: { type: source.type, id: source.id, label: source.label }, templateId: chosenTpl?.id ?? null, template: tpl,
        stock, printerId: printerRow.preset ? null : printerRow.id, printer, options: { ...opts, packFactor, from, stockName: stocks.find((s) => s.id === stockId)?.name ?? 'Custom' },
        lines: out.map((l) => ({ itemId: l.itemId, batch: l.batch, qty: l.qty * Math.max(1, packFactor), expiry: l.expiry || undefined, location: l.location || undefined })),
      });
      setJob(j); qc.invalidateQueries({ queryKey: LABEL_KEYS.jobs });
      return j;
    } catch (e) { toast('error', 'Could not start the print job', (e as Error).message); return null; }
  };
  const print = async () => {
    if (metrics.labels > JOB_CONFIRM_ABOVE && !window.confirm(`Print ${metrics.labels.toLocaleString('en-IN')} labels (${metrics.rows} rows, about ${(metrics.rollMm / 1000).toFixed(1)} m of roll)?`)) return;
    const j = await ensureJob(); if (!j) return;
    const c = Math.min(chunk, chunks - 1);
    const range = { from: c * CHUNK_ROWS, to: chunks > 1 ? Math.min(totalRows, (c + 1) * CHUNK_ROWS) : totalRows };
    const sentLabels = pages.slice(0, range.to).flat(2).filter(Boolean).length + (from - 1);
    doPrint(range, () => {
      void api.post<JobRow>(`/shop/label/jobs/${j.id}/progress`, { sent: sentLabels, status: 'sent' }).then((u) => { setJob(u); qc.invalidateQueries({ queryKey: LABEL_KEYS.jobs }); }).catch(() => undefined);
      if (c + 1 < chunks) setChunk(c + 1);
      else setConfirm({ sent: sentLabels, total: j.total });
      askCheck();
    });
  };
  const markPrinted = async (printed: number) => {
    if (!job) return;
    const u = await api.post<JobRow>(`/shop/label/jobs/${job.id}/progress`, { printed }).catch(() => null);
    if (u) { setJob(u); qc.invalidateQueries({ queryKey: LABEL_KEYS.jobs }); }
    setConfirm(null);
    if (printed < job.total) { setFrom(printed + 1); setChunk(0); toast('info', `Ready to resume from label ${printed + 1}`, 'Fix the printer, then press Print labels.'); }
    else { setFrom(1); toast('success', `${job.total} labels printed`); }
  };
  const answer = (how: 'right' | 'sideways' | 'upside' | 'small') => {
    if (how === 'right') { rememberTurn({ turn, ok: true }); setCheck('thanks'); setTimeout(() => setCheck(''), 2000); return; }
    if (how === 'small') { setCheck('driver'); return; }
    rememberTurn({ turn: nextTurn(turn, how) }); setCheck('turned');
  };
  const saveDefault = useMut((b: PrintSettings) => api.put<PrintSettings>('/shop/print-settings', b), [['printSettings']], { success: 'Saved as this shop’s default label stock' });

  /* ---------- Adding lines ---------- */
  const [srcTab, setSrcTab] = useState<Src>('items');
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [brand, setBrand] = useState(''); const [stockF, setStockF] = useState(''); const [codeF, setCodeF] = useState('');
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const brands = useMemo(() => [...new Set(items.map((i) => i.brand).filter(Boolean))].sort(), [items]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => i.type === 'Goods' && (!cat || i.category === cat) && (!brand || i.brand === brand)
      && (!stockF || (stockF === 'in' ? i.stock > 0 : stockF === 'low' ? i.stock > 0 && i.stock <= (i.reorderLevel ?? 0) : i.stock <= 0))
      && (!codeF || (codeF === 'has' ? !!i.barcode : !i.barcode))
      && (!t || i.name.toLowerCase().includes(t) || i.sku.toLowerCase().includes(t) || (i.barcode ?? '').includes(t)));
  }, [items, q, cat, brand, stockF, codeF]);
  const inList = new Set(lines.map((l) => l.itemId));
  const [batches, setBatches] = useState<Array<{ itemId: string; name: string; batch: string; expiry: string; qty: number; location: string }> | null>(null);
  const [expBefore, setExpBefore] = useState('');
  useEffect(() => { if (srcTab === 'batches' && !batches) void api.get<typeof batches>('/shop/label/batches').then(setBatches).catch(() => setBatches([])); }, [srcTab]);
  const [csv, setCsv] = useState('');
  const importCsv = (text: string) => {
    const rows = parseCsv(text); const bad: string[] = []; const add: Line[] = [];
    for (const r of rows) {
      const code = r.sku || r.barcode || r.SKU || r.Barcode || Object.values(r)[0] || '';
      const it = findByCode(items, code) ?? items.find((i) => i.sku.toLowerCase() === code.toLowerCase());
      if (!it) { bad.push(code); continue; }
      add.push(mkLine(it, Number(r.quantity ?? r.qty ?? r.Quantity ?? Object.values(r)[1] ?? 1) || 1, { batch: r.batch ?? r.Batch ?? '' }));
    }
    setLines((ls) => [...ls, ...add]); setSource({ type: 'csv', id: null, label: 'CSV import' });
    toast(bad.length ? 'info' : 'success', `${add.length} lines added`, bad.length ? `Not found: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}` : undefined);
  };
  const scanRef = useRef<HTMLInputElement>(null);
  const onScan = (code: string) => {
    const it = findByCode(items, code);
    if (!it) { toast('error', `${code} is not in your items`); return; }
    setSource((s) => (s.type === 'items' && !lines.length ? { type: 'scan', id: null, label: 'Scanned' } : s));
    setLines((ls) => { const i = ls.findIndex((l) => l.itemId === it.id && !l.batch); if (i < 0) return [...ls, mkLine(it, 1)]; const c = [...ls]; c[i] = { ...c[i]!, qty: clamp(c[i]!.qty + 1) }; return c; });
  };

  /* ---------- "As the printer sees it": the very dots the printer gets (not a screen filter) ---------- */
  const [monoImgs, setMonoImgs] = useState<Record<string, string>>({});
  // (The automatic layout gets new element ids on every render, so ids are left out of the signature.)
  const monoSig = mono && stock.sheet === 'roll' ? JSON.stringify([vi, stock, printer.dpi, tpl, shownPages, printable.map((l) => [l.itemId, l.data])], (k, v) => (k === 'id' ? undefined : v)) : '';
  useEffect(() => {
    setMonoImgs({});
    if (!monoSig) return;
    let dead = false;
    const t = setTimeout(async () => {
      const els = [...document.querySelectorAll<HTMLElement>('.ls-sheets [data-row-key] .label-row')];
      const out: Record<string, string> = {};
      for (const el of els) {
        if (dead) return;
        try {
          const b = await rowBitmap(el, stock, printer.dpi);
          const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
          const ctx = c.getContext('2d')!; const img = ctx.createImageData(b.width, b.height); const bpr = Math.ceil(b.width / 8);
          for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
            const v = b.mono[y * bpr + (x >> 3)]! & (0x80 >> (x & 7)) ? 0 : 255; const o = (y * b.width + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
          out[el.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey!] = c.toDataURL();
        } catch { /* keep the normal preview for this row */ }
      }
      if (!dead) setMonoImgs(out);
    }, 150);
    return () => { dead = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monoSig]);

  /* ---------- Render ---------- */
  const rangeRows = printRange ? pages.slice(printRange.from, printRange.to) : [];
  const renderPage = (pg: (typeof pages)[number], key: string | number, forPrint: boolean) => stock.sheet === 'roll' ? (
    (() => {
      const row = pg[0]!;
      const r = (
        <div className="label-row" style={{ width: `${rowWidthMm(stock)}mm`, height: `${stock.h}mm`, paddingLeft: `${stock.marginL}mm`, paddingRight: `${stock.marginR}mm`, gap: `${stock.gutter}mm` }}>
          {row.map((s, j) => <div key={j} className={`lb-slot ${s ? '' : 'empty'}`} style={{ width: `${stock.w}mm`, height: `${stock.h}mm` }}>{s && <LabelView tpl={tpl} data={printable[s.line]!.data} dpi={printer.dpi} />}</div>)}
        </div>
      );
      const t = forPrint && conn && stock.sheet === 'roll' ? 0 : turn;
      const dots = !forPrint && mono ? monoImgs[String(key)] : undefined;
      const pic = dots ? <img className="lb-mono-img" src={dots} alt="" style={{ width: `${rowWidthMm(stock)}mm`, height: `${stock.h}mm` }} /> : null;
      const rk = forPrint ? undefined : String(key);
      return t ? <div key={key} data-row-key={rk} className={`label-turn turn-${t}`} style={{ '--rw': `${rowWidthMm(stock)}mm`, '--rh': `${stock.h}mm` } as React.CSSProperties}>{r}{pic}</div>
        : <div key={key} data-row-key={rk} className={`label-page ${!forPrint && overlay ? 'lb-overlay' : ''}`} style={!forPrint && overlay ? { '--head': `${printer.headMm}mm` } as React.CSSProperties : undefined}>{r}{pic}</div>;
    })()
  ) : (
    <div key={key} className="label-a4" style={{ width: `${SHEET_MM[stock.sheet].w}mm`, height: `${SHEET_MM[stock.sheet].h}mm`, padding: `${stock.marginTop}mm ${stock.marginR}mm 0 ${stock.marginL}mm`, gridTemplateColumns: `repeat(${stock.across}, ${stock.w}mm)`, gridAutoRows: `${stock.h}mm`, columnGap: `${stock.gutter}mm`, rowGap: `${stock.rowGap}mm` }}>
      {pg.flat().map((s, j) => <div key={j} className={`lb-slot ${s ? '' : 'empty'}`}>{s && <LabelView tpl={tpl} data={printable[s.line]!.data} dpi={printer.dpi} />}</div>)}
    </div>
  );
  const jobIssues = issues.filter((x) => x.scope === 'job');
  const lineIssue = (i: number) => issues.find((x) => x.line === i && x.severity === 'blocker') ?? issues.find((x) => x.line === i);
  const noBarcode = lines.filter((_, i) => issues.some((x) => x.line === i && x.code === 'no-barcode'));
  // Codes too long for the label (e.g. T488805-0001 needs 41 mm; a 38 mm label has 36): a short in-store barcode fits,
  // and the old code stays on the item as an alias, so labels already on the shelf keep scanning at the counter.
  const tooLong = lines.filter((_, i) => issues.some((x) => x.line === i && x.code === 'no-fit'));
  const genShort = async () => {
    const n = tooLong.length;
    if (!window.confirm(`Give ${n} item${n === 1 ? '' : 's'} a new short barcode that fits these labels?\n\nThe current code${n === 1 ? '' : 's'} keep${n === 1 ? 's' : ''} scanning at the counter, so labels already printed still work.`)) return;
    try {
      const r = await api.post<{ generated: number }>('/shop/label/barcodes/bulk-generate', { ids: tooLong.map((l) => l.itemId), overwrite: true });
      await qc.invalidateQueries({ queryKey: ['items'] });
      toast('success', `${r.generated} item${r.generated === 1 ? '' : 's'} now ha${r.generated === 1 ? 's' : 've'} a short barcode`, 'The old codes still scan at the counter.');
    } catch (e) { toast('error', 'Could not make short barcodes', (e as Error).message); }
  };
  const genMissing = async () => {
    try { await api.post('/shop/label/barcodes/bulk-generate', { ids: noBarcode.map((l) => l.itemId) }); await qc.invalidateQueries({ queryKey: ['items'] }); toast('success', 'Barcodes made for the items without one'); } catch (e) { toast('error', 'Could not make barcodes', (e as Error).message); }
  };

  // Why Print is greyed out, in plain words, with the one tap that fixes it.
  const focusItems = () => { setSrcTab('items'); setTimeout(() => { const el = document.querySelector<HTMLInputElement>('.ls-pick input'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus(); }, 0); };
  const fitPrinter = printers.find((p) => p.preset && p.settings.language !== 'browser' && p.settings.headMm >= rowWidthMm(stock) - 2);
  const jobBlocker = issues.find((x) => x.scope === 'job' && x.severity === 'blocker');
  // Straight to the printer with a quarter turn: the label's height goes across the printer's head.
  const turnTooWide = !!conn && stock.sheet === 'roll' && (turn === 90 || turn === 270) && stock.h > printer.headMm + 0.5;
  const why: null | { msg: string; fix?: { label: string; run: () => void } } = sending ? null
    : !lines.length ? { msg: 'Nothing to print yet. Tap the items you want labels for.', fix: { label: 'Choose items', run: focusItems } }
    : lines.every((l) => l.qty <= 0) ? { msg: 'Every item is set to 0 labels.', fix: { label: 'Print 1 label each', run: () => setLines((ls) => ls.map((l) => ({ ...l, qty: 1 }))) } }
    : turnTooWide ? { msg: `Turned ${turn}°, these ${stock.w} × ${stock.h} mm labels would be ${stock.h} mm across the printer, wider than it prints (${printer.headMm} mm).`, fix: { label: 'Use “As shown”', run: () => rememberTurn({ turn: 0, ok: mem?.ok }) } }
    : jobBlocker ? {
      msg: jobBlocker.message,
      fix: jobBlocker.code === 'head' && fitPrinter ? { label: `Use the ${fitPrinter.name.split(' · ')[0]}`, run: () => { setPrinterId(fitPrinter.id); setDevice({ printerId: fitPrinter.id }); } }
        : jobBlocker.code === 'size' ? { label: 'Use the automatic layout', run: () => { setTemplateId(''); setDevice({ templateId: '' }); } } : undefined,
    }
    : !metrics.labels && tooLong.length && me.can('items.write')
      ? { msg: `The barcode is too long for ${stock.w} mm labels.`, fix: { label: tooLong.length === 1 ? 'Give it a short barcode that fits' : `Give ${tooLong.length} items short barcodes that fit`, run: () => void genShort() } }
    : !metrics.labels ? (noBarcode.length && me.can('items.write')
      ? { msg: `${noBarcode.length === lines.length ? 'These items have' : 'Some items have'} no barcode, so there is nothing to print.`, fix: { label: 'Make barcodes for them', run: () => void genMissing() } }
      : { msg: `Can’t print: ${(issues.find((x) => x.scope === 'line' && x.severity === 'blocker')?.message ?? 'see the red note under each item.').replace(/^[^:]+: /, '')}` })
    : null;
  const [more, setMore] = useState(false);

  return (
    <div className="lb-grid">
      {/* ---------- Lines ---------- */}
      <section className="card ls-panel no-print" aria-label="Job lines">
        <div className="row between"><h3>1 · Choose items</h3>{source.label && lines.length > 0 && <span className="small muted">{source.label}</span>}</div>
        {lines.length > 0 && <>
          <div className="lb-bulk" style={{ marginTop: 4 }} aria-label="Quantity for every line">
            <span className="small muted">All lines:</span>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => { const n = Number(window.prompt('Set every line to how many labels?', '1')); if (n >= 0) setLines((ls) => ls.map((l) => ({ ...l, qty: clamp(n) }))); }}>Set to N</button>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => { const n = Number(window.prompt('Multiply every line by?', '2')); if (n > 0) setLines((ls) => ls.map((l) => ({ ...l, qty: clamp(l.qty * n) }))); }}>× N</button>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, qty: clamp(l.onHand) })))} title="Negative stock counts as 0">One per piece in stock</button>
            {lines.some((l) => l.received != null) && <button type="button" className="btn btn-soft btn-sm" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, qty: clamp(l.received ?? l.qty) })))}>Use received</button>}
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, qty: stock.across })))}>One row each</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLines([]); setSource({ type: 'items', id: null, label: 'Items list' }); setFrom(1); }}><Trash2 size={13} /> Clear</button>
          </div>
          <ul className="ls-chosen lb-lines">
            {lines.map((l, i) => {
              const it = byId.get(l.itemId); const iss = lineIssue(i);
              return (
                <li key={l.key} className={iss?.severity === 'blocker' ? 'bad' : iss ? 'warn' : ''}>
                  <div className="ls-chosen-name">
                    <button type="button" className="lb-linkname strong" onClick={() => jumpToLine(i)} title="Show in preview">{it?.name ?? 'Unknown item'}</button>
                    <span className="small muted mono">{it?.barcode || it?.sku || 'no code'}{l.batch ? ` · batch ${l.batch}` : ''}{l.expiry ? ` · exp ${l.expiry}` : ''}</span>
                    {(l.ordered != null || l.printed) ? <span className="small muted">{l.ordered != null ? `ordered ${l.ordered} · received ${l.received ?? 0}` : ''}{l.printed ? ` · ${l.printed} printed before` : ''}</span> : null}
                    {issues.filter((x) => x.line === i).sort((a, b) => (a.severity === 'blocker' ? -1 : 0) - (b.severity === 'blocker' ? -1 : 0)).map((x) => (
                      <span key={x.code} className={`small ${x.severity === 'blocker' ? 'ls-err' : 'lb-warn'}`}><AlertTriangle size={12} /> {x.message.replace(`${it?.name}: `, '')}{x.severity === 'blocker' ? ' (not printed)' : ''}</span>
                    ))}
                  </div>
                  <div className="ls-step" aria-label={`Labels for ${it?.name}`}>
                    <button type="button" onClick={() => setQty(l.key, l.qty - 1)} disabled={l.qty <= 0} aria-label="One less"><Minus size={13} /></button>
                    <input type="number" min={0} max={JOB_MAX} value={l.qty} onChange={(e) => setQty(l.key, Number(e.target.value))} aria-label={`Copies of ${it?.name}`} />
                    <button type="button" onClick={() => setQty(l.key, l.qty + 1)} aria-label="One more"><Plus size={13} /></button>
                  </div>
                  <button type="button" className="icon-btn sm" aria-label={`Remove ${it?.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={14} /></button>
                </li>
              );
            })}
          </ul>
          {tooLong.length > 0 && me.can('items.write') && <button type="button" className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={() => void genShort()}>Give {tooLong.length === 1 ? 'it' : `${tooLong.length} items`} a short barcode that fits</button>}
          {noBarcode.length > 0 && me.can('items.write') && <button type="button" className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={() => void genMissing()}>Make barcodes for {noBarcode.length} item{noBarcode.length === 1 ? '' : 's'} without one</button>}
        </>}
        {!lines.length && <p className="small ls-start">Tap an item below to add it. Each tap adds one row of labels; change the number later.</p>}
        <div className="small muted" style={{ margin: '12px 0 6px' }}>{lines.length ? 'Add more from' : 'Add from'}</div>
        <div className="lb-src" role="tablist" aria-label="Add lines from">
          {([['items', 'Items'], ...(canPurch ? [['purchase_order', 'Purchase order'], ['bill', 'Bill']] : []), ['batches', 'Batches'], ['csv', 'CSV'], ['scan', 'Scan']] as Array<[Src, string]>).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={srcTab === k} className={srcTab === k ? 'on' : ''} onClick={() => { setSrcTab(k); if (k === 'scan') setTimeout(() => scanRef.current?.focus(), 0); }}>{l}</button>
          ))}
        </div>
        {srcTab === 'items' && (
          <div className="ls-pick">
            <SearchInput value={q} onChange={setQ} placeholder="Find items by name, SKU or barcode" />
            <div className="lb-filters">
              {cats.length > 1 && <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>}
              {brands.length > 1 && <select className="select" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand"><option value="">All brands</option>{brands.map((c) => <option key={c}>{c}</option>)}</select>}
              <select className="select" value={stockF} onChange={(e) => setStockF(e.target.value)} aria-label="Stock"><option value="">Any stock</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
              <select className="select" value={codeF} onChange={(e) => setCodeF(e.target.value)} aria-label="Barcode"><option value="">Any barcode</option><option value="has">Has barcode</option><option value="none">No barcode</option></select>
            </div>
            <ul className="ls-results" aria-label="Items">
              {matches.slice(0, 80).map((it) => (
                <li key={it.id}><button type="button" className={inList.has(it.id) ? 'on' : ''} onClick={() => (inList.has(it.id) ? setLines((ls) => ls.filter((l) => l.itemId !== it.id)) : add(it))} aria-pressed={inList.has(it.id)}>
                  <span className="ls-tick">{inList.has(it.id) ? <Check size={13} /> : <Plus size={13} />}</span>
                  <span className="ls-res-name">{it.name}<span className="small muted"> · {it.barcode || it.sku || 'no barcode'} · {it.stock} in stock</span></span>
                </button></li>
              ))}
              {!matches.length && <li className="small muted" style={{ padding: 8 }}>No goods match.</li>}
            </ul>
            {matches.length > 1 && <button type="button" className="btn btn-soft btn-sm" onClick={() => setLines((ls) => [...ls, ...matches.slice(0, 1000).filter((m) => !inList.has(m.id)).map((m) => mkLine(m, 1))])}>Add all {Math.min(1000, matches.length)} shown</button>}
          </div>
        )}
        {(srcTab === 'purchase_order' || srcTab === 'bill') && (
          <ul className="ls-results" aria-label={srcTab === 'bill' ? 'Bills' : 'Purchase orders'}>
            {((srcTab === 'bill' ? bills.data : pos.data) ?? []).filter((d: Bill | PurchaseOrder) => d.lines.some((l) => l.itemId)).slice(0, 60).map((d: Bill | PurchaseOrder) => (
              <li key={d.id}><button type="button" onClick={() => void loadDoc(srcTab, d.id)}>
                <span className="ls-tick"><FileUp size={13} /></span>
                <span className="ls-res-name">{d.number} · {d.vendorName}<span className="small muted"> · {d.date} · {d.lines.length} lines</span></span>
              </button></li>
            ))}
          </ul>
        )}
        {srcTab === 'batches' && (
          <div className="ls-pick">
            <label className="small row" style={{ gap: 6 }}>Expiring by <input type="date" className="input" value={expBefore} onChange={(e) => setExpBefore(e.target.value)} style={{ width: 'auto' }} /></label>
            <ul className="ls-results" aria-label="Batches">
              {(batches ?? []).filter((b) => !expBefore || (b.expiry && b.expiry <= expBefore)).slice(0, 100).map((b) => (
                <li key={`${b.itemId}|${b.batch}`}><button type="button" onClick={() => { const it = byId.get(b.itemId); if (it) { add(it, b.qty, { batch: b.batch, expiry: b.expiry, location: b.location }); setSource({ type: 'batches', id: null, label: 'Batches' }); } }}>
                  <span className="ls-tick"><Plus size={13} /></span>
                  <span className="ls-res-name">{b.name} · batch {b.batch}<span className="small muted"> · {b.qty} on hand{b.expiry ? ` · exp ${b.expiry}` : ''}</span></span>
                </button></li>
              ))}
              {batches && !batches.length && <li className="small muted" style={{ padding: 8 }}>No batches in stock.</li>}
            </ul>
          </div>
        )}
        {srcTab === 'csv' && (
          <div className="ls-pick">
            <p className="small muted">Columns: <span className="mono">sku</span> or <span className="mono">barcode</span>, <span className="mono">quantity</span>, and optionally <span className="mono">batch</span>.</p>
            <textarea className="input mono" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'sku,quantity\nLOG-M331,10'} aria-label="CSV" />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-soft btn-sm" disabled={!csv.trim()} onClick={() => { importCsv(csv); setCsv(''); }}>Add lines</button>
              <label className="btn btn-ghost btn-sm"><FileUp size={13} /> Choose file<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importCsv(await f.text()); e.target.value = ''; }} /></label>
            </div>
          </div>
        )}
        {srcTab === 'scan' && (
          <div className="ls-pick">
            <input ref={scanRef} className="input mono" placeholder="Scan a barcode: +1 label each scan" aria-label="Scan into the job"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.currentTarget.value.trim(); if (v) onScan(v); e.currentTarget.value = ''; } }} />
            <p className="small muted"><ScanBarcode size={13} style={{ verticalAlign: -2 }} /> Each scan adds one label for that item.</p>
          </div>
        )}

      </section>

      {/* ---------- Preview ---------- */}
      <section className="ls-stage" aria-label="Label preview">
        {!lines.length ? (
          <div className="card ls-home no-print">
            <ScanBarcode size={34} />
            <h2>Print barcode labels in three steps</h2>
            <ol>
              <li><strong>Choose what to print</strong> on the left: items, a purchase order or bill (quantities come from what arrived), batches, a CSV file, or scan boxes.</li>
              <li><strong>Choose the label stock and printer</strong> on the right: a 2, 3 or 4 inch roll with 1 to 4 across, or an A4 / Letter sheet.</li>
              <li><strong>Test print</strong> one row, then <strong>Print labels</strong>. Every job is kept in History, to resume after a paper jam or reprint later.</li>
            </ol>
            <p className="small muted">Item names print in any language; the barcode itself holds English letters, digits and - . / only (use QR for anything else). Manage barcodes in the <button type="button" className="lb-linkname" onClick={() => onOpenTab('barcodes')}>Barcodes</button> tab.</p>
          </div>
        ) : (
          <>
            <div className="ls-summary no-print" aria-live="polite">
              <span><strong>{metrics.labels.toLocaleString('en-IN')}</strong> label{metrics.labels === 1 ? '' : 's'}</span>
              <span>{stock.sheet === 'roll' ? `${metrics.rows} rows · ${(metrics.rollMm / 1000).toFixed(metrics.rollMm < 1000 ? 2 : 1)} m of roll` : `${metrics.sheets} sheet${metrics.sheets === 1 ? '' : 's'}`}</span>
              <span>about {metrics.seconds < 90 ? `${metrics.seconds} s` : `${Math.ceil(metrics.seconds / 60)} min`}</span>
              {metrics.blanks > 0 && <span>{metrics.blanks} blank label{metrics.blanks === 1 ? '' : 's'}</span>}
              {from > 1 && <span className="lb-warn">Resuming from label {from}</span>}
              <span>Page: <strong className="mono">{stock.sheet === 'roll' ? (sideways(turn) ? `${stock.h} × ${rowWidthMm(stock)}` : `${rowWidthMm(stock)} × ${stock.h}`) : `${SHEET_MM[stock.sheet].w} × ${SHEET_MM[stock.sheet].h}`} mm</strong>{turn ? ` (turned ${turn}°)` : ''}</span>
            </div>
            {stock.sheet === 'roll' && !conn && lines.length > 0 && (<>
              {!isNativeApp() && <LabelPaperSteps testId="paper-hint" w={sideways(turn) ? stock.h : rowWidthMm(stock)} h={sideways(turn) ? rowWidthMm(stock) : stock.h} gap={stock.rowGap}
                folded={!!mem?.ok} />}
              {directSupported() && <p className="small muted no-print">Or choose Bluetooth / Wi-Fi under “Send labels” to print straight to the printer, with no paper size to set.</p>}
            </>)}
            {jobIssues.length > 0 && <div className="ls-warn no-print" role="alert">{jobIssues.map((x) => <div key={x.code}><AlertTriangle size={13} /> {x.message}</div>)}</div>}
            {blocked.size > 0 && metrics.labels > 0 && <div className="ls-warn no-print"><AlertTriangle size={13} /> {blocked.size} item{blocked.size === 1 ? '' : 's'} can’t print (see the red note under {blocked.size === 1 ? 'it' : 'each'}); the others print.</div>}
            {check && (
              <CheckCard inline title={check === 'thanks' ? 'Label printer is set up' : 'Quick check, only once for this label size'} onClose={() => setCheck('')}>
                {check === 'ask' && <><p className="small" style={{ margin: '6px 0 10px' }}>How did the labels come out of the printer?</p>
                  <div className="pc-choices">
                    <Choice icon={TurnIcons.right} label="Right way up" hint="Text reads along the label" onClick={() => answer('right')} />
                    <Choice icon={TurnIcons.sideways} label="Sideways" hint="Text runs across, or is cut off" onClick={() => answer('sideways')} />
                    <Choice icon={<RotateCw size={18} style={{ transform: 'rotate(180deg)' }} />} label="Upside down" onClick={() => answer('upside')} />
                    <Choice icon={<AlertTriangle size={18} />} label="Too small, or spread over two labels" onClick={() => answer('small')} />
                  </div></>}
                {check === 'turned' && <><p className="small" style={{ margin: '6px 0 10px' }}>Turned for this printer. Print one row to check; it uses one label.</p>
                  <button type="button" className="btn btn-primary btn-block" onClick={() => { setCheck(''); testPrint(); }}><Printer size={15} /> Test print one row</button></>}
                {check === 'driver' && <DriverSteps paper={`a label of ${sideways(turn) ? stock.h : rowWidthMm(stock)} × ${sideways(turn) ? rowWidthMm(stock) : stock.h} mm (Page Setup → Stock → New, “Labels with gaps”)`}>
                  <button type="button" className="btn btn-primary" onClick={() => { setCheck(''); testPrint(); }}><Printer size={15} /> Done, test print one row</button>
                </DriverSteps>}
                {check === 'thanks' && <p className="small" style={{ margin: '6px 0 0' }}>Thanks. This computer won’t ask again for {stock.w} × {stock.h} mm labels.</p>}
              </CheckCard>
            )}
            {confirm && job && (
              <div className="print-check inline no-print" role="region" aria-label="Did every label print?">
                <strong className="row" style={{ gap: 6 }}><Printer size={16} /> {confirm.sent} of {confirm.total} labels sent to the printer. Did they all print?</strong>
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void markPrinted(job.total)}><Check size={14} /> All printed</button>
                  <span className="small muted">Paper ran out or jammed? Last good label:</span>
                  <input className="input" style={{ width: 90 }} inputMode="numeric" value={stopAt} onChange={(e) => setStopAt(e.target.value.replace(/\D/g, ''))} aria-label="Last label that printed" placeholder="e.g. 250" />
                  <button type="button" className="btn btn-soft btn-sm" disabled={!stopAt} onClick={() => { void markPrinted(Math.min(job.total, Number(stopAt))); setStopAt(''); }}>Resume after it</button>
                </div>
              </div>
            )}
            <div className="lb-tools no-print">
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Show the printer’s edges</label>
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={mono} onChange={(e) => setMono(e.target.checked)} /> As the printer sees it (1-bit)</label>
              {viewCount > 1 && <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                <button type="button" className="icon-btn sm" aria-label="Previous rows" disabled={vi === 0} onClick={() => setView(vi - 1)}><ChevronLeft size={15} /></button>
                <span className="small">{stock.sheet === 'roll' ? `Rows ${vi * perView + 1}–${Math.min(pages.length, (vi + 1) * perView)} of ${pages.length}` : `Sheet ${vi + 1} of ${pages.length}`}</span>
                <button type="button" className="icon-btn sm" aria-label="Next rows" disabled={vi >= viewCount - 1} onClick={() => setView(vi + 1)}><ChevronRight size={15} /></button>
              </span>}
            </div>
          </>
        )}
        <div className={`ls-sheets ls-${stock.sheet === 'roll' ? 'roll' : 'a4'} no-print ${mono ? 'lb-mono' : ''}`} aria-label="Preview">
          {lines.length > 0 && stock.sheet === 'roll' && overlay && <div className="lb-feed small muted" aria-hidden="true"><ArrowDown size={13} /> paper feeds this way · exits at the bottom</div>}
          {shownPages.map((pg, i) => renderPage(pg, `v${vi}-${i}`, false))}
        </div>
        {/* What goes to the printer: only the rows being printed (never the whole 10,000 at once). */}
        <div className="print-area lb-print" aria-hidden="true">{rangeRows.map((pg, i) => renderPage(pg, `p${i}`, true))}</div>
      </section>

      {/* ---------- Stock, printer, template ---------- */}
      <section className="card ls-panel no-print" aria-label="Label stock and printer">
        <h3>2 · Print</h3>
        {/* The labels on the roll decide everything: printing 50 × 25 on a roll of 100 × 100 labels puts one small label on
            each big one. Measure one label (across × along the roll) and pick it. */}
        <div className="field ls-measure" data-testid="labels-in-printer">
          <label>Which labels are in the printer?</label>
          <div className="ls-chips ls-rollw" role="radiogroup" aria-label="Roll width">
            {([3, 4] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={rollIn === r} className={rollIn === r ? 'on' : ''} onClick={() => setRollIn(r)}>{r}-inch roll</button>)}
          </div>
          <div className="ls-chips" role="radiogroup" aria-label="Labels in the printer">
            {IN_PRINTER.filter((x) => x.roll === rollIn && stocks.some((s) => s.id === x.id)).map((x) => {
              const s = stocks.find((y) => y.id === x.id)!;
              const on = sameGeom(s.geometry, stock);
              return <button key={x.id} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} title={s.name}
                onClick={() => { setStockId(s.id); setGeom(s.geometry); setDevice({ stockId: s.id }); setView(0); setChunk(0); }}>
                <span className="ls-measure-pic" style={{ width: `${Math.round(x.pw)}px`, height: `${Math.round(x.ph)}px` }}>{x.across > 1 && <i />}</span>{x.label}
              </button>;
            })}
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>Measure one label: across the roll × along it. If the labels are bigger than the size chosen, each small label prints alone in the middle or at the top of a big one.</p>
        </div>
        {stock.sheet === 'roll' && (isNativeApp() ? <DirectPrinterPicker /> : <PcHelperPicker />)}
        <div className="lb-actions">
          <button type="button" className="btn btn-secondary" onClick={testPrint} disabled={!metrics.labels || jobBlocked(issues) || turnTooWide || sending} title="Prints only the first row or sheet, to check alignment"><Printer size={15} /> Test print</button>
          <button type="button" className="btn btn-primary" onClick={() => void print()} disabled={!metrics.labels || jobBlocked(issues) || turnTooWide || sending}>{sending ? <Loader2 size={15} className="spin" /> : <Printer size={15} />} {chunks > 1 ? `Print labels (part ${Math.min(chunk, chunks - 1) + 1} of ${chunks})` : 'Print labels'}</button>
        </div>
        {why && <div className="ls-why" role="status" data-testid="why-no-print">
          <AlertTriangle size={14} /> <span>{why.msg}</span>
          {why.fix && <button type="button" className="btn btn-soft btn-sm" onClick={why.fix.run}>{why.fix.label}</button>}
        </div>}
        {stock.sheet === 'roll' && !conn && !isNativeApp() && (() => {
          const d = driverPaperMm(stock, turn);
          return <div className="ls-driver small" data-testid="driver-paper">
            <Printer size={14} aria-hidden="true" /> <span>Printer driver paper (Printing preferences → Page Setup): width <strong>{d.w} mm</strong> × height <strong>{d.h} mm</strong>, {d.gap > 0 ? <>gap <strong>{d.gap} mm</strong></> : <strong>no gap (continuous)</strong>}. In Chrome: Margins <b>None</b>, Scale <b>Default</b>.</span>
          </div>;
        })()}
        {chunks > 1 && <p className="small muted">Big jobs go to the printer {CHUNK_ROWS} rows at a time, so a jam never wastes the whole roll.</p>}
        <p className="small ls-setup-line">
          Printer: <strong>{printerRow.name.split(' · ')[0]}</strong> · {chosenTpl ? chosenTpl.name : 'automatic layout'}{turn ? ` · turned ${turn}°` : ''}.{' '}
          <button type="button" className="lb-linkname" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? 'Hide settings' : 'More settings'}</button>
        </p>
        <div className="ls-more" data-testid="more-settings" hidden={!more}>
        <div className="field">
          <label htmlFor="ls-preset">Label stock</label>
          <select id="ls-preset" className="select" value={stockId} onChange={(e) => { const s = stocks.find((x) => x.id === e.target.value); if (s) { setStockId(s.id); setGeom(s.geometry); setDevice({ stockId: s.id }); setView(0); setChunk(0); } }}>
            {!stockId && <option value="">Saved size: {stock.w} × {stock.h} mm, {stock.across} across</option>}
            <optgroup label="Rolls">{stocks.filter((s) => s.geometry.sheet === 'roll').map((s) => <option key={s.id} value={s.id}>{s.name}{s.preset ? '' : ' (yours)'}</option>)}</optgroup>
            <optgroup label="Sheets">{stocks.filter((s) => s.geometry.sheet !== 'roll').map((s) => <option key={s.id} value={s.id}>{s.name}{s.preset ? '' : ' (yours)'}</option>)}</optgroup>
          </select>
          <p className="small muted" style={{ marginTop: 4 }}>{stock.sheet === 'roll' ? `Row ${rowWidthMm(stock)} mm, pitch ${rowPitchMm(stock)} mm, ${stock.media}` : `${stock.across} × ${stock.rows} per ${SHEET_MM[stock.sheet].label} sheet`}. <button type="button" className="lb-linkname" onClick={() => onOpenTab('stock')}>Add or edit stock</button></p>
        </div>
        <div className="field">
          <label htmlFor="lb-printer">Printer</label>
          <select id="lb-printer" className="select" value={printerRow.id} onChange={(e) => { const p = printers.find((x) => x.id === e.target.value); if (p) choosePrinter(p); }}>
            {printers.filter((p) => !p.preset).length > 0 && <optgroup label="Your printers">{printers.filter((p) => !p.preset).map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}</optgroup>}
            <optgroup label="Printer types">{printers.filter((p) => p.preset).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select>
          <p className="small muted" style={{ marginTop: 4 }}>{printer.headMm} mm head · {printer.dpi} dpi{printer.stockId ? ' · loads its own label stock' : ''}. Remembered on this computer. <button type="button" className="lb-linkname" onClick={() => onOpenTab('stock')}>Edit printers</button></p>
        </div>
        <div className="field">
          <label htmlFor="lb-template">Template</label>
          <select id="lb-template" className="select" value={chosenTpl?.id ?? ''} onChange={(e) => { setTemplateId(e.target.value); setDevice({ templateId: e.target.value }); }}>
            <option value="">Auto layout (from label settings)</option>
            {sizeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.version}{t.isDefault ? ' · default' : ''}</option>)}
            {templates.filter((t) => !sizeTemplates.includes(t)).map((t) => <option key={t.id} value="" disabled>{t.name} ({t.published!.w} × {t.published!.h} mm, other size)</option>)}
          </select>
          {!chosenTpl && (() => { const d = templateFor(sizeTemplates, byId.get(lines[0]?.itemId ?? '')?.category ?? ''); return d ? <button type="button" className="lb-linkname small" onClick={() => setTemplateId(d.id)}>Use the default: {d.name}</button> : null; })()}
          <p className="small muted" style={{ marginTop: 4 }}><button type="button" className="lb-linkname" onClick={() => onOpenTab('templates')}>Design templates</button> · fields and sizes in <Link to="/app/print-settings?tab=barcode">Print settings</Link></p>
        </div>
        {stock.sheet === 'roll' && (
          <div className="field">
            <label className="row" style={{ gap: 6 }}><RotateCw size={14} /> This computer’s printer</label>
            <div className="ls-chips" role="radiogroup" aria-label="Turn the label">
              {([0, 90, 180, 270] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={turn === r} className={turn === r ? 'on' : ''} onClick={() => rememberTurn({ turn: r, ok: mem?.ok })}>{r === 0 ? 'As shown' : `Turn ${r}°`}</button>)}
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>{mem?.ok ? 'Checked on this computer.' : 'You don’t need to set this: after the first print the app asks how the labels came out and turns them for this printer.'}</p>
          </div>
        )}
        <details className="ls-tips" open>
          <summary><Layers size={14} /> Layout options</summary>
          <div className="lb-opts">
            <label className="small">Fill <select className="select" value={opts.fill} onChange={(e) => setOpts({ ...opts, fill: e.target.value as ImposeOptions['fill'] })}><option value="row">Across, row by row</option><option value="column">Down, column by column</option></select></label>
            <label className="small">Last row <select className="select" value={opts.lastRow} onChange={(e) => setOpts({ ...opts, lastRow: e.target.value as ImposeOptions['lastRow'] })}><option value="next">Next item fills it</option><option value="blank">Leave blank</option><option value="repeat">Repeat the last label</option></select></label>
            <label className="small">Order <select className="select" value={opts.order} onChange={(e) => setOpts({ ...opts, order: e.target.value as ImposeOptions['order'] })}><option value="item">Grouped by item</option><option value="source">As listed</option><option value="location">By location</option></select></label>
            <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={opts.keepTogether} onChange={(e) => setOpts({ ...opts, keepTogether: e.target.checked })} /> Start each item on a new row</label>
            <label className="small">Labels per unit (pack factor) <input className="input" type="number" min={1} max={100} value={packFactor} onChange={(e) => setPackFactor(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
            {stock.sheet !== 'roll' && <label className="small">Start at row / column (partly used sheet) <span className="row" style={{ gap: 4 }}>
              <input className="input" type="number" min={1} max={stock.rows} value={opts.start.row} onChange={(e) => setOpts({ ...opts, start: { ...opts.start, row: Math.max(1, Math.min(stock.rows, Number(e.target.value) || 1)) } })} aria-label="Start row" />
              <input className="input" type="number" min={1} max={stock.across} value={opts.start.col} onChange={(e) => setOpts({ ...opts, start: { ...opts.start, col: Math.max(1, Math.min(stock.across, Number(e.target.value) || 1)) } })} aria-label="Start column" />
            </span></label>}
            <label className="small">Start from label number (resume) <input className="input" type="number" min={1} value={from} onChange={(e) => setFrom(Math.max(1, Number(e.target.value) || 1))} /></label>
          </div>
        </details>
        </div>
        {me.can('admin') && stock.sheet !== 'letter' && (!sameGeom(stock, saved) || turn !== turnFromSettings(settings)) && (
          <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => saveDefault.mutate(settingsWithStock(settings, stock, turn))} title="Every computer and phone of this shop starts with this stock and turn">
            <Save size={14} /> Save as this shop’s default stock
          </button>
        )}
      </section>
    </div>
  );
}
