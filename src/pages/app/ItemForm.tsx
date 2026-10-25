import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Package, Wrench, Trash2, Wand2, Sparkles, Loader2, CheckCircle2, Circle, Percent, Info, Boxes, Tag, IndianRupee, ScanBarcode } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useItemFacets, useItems, useMut, useTaxSlabs } from '@/api/hooks';
import type { Item } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field, Toggle } from '@/components/ui';
import { BarcodeInput } from '@/components/BarcodeInput';
import { Thumb, downscaleImage } from '@/components/kit';
import { money } from '@/lib/format';
import { SmartUpload, type FillRow, type PendingFile } from '@/components/SmartUpload';
import { Attachments, attachFile } from '@/components/Attachments';
import { SerialsCard, VariantsSection } from '@/components/ItemExtras';
import type { ExtractResult } from '../../../shared/extract';
import { useAiEnabled } from '@/components/Assistant';

type ItemType = Item['type'];
interface Draft {
  type: ItemType; name: string; sku: string; barcode: string; unit: string; hsn: string; category: string; brand: string; image: string; description: string;
  cost: string; mrp: string; sp1: string; sp2: string; sp3: string; taxSlabId: string;
  reorderLevel: string; trackBatches: boolean; trackSerials: boolean; openingStock: string; branchId: string; batchNo: string; expiryDate: string;
}

const GOODS_UNITS = ['pcs', 'nos', 'box', 'pack', 'kg', 'g', 'ltr', 'ml', 'mtr', 'ream', 'dozen', 'set', 'pair'];
const SERVICE_UNITS = ['job', 'hour', 'day', 'visit', 'month', 'year'];
const TIERS = [
  { k: 'sp1', label: 'SP1 · Standard', hint: 'Walk-in & regular customers', color: '#c75f71' },
  { k: 'sp2', label: 'SP2 · Loyal', hint: 'Repeat & loyal customers', color: '#7d8c77' },
  { k: 'sp3', label: 'SP3 · New', hint: 'First-time / promotional', color: '#c98a3c' },
] as const;

/** Internal EAN-13 (prefix 2 = in-store use) with a valid check digit. */
export function generateEan13() {
  const body = '2' + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}
const skuFrom = (name: string, brand: string) => {
  const part = (s: string, n: number) => s.replace(/[^a-z0-9 ]/gi, '').trim().split(/\s+/).filter(Boolean).map((w) => w.slice(0, n)).join('').toUpperCase();
  const base = [part(brand, 3).slice(0, 3), part(name, 2).slice(0, 6)].filter(Boolean).join('-') || 'ITEM';
  return `${base}-${Math.floor(100 + Math.random() * 900)}`;
};

const blank = (type: ItemType, taxSlabId: string, branchId: string, barcode = ''): Draft => ({
  type, name: '', sku: '', barcode, unit: type === 'Goods' ? 'pcs' : 'job', hsn: '', category: '', brand: '', image: '', description: '',
  cost: '', mrp: '', sp1: '', sp2: '', sp3: '', taxSlabId, reorderLevel: '10', trackBatches: false, trackSerials: false, openingStock: '', branchId, batchNo: '', expiryDate: '',
});

function Section({ n, title, sub, children, right }: { n: number; title: string; sub: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <span className="num">{n}</span>
        <div style={{ flex: 1 }}><h3>{title}</h3><p>{sub}</p></div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function ItemForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useShopUser();
  const itemsQ = useItems();
  const items = itemsQ.data ?? [];
  const current = editing ? items.find((i) => i.id === id) : undefined;
  const facets = useItemFacets().data;
  const slabsQ = useTaxSlabs();
  const activeSlabs = (slabsQ.data ?? []).filter((s) => s.active);
  const branches = useBranches().data ?? [];
  const primaryBranch = branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '';
  const defaultSlab = activeSlabs.find((s) => s.rate === 18)?.id ?? activeSlabs[0]?.id ?? '';
  const fileRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>(() => blank(params.get('type') === 'Services' ? 'Services' : 'Goods', '', '', params.get('barcode') ?? ''));
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [marginPct, setMarginPct] = useState('25');
  const [dragOver, setDragOver] = useState(false);
  /** A PDF read by "Fill from a PDF", kept on the item once it is saved. */
  const [keepFile, setKeepFile] = useState<PendingFile | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Initialise once reference data has loaded.
  useEffect(() => {
    if (ready || !slabsQ.data || !itemsQ.data) return;
    if (editing) {
      const it = items.find((i) => i.id === id);
      if (!it) return;
      setDraft({
        ...blank(it.type, it.taxSlabId, primaryBranch), type: it.type, name: it.name, sku: it.sku, barcode: it.barcode, unit: it.unit, hsn: it.hsn, category: it.category ?? '', brand: it.brand ?? '',
        image: it.image ?? '', description: it.description, cost: String(it.cost ?? 0), mrp: it.mrp == null ? '' : String(it.mrp), sp1: String(it.sp1), sp2: String(it.sp2), sp3: String(it.sp3),
        reorderLevel: String(it.reorderLevel), trackBatches: it.trackBatches, trackSerials: it.trackSerials,
      });
    } else setDraft((d) => ({ ...d, taxSlabId: d.taxSlabId || defaultSlab, branchId: d.branchId || primaryBranch }));
    setReady(true);
  }, [slabsQ.data, itemsQ.data, branches.length]);
  useEffect(() => { if (!draft.branchId && primaryBranch) set('branchId', primaryBranch); }, [primaryBranch]);

  const keys = [['items'], ['itemFacets'], ['stockAlerts'], ['notifications'], ['dashboard'], ['movements']];
  const createItem = useMut((b: Record<string, unknown>) => api.post<Item>('/shop/items', b), keys, { silentError: true });
  const updateItem = useMut((v: { id: string; body: Record<string, unknown> }) => api.patch<Item>(`/shop/items/${v.id}`, v.body), keys, { silentError: true });
  const saving = createItem.isPending || updateItem.isPending;

  /* ---------- derived ---------- */
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const cost = num(draft.cost);
  const slab = activeSlabs.find((s) => s.id === draft.taxSlabId);
  const marginOf = (sp: number) => (sp > 0 && cost >= 0 ? Math.round(((sp - cost) / sp) * 100) : null);
  const errs = {
    name: !draft.name.trim() ? 'Give your item a name' : '',
    cost: !(cost >= 0) ? 'Enter what it costs you (0 for services with no cost)' : '',
    sp1: !(num(draft.sp1) > 0) ? 'Required' : '',
    sp2: !(num(draft.sp2) > 0) ? 'Required' : '',
    sp3: !(num(draft.sp3) > 0) ? 'Required' : '',
    barcode: draft.barcode && items.some((i) => i.barcode === draft.barcode && i.id !== id) ? 'This barcode is already on another item' : '',
    sku: draft.sku && items.some((i) => i.sku.toLowerCase() === draft.sku.toLowerCase() && i.id !== id) ? 'SKU already exists' : '',
    taxSlabId: !draft.taxSlabId ? 'Pick a GST rate' : '',
    hsn: draft.hsn && !/^\d{2,8}$/.test(draft.hsn) ? 'HSN/SAC must be 2–8 digits' : '',
    mrp: draft.mrp && num(draft.mrp) > 0 && num(draft.sp1) > num(draft.mrp) ? 'Selling price is above MRP' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const blocking = (Object.keys(errs) as Array<keyof typeof errs>).filter((k) => k !== 'mrp' && errs[k]);

  const checklist = useMemo(() => [
    { label: 'Name', done: !!draft.name.trim() },
    { label: 'Selling prices', done: num(draft.sp1) > 0 && num(draft.sp2) > 0 && num(draft.sp3) > 0 },
    { label: 'Cost price', done: cost >= 0 },
    { label: draft.type === 'Goods' ? 'HSN code (for GST returns)' : 'SAC code (for GST returns)', done: /^\d{2,8}$/.test(draft.hsn) },
    { label: 'Photo', done: !!draft.image, optional: true },
    { label: 'Category', done: !!draft.category, optional: true },
    ...(draft.type === 'Goods' ? [{ label: draft.barcode ? 'Barcode' : 'Barcode (scan or generate)', done: !!draft.barcode, optional: true }] : []),
  ], [draft, cost]);
  const completeness = Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);

  const pickImage = async (file?: File | null) => {
    if (!file) return;
    try {
      set('image', await downscaleImage(file));
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  /* ---------- fill from an uploaded PDF or photo ---------- */
  const productOf = (r: ExtractResult) => r.data.lines[0];
  const fillRows = (r: ExtractResult): FillRow[] => {
    const l = productOf(r);
    const price = l?.sellingPrice ?? l?.rate ?? null;
    const slabFor = (rate: number | null | undefined) => (rate == null ? undefined : activeSlabs.find((x) => x.rate === rate));
    const rows: FillRow[] = [
      { key: 'name', label: 'Name', value: l?.name, current: draft.name },
      { key: 'brand', label: 'Brand', value: l?.brand, current: draft.brand },
      { key: 'category', label: 'Category', value: l?.category, current: draft.category },
      { key: 'sku', label: 'SKU', value: l?.sku, current: draft.sku },
      { key: 'barcode', label: 'Barcode', value: l?.barcode, current: draft.barcode },
      { key: 'hsn', label: l?.hsn?.startsWith('99') ? 'SAC' : 'HSN', value: l?.hsn?.replace(/\D/g, '').slice(0, 8), current: draft.hsn },
      { key: 'unit', label: 'Unit', value: l?.unit, current: draft.unit },
      { key: 'mrp', label: 'MRP', value: l?.mrp, display: l?.mrp != null ? money(l.mrp) : undefined, current: draft.mrp },
      { key: 'price', label: 'Selling price (all price levels)', value: price, display: price != null ? money(price) : undefined, current: draft.sp1 },
      { key: 'cost', label: 'Cost price', value: l?.costPrice, display: l?.costPrice != null ? money(l.costPrice) : undefined, current: draft.cost },
      { key: 'tax', label: 'GST rate', value: slabFor(l?.taxRate)?.name ?? (l?.taxRate != null ? `${l.taxRate}% (no matching slab)` : null), current: slab?.name },
      { key: 'description', label: 'Description', value: l?.description, current: draft.description },
    ];
    return rows;
  };
  const applyFill = (keys: Set<string>, r: ExtractResult, file: PendingFile) => {
    const l = productOf(r);
    const price = l?.sellingPrice ?? l?.rate ?? null;
    const slabMatch = l?.taxRate != null ? activeSlabs.find((x) => x.rate === l.taxRate) : undefined;
    setDraft((d) => {
      const n = { ...d };
      if (l) {
        if (keys.has('name') && l.name) n.name = l.name;
        if (keys.has('brand') && l.brand) n.brand = l.brand;
        if (keys.has('category') && l.category) n.category = l.category;
        if (keys.has('sku') && l.sku) n.sku = l.sku;
        if (keys.has('barcode') && l.barcode) n.barcode = l.barcode;
        if (keys.has('hsn') && l.hsn) { n.hsn = l.hsn.replace(/\D/g, '').slice(0, 8); if (n.hsn.startsWith('99')) { n.type = 'Services'; if (GOODS_UNITS.includes(n.unit)) n.unit = 'job'; } }
        if (keys.has('unit') && l.unit) n.unit = l.unit.toLowerCase();
        if (keys.has('mrp') && l.mrp != null) n.mrp = String(l.mrp);
        if (keys.has('price') && price != null) { n.sp1 = String(price); n.sp2 = String(price); n.sp3 = String(price); }
        if (keys.has('cost') && l.costPrice != null) n.cost = String(l.costPrice);
        if (keys.has('tax') && slabMatch) n.taxSlabId = slabMatch.id;
        if (keys.has('description') && l.description) n.description = l.description;
      }
      return n;
    });
    if (keys.has('photo') || (file.file.type.startsWith('image/') && !draft.image)) void pickImage(file.file);
    if (file.file.type === 'application/pdf') {
      if (editing) void attachFile('item', id!, file.file.name, file.dataUrl).then(() => toast('success', 'PDF attached to the item', file.file.name)).catch(() => undefined);
      else setKeepFile(file);
    }
  };

  /* ---------- AI: HSN, GST rate, unit, category and description from the name ---------- */
  const aiOn = useAiEnabled();
  const [aiBusy, setAiBusy] = useState(false);
  const aiFill = async () => {
    if (draft.name.trim().length < 2) { toast('info', 'Type the item name first'); document.getElementById('item-name')?.focus(); return; }
    setAiBusy(true);
    try {
      const r = await api.post<{ type: ItemType; hsn: string; gstRate: number; unit: string; category: string; brand: string | null; description: string; note: string | null }>(
        '/shop/ai/item-suggest', { name: draft.name.trim(), hint: [draft.brand, draft.category].filter(Boolean).join(', ') });
      const slabMatch = activeSlabs.find((x) => x.rate === r.gstRate);
      const d = draft;
      const n = { ...d };
      const filled: string[] = [];
      const hsn = r.hsn.replace(/\D/g, '').slice(0, 8);
      if (!d.hsn && /^\d{4,8}$/.test(hsn)) { n.hsn = hsn; filled.push(hsn.startsWith('99') ? 'SAC' : 'HSN'); }
      if (!editing && r.type !== d.type && !d.sp1) n.type = r.type;
      if (slabMatch && (!editing || !d.taxSlabId) && slabMatch.id !== d.taxSlabId) { n.taxSlabId = slabMatch.id; filled.push('GST rate'); }
      if (!d.category && r.category) { n.category = r.category; filled.push('category'); }
      if (!d.brand && r.brand) { n.brand = r.brand; filled.push('brand'); }
      if (!d.description && r.description) { n.description = r.description; filled.push('description'); }
      const unit = r.unit.toLowerCase();
      if (!editing && unit && (d.unit === 'pcs' || d.unit === 'job') && unit !== d.unit) { n.unit = unit; filled.push('unit'); }
      setDraft((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(n).filter(([k, v]) => (d as unknown as Record<string, unknown>)[k] !== v)) }));
      toast('success', filled.length ? `Filled ${[...new Set(filled)].join(', ')}` : 'Nothing to fill — those fields already have values', r.note ?? 'Check the HSN and GST rate against your purchase bill.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const fillFromMargin = () => {
    const m = Number(marginPct);
    if (!(cost > 0) || !(m >= 0 && m < 95)) return toast('info', 'Enter the cost price first', 'Prices are calculated from cost + margin.');
    const sp = (pct: number) => String(Math.ceil(cost / (1 - pct / 100)));
    setDraft((d) => ({ ...d, sp1: sp(m), sp2: sp(Math.max(0, m - 5)), sp3: sp(Math.max(0, m - 2)) }));
  };

  const save = (next: 'list' | 'another' | 'view') => {
    setTouched(true);
    setServerErr({});
    if (blocking.length) {
      toast('error', 'A few details are missing', 'Check the highlighted fields.');
      document.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const body: Record<string, unknown> = {
      type: draft.type, name: draft.name.trim(), sku: draft.sku.trim(), barcode: draft.barcode, unit: draft.unit, hsn: draft.hsn, cost,
      sp1: num(draft.sp1), sp2: num(draft.sp2), sp3: num(draft.sp3), taxSlabId: draft.taxSlabId, reorderLevel: Number(draft.reorderLevel || 0),
      trackBatches: draft.type === 'Goods' && draft.trackBatches, trackSerials: draft.type === 'Goods' && draft.trackSerials, description: draft.description, category: draft.category.trim(), brand: draft.brand.trim(),
      image: draft.image, mrp: draft.mrp.trim() === '' ? null : num(draft.mrp),
    };
    const onError = (err: Error) => {
      const f = fieldErrors(err);
      setServerErr(f);
      toast('error', Object.keys(f).length ? 'Please fix the highlighted fields' : err.message);
    };
    if (editing) {
      updateItem.mutate({ id: id!, body }, { onSuccess: (it) => { toast('success', 'Item updated', it.name); navigate(`/app/items?open=${it.id}`); }, onError });
    } else {
      createItem.mutate(
        { ...body, openingStock: draft.type === 'Goods' ? Math.max(0, Number(draft.openingStock || 0)) : 0, branchId: draft.branchId || null, batchNo: draft.batchNo || undefined, expiryDate: draft.expiryDate || undefined },
        {
          onSuccess: (it) => {
            toast('success', 'Item created', `${it.name} is ready to sell.`);
            if (keepFile) { void attachFile('item', it.id, keepFile.file.name, keepFile.dataUrl).catch(() => toast('error', 'The PDF couldn’t be attached', 'Open the item and attach it again.')); setKeepFile(null); }
            if (next === 'another') {
              setDraft(blank(it.type, it.taxSlabId, draft.branchId));
              setTouched(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(() => document.getElementById('item-name')?.focus(), 100);
            } else navigate(next === 'view' ? `/app/items?open=${it.id}` : '/app/items');
          },
          onError,
        },
      );
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
        ev.preventDefault();
        save('view');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me.can('items.write')) return <div className="page"><p className="muted">You don’t have permission to edit items.</p></div>;
  if (editing && itemsQ.data && !items.some((i) => i.id === id)) return <div className="page"><p className="muted">Item not found. <Link to="/app/items">Back to items</Link></p></div>;

  const units = [...new Set([...(draft.type === 'Goods' ? GOODS_UNITS : SERVICE_UNITS), ...(facets?.units ?? []), draft.unit])];
  const sp1 = num(draft.sp1);
  const inclusive = sp1 > 0 && slab ? sp1 * (1 + slab.rate / 100) : NaN;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/app/items" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Items</Link></div>
          <h1>{editing ? `Edit ${draft.name || 'item'}` : 'New item'}</h1>
          <p>{editing ? 'Changes apply to new invoices. Past invoices keep their original details.' : 'Only the name and prices are required. Everything else helps with search, GST returns and stock.'}</p>
        </div>
      </div>

      <div className="form-layout">
        <div className="card">
          <div style={{ padding: '16px 20px 0' }}>
            <SmartUpload kind="item" toRows={fillRows} onApply={applyFill}
              title="Fill from a PDF or photo"
              hint="Product sheet, price list, supplier invoice or a photo of the box or label. A photo also becomes the product picture." />
            {keepFile && <div className="small muted" style={{ marginTop: 6 }}>{keepFile.file.name} will be attached to the item when you save. <button className="btn btn-ghost btn-sm" onClick={() => setKeepFile(null)}>Don’t attach</button></div>}
          </div>
          <Section n={1} title="What are you adding?" sub="Goods have stock. Services (repairs, installation, AMC) don’t.">
            <div className="type-cards">
              {([['Goods', Package, 'Products you buy & sell', 'Tracks stock, batches & barcodes'], ['Services', Wrench, 'Work you charge for', 'No stock — billed per job, hour…']] as const).map(([t, Icon, title, sub]) => (
                <button key={t} type="button" className={`type-card ${draft.type === t ? 'active' : ''}`} onClick={() => setDraft((d) => ({ ...d, type: t, unit: t === 'Goods' ? (GOODS_UNITS.includes(d.unit) ? d.unit : 'pcs') : SERVICE_UNITS.includes(d.unit) ? d.unit : 'job' }))}>
                  <span className={`stat-icon ${t === 'Goods' ? 'tone-blue' : 'tone-violet'}`}><Icon size={19} /></span>
                  <div><strong>{t === 'Goods' ? 'Goods' : 'Service'} · {title}</strong><span>{sub}</span></div>
                </button>
              ))}
            </div>
          </Section>

          <Section n={2} title="Basic details" sub="How the item appears on invoices, search and the POS screen.">
            <div className="item-basic">
              <div
                className={`img-drop ${dragOver ? 'over' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(ev) => { ev.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(ev) => { ev.preventDefault(); setDragOver(false); pickImage(ev.dataTransfer.files[0]); }}
                role="button"
                tabIndex={0}
                aria-label="Upload item photo"
              >
                {draft.image ? (
                  <>
                    <img src={draft.image} alt="Item" />
                    <button type="button" className="img-remove" aria-label="Remove photo" onClick={(ev) => { ev.stopPropagation(); set('image', ''); }}><Trash2 size={14} /></button>
                  </>
                ) : (
                  <div className="img-empty"><span className="img-empty-icon"><Camera size={26} /></span><strong>Add photo</strong><span>Click to upload</span></div>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(ev) => { pickImage(ev.target.files?.[0]); ev.target.value = ''; }} />
              </div>
              <div className="form-grid" style={{ flex: 1 }}>
                <Field label="Item name" required error={e('name')} className="span-all"
                  hint={aiOn ? 'Type the name, then “Fill with AI” suggests the HSN code, GST rate, category and description.' : undefined}>
                  <div className={aiOn ? 'input-with-btn' : undefined}>
                    <input id="item-name" className={`input input-lg ${e('name') ? 'invalid' : ''}`} value={draft.name} onChange={(ev) => set('name', ev.target.value)} placeholder={draft.type === 'Goods' ? 'e.g. Logitech M331 Silent Mouse' : 'e.g. Laptop Servicing'} autoFocus={!editing} />
                    {aiOn && <button type="button" className="btn btn-soft btn-sm addon-btn ai-suggest" onClick={aiFill} disabled={aiBusy} title="Suggest HSN, GST rate, category and description">{aiBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Fill with AI</button>}
                  </div>
                </Field>
                <Field label="Category" hint={!draft.category && facets?.categories.length ? undefined : 'Group similar items for filters & reports'}>
                  <input className="input" list="dl-categories" value={draft.category} onChange={(ev) => set('category', ev.target.value)} placeholder="e.g. Accessories" />
                  <datalist id="dl-categories">{facets?.categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                  {!draft.category && !!facets?.categories.length && <div className="suggest">{facets.categories.slice(0, 6).map((c) => <button key={c.name} type="button" onClick={() => set('category', c.name)}>{c.name}</button>)}</div>}
                </Field>
                <Field label="Brand">
                  <input className="input" list="dl-brands" value={draft.brand} onChange={(ev) => set('brand', ev.target.value)} placeholder="e.g. Logitech" />
                  <datalist id="dl-brands">{facets?.brands.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                </Field>
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 16 }}>
              <Field label="SKU / item code" error={e('sku')} hint="Your own short code — handy for search">
                <div className="input-with-btn">
                  <input className={`input ${e('sku') ? 'invalid' : ''}`} value={draft.sku} onChange={(ev) => set('sku', ev.target.value.toUpperCase())} placeholder="e.g. LOG-M331" />
                  <button type="button" className="btn btn-soft btn-sm addon-btn" onClick={() => set('sku', skuFrom(draft.name, draft.brand))} title="Generate from name & brand"><Wand2 size={14} /> Auto</button>
                </div>
              </Field>
              <Field label="Unit" hint="How you count it on invoices">
                <select className="select" value={draft.unit} onChange={(ev) => set('unit', ev.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select>
              </Field>
              {draft.type === 'Goods' && (
                <Field label="Barcode" error={e('barcode')} className="span-all" hint={<>Scan with a USB scanner or camera — or <button type="button" className="link-btn" onClick={() => set('barcode', generateEan13())}><ScanBarcode size={12} /> generate one</button> and print labels later.</>}>
                  <BarcodeInput value={draft.barcode} invalid={!!e('barcode')} onChange={(v) => set('barcode', v)}
                    onScan={(code) => { const ex = items.find((i) => i.barcode === code && i.id !== id); if (ex) toast('error', 'Barcode already in use', ex.name); }} />
                </Field>
              )}
              <Field label="Description" className="span-all">
                <textarea className="textarea" rows={2} value={draft.description} onChange={(ev) => set('description', ev.target.value)} placeholder="Optional — model, size, colour, warranty…" />
              </Field>
            </div>
          </Section>

          <Section n={3} title="Pricing" sub="Three price levels let you charge regulars, loyal customers and new customers differently."
            right={(
              <div className="quickfill" title="Fill all three prices from cost + margin">
                <Sparkles size={14} />
                <span className="small">Margin</span>
                <input className="input" value={marginPct} onChange={(ev) => setMarginPct(ev.target.value.replace(/[^\d.]/g, ''))} aria-label="Target margin %" />
                <Percent size={12} className="muted" />
                <button type="button" className="btn btn-soft btn-sm" onClick={fillFromMargin}>Auto-fill</button>
              </div>
            )}>
            <div className="form-grid cols-3">
              <Field label="Cost price" required error={e('cost')} hint="What you pay per unit">
                <div className="input-addon"><span>₹</span><input className={`input ${e('cost') ? 'invalid' : ''}`} type="number" min={0} value={draft.cost} onChange={(ev) => set('cost', ev.target.value)} placeholder="0.00" /></div>
              </Field>
              <Field label="MRP" error={e('mrp')} hint="Printed max retail price (optional)">
                <div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={draft.mrp} onChange={(ev) => set('mrp', ev.target.value)} placeholder="—" /></div>
              </Field>
              <Field label="GST rate" required error={e('taxSlabId')} hint={draft.type === 'Goods' ? 'Rates come from the platform Tax Lab' : 'Most services are 18%'}>
                <div className="rate-pills">
                  {activeSlabs.map((s) => <button key={s.id} type="button" className={draft.taxSlabId === s.id ? 'active' : ''} onClick={() => set('taxSlabId', s.id)}>{s.rate}%</button>)}
                </div>
              </Field>
            </div>
            <div className="tier-grid">
              {TIERS.map((t) => {
                const v = num(draft[t.k]);
                const m = marginOf(v);
                return (
                  <div key={t.k} className="price-tier" style={{ borderTop: `3px solid ${t.color}` }}>
                    <div className="pt-label"><span className="pt-dot" style={{ background: t.color }} />{t.label}<span className="req">*</span></div>
                    <div className="input-addon"><span>₹</span><input className={`input ${e(t.k) ? 'invalid' : ''}`} type="number" min={0} value={draft[t.k]} onChange={(ev) => set(t.k, ev.target.value)} placeholder="0.00" aria-label={t.label} /></div>
                    <div className="small muted" style={{ marginTop: 6 }}>{t.hint}</div>
                    {m !== null && <span className={`margin-chip ${m < 0 ? 'bad' : m < 10 ? 'low' : 'good'}`}>{m < 0 ? 'Loss' : 'Margin'} {m}% · {money(v - cost)}/unit</span>}
                    {e(t.k) && <div className="field-error" style={{ marginTop: 6 }}>{e(t.k)}</div>}
                  </div>
                );
              })}
            </div>
            {sp1 > 0 && !draft.sp2 && !draft.sp3 && (
              <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setDraft((d) => ({ ...d, sp2: d.sp1, sp3: d.sp1 }))}>Use {money(sp1)} for all three levels</button>
            )}
            <Field label={draft.type === 'Goods' ? 'HSN code' : 'SAC code'} error={e('hsn')} hint="Needed for the GSTR-1 HSN summary. Find it on your purchase bill." className="mt-16" >
              <input className={`input ${e('hsn') ? 'invalid' : ''}`} style={{ maxWidth: 260 }} value={draft.hsn} onChange={(ev) => set('hsn', ev.target.value.replace(/\D/g, ''))} placeholder={draft.type === 'Goods' ? 'e.g. 8471' : 'e.g. 9987'} maxLength={8} inputMode="numeric" />
            </Field>
          </Section>

          {draft.type === 'Goods' && (
            <Section n={4} title="Inventory" sub="Opening stock, low-stock alerts and batch / expiry tracking.">
              <div className="form-grid">
                {!editing && (
                  <>
                    <Field label="Opening stock" hint="How many you have right now">
                      <div className="input-addon"><span>{draft.unit}</span><input className="input" type="number" min={0} value={draft.openingStock} onChange={(ev) => set('openingStock', ev.target.value)} placeholder="0" /></div>
                    </Field>
                    <Field label="Stored at">
                      <select className="select" value={draft.branchId} onChange={(ev) => set('branchId', ev.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                    </Field>
                  </>
                )}
                <Field label="Low-stock alert at" hint="We’ll remind you to reorder at this level">
                  <div className="input-addon"><span>{draft.unit}</span><input className="input" type="number" min={0} value={draft.reorderLevel} onChange={(ev) => set('reorderLevel', ev.target.value)} /></div>
                </Field>
              </div>
              <div className="toggle-row">
                <div><div className="strong">Track batches &amp; expiry dates</div><div className="small muted">For medicines, food and cosmetics. Sales automatically pick the batch that expires first.</div></div>
                <Toggle checked={draft.trackBatches} onChange={(v) => set('trackBatches', v)} />
              </div>
              {draft.trackBatches && !editing && Number(draft.openingStock) > 0 && (
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <Field label="Batch number"><input className="input" value={draft.batchNo} onChange={(ev) => set('batchNo', ev.target.value)} placeholder="e.g. B2410" /></Field>
                  <Field label="Expiry date"><input className="input" type="date" value={draft.expiryDate} onChange={(ev) => set('expiryDate', ev.target.value)} /></Field>
                </div>
              )}
              <div className="toggle-row">
                <div><div className="strong">Track serial numbers</div><div className="small muted">For phones, laptops and appliances. Each unit sold is picked by its serial or IMEI number and printed on the invoice.</div></div>
                <Toggle checked={draft.trackSerials} onChange={(v) => set('trackSerials', v)} />
              </div>
              {editing && <p className="small muted" style={{ marginTop: 12 }}><Info size={13} style={{ verticalAlign: -2 }} /> To change stock, open the item and use <strong>Adjust stock</strong>. Every change keeps a history.</p>}
            </Section>
          )}

          {editing && current && current.type === 'Goods' && !current.parentId && (
            <Section n={5} title="Variants" sub="Sizes, colours or other options, each with its own stock, SKU and price.">
              <VariantsSection item={current} items={items} />
            </Section>
          )}
        </div>

        <aside className="sticky-side">
          <div className="card preview-card">
            <div className="small muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 11, marginBottom: 10 }}>Live preview</div>
            <Thumb large name={draft.name || 'New item'} image={draft.image} />
            <div className="pv-name">{draft.name || <span className="muted">Item name</span>}</div>
            <div className="small muted">{[draft.category, draft.brand, draft.sku].filter(Boolean).join(' · ') || (draft.type === 'Goods' ? 'Goods' : 'Service')}</div>
            <div className="pv-price">
              <div><span className="pv-amount">{sp1 > 0 ? money(sp1) : '₹ —'}</span><span className="small muted"> / {draft.unit}</span></div>
              {Number.isFinite(inclusive) && <div className="small muted">{money(inclusive)} incl. {slab?.rate}% GST</div>}
              {draft.mrp && num(draft.mrp) > sp1 && sp1 > 0 && <div className="small" style={{ color: 'var(--green-700)', fontWeight: 600 }}>{Math.round(((num(draft.mrp) - sp1) / num(draft.mrp)) * 100)}% off MRP {money(num(draft.mrp))}</div>}
            </div>
            <div className="pv-stats">
              <div><span>Margin</span><strong className={marginOf(sp1) !== null && marginOf(sp1)! < 0 ? 'neg' : ''}>{marginOf(sp1) ?? '—'}{marginOf(sp1) !== null && '%'}</strong></div>
              {draft.type === 'Goods' && <div><span>{editing ? 'In stock' : 'Opening'}</span><strong>{editing ? items.find((i) => i.id === id)?.stock ?? 0 : Number(draft.openingStock || 0)} {draft.unit}</strong></div>}
              <div><span>GST</span><strong>{slab ? `${slab.rate}%` : '—'}</strong></div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16, padding: 18 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <strong style={{ color: 'var(--ink-900)', fontSize: 14 }}>Item completeness</strong>
              <span className="strong" style={{ color: completeness === 100 ? 'var(--green-700)' : 'var(--brand-700)' }}>{completeness}%</span>
            </div>
            <div className="progress"><span style={{ width: `${completeness}%` }} /></div>
            <ul className="check-list">
              {checklist.map((c) => (
                <li key={c.label} className={c.done ? 'done' : ''}>
                  {c.done ? <CheckCircle2 size={15} /> : <Circle size={15} />} {c.label} {c.optional && !c.done && <span className="muted small">· optional</span>}
                </li>
              ))}
            </ul>
          </div>

          {editing && current?.trackSerials && !current.isGroup && <div className="card" style={{ marginTop: 16, padding: 18 }}><SerialsCard item={current} canWrite /></div>}

          {editing && <div className="card" style={{ marginTop: 16, padding: 18 }}><Attachments entity="item" entityId={id!} title="Files" /></div>}

          <div className="card tip-card" style={{ marginTop: 16 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>{draft.type === 'Goods' ? <Boxes size={16} /> : <Tag size={16} />}<strong>Good to know</strong></div>
            <ul>
              <li><IndianRupee size={12} /> The customer’s price level (SP1/2/3) is picked automatically on invoices.</li>
              <li><ScanBarcode size={12} /> After saving, select items on the list to print barcode labels.</li>
              <li><Boxes size={12} /> Stock goes down on each invoice and up when you receive a purchase order.</li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="form-actions-bar">
        <span className="small muted desktop-only">Tip: press <span className="kbd">Ctrl</span> + <span className="kbd">S</span> to save</span>
        <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          {!editing && <button className="btn btn-secondary" disabled={saving} onClick={() => save('another')}>Save &amp; add another</button>}
          <button className="btn btn-primary" disabled={saving} onClick={() => save('view')}>{saving && <Loader2 size={15} className="spin" />} {editing ? 'Save changes' : 'Save item'}</button>
        </div>
      </div>
    </div>
  );
}
