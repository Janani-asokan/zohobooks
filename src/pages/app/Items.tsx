import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Package, Wrench, Pencil, Trash2, ScanBarcode, AlertTriangle, TrendingUp, Download, Upload, Boxes, Tag, ArrowLeftRight, SlidersHorizontal, X, CalendarClock, Loader2, Archive } from 'lucide-react';
import { api, download, fieldErrors } from '@/api/client';
import { useBranches, useItems, useMovements, useMut, useStockAlerts, useTaxSlabs } from '@/api/hooks';
import type { Item } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Pagination, SearchInput, Segmented, Toggle, usePagination } from '@/components/ui';
import { BarcodeInput } from '@/components/BarcodeInput';
import { CsvImport } from '@/components/CsvImport';
import { SavedViewsMenu, useSavedViews } from '@/components/SavedViews';
import { fmtDate, money, todayISO } from '@/lib/format';

type ItemType = Item['type'];
type Draft = { type: ItemType; name: string; sku: string; barcode: string; unit: string; hsn: string; cost: string; sp1: string; sp2: string; sp3: string; taxSlabId: string; reorderLevel: string; trackBatches: boolean; description: string; openingStock: string; branchId: string; batchNo: string; expiryDate: string };

const blank = (type: ItemType, taxSlabId: string, branchId: string, barcode = ''): Draft => ({
  type, name: '', sku: '', barcode, unit: type === 'Goods' ? 'pcs' : 'job', hsn: '', cost: '', sp1: '', sp2: '', sp3: '', taxSlabId, reorderLevel: '10', trackBatches: false, description: '', openingStock: '', branchId, batchNo: '', expiryDate: '',
});

type EditableKey = 'name' | 'sku' | 'cost' | 'sp1' | 'sp2' | 'sp3';
const NUMERIC: EditableKey[] = ['cost', 'sp1', 'sp2', 'sp3'];
const ITEM_TEMPLATE = 'Type,Name,SKU,Barcode,Unit,HSN,Cost,SP1,SP2,SP3,Tax Rate,Stock,Reorder Level\r\nGoods,Sample Mouse,MOU-01,8901234567890,pcs,8471,250,399,379,389,18,25,5\r\nServices,Installation,SRV-INS,,job,9987,0,499,449,479,18,,\r\n';

const REASON_LABEL: Record<string, string> = { opening: 'Opening stock', sale: 'Sale', sale_cancel: 'Invoice cancelled', credit_note: 'Credit note return', adjustment: 'Adjustment', transfer_in: 'Transfer in', transfer_out: 'Transfer out', purchase: 'Purchase' };

export default function Items() {
  const me = useShopUser();
  const canWrite = me.can('items.write');
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const itemsQ = useItems();
  const items = itemsQ.data ?? [];
  const slabsQ = useTaxSlabs();
  const slabs = slabsQ.data ?? [];
  const activeSlabs = slabs.filter((s) => s.active);
  const branches = useBranches().data ?? [];
  const primaryBranch = branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '';

  const sv = useSavedViews('items', { tab: 'Goods' as ItemType | 'stock', q: '', tax: 'all', stock: 'all' as 'all' | 'low' | 'out', branch: 'all' });
  const { tab, q, tax: taxFilter, stock: stockFilter, branch: branchFilter } = sv.filters;
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; id?: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank('Goods', 'tax_18', ''));
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Item | null>(null);
  const [editing, setEditing] = useState<{ id: string; key: EditableKey; value: string } | null>(null);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTax, setBulkTax] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [stockItem, setStockItem] = useState<Item | null>(null);

  const defaultSlab = activeSlabs.find((s) => s.rate === 18)?.id ?? activeSlabs[0]?.id ?? '';
  const keys = [['items'], ['stockAlerts'], ['notifications'], ['dashboard'], ['movements']];
  const createItem = useMut((b: Record<string, unknown>) => api.post<Item>('/shop/items', b), keys, { silentError: true });
  const updateItem = useMut((v: { id: string; body: Record<string, unknown> }) => api.patch<Item>(`/shop/items/${v.id}`, v.body), keys, { silentError: true });
  const archive = useMut((id: string) => api.del(`/shop/items/${id}`), keys, { success: 'Item archived' });
  const bulk = useMut((b: { ids: string[]; action: 'archive' | 'setTax'; taxSlabId?: string }) => api.post<{ updated: number }>('/shop/items/bulk', b), keys, { success: (r, v) => (v.action === 'archive' ? `${r.updated} items archived` : `Tax slab updated on ${r.updated} items`) });

  const openNew = (type: ItemType = tab === 'Services' ? 'Services' : 'Goods', barcode = '') => {
    setDraft(blank(type, defaultSlab, primaryBranch, barcode));
    setTouched(false);
    setServerErr({});
    setModal({ mode: 'new' });
  };
  const openEdit = (it: Item) => {
    setDraft({ ...blank(it.type, it.taxSlabId, primaryBranch), ...it, cost: String(it.cost ?? 0), sp1: String(it.sp1), sp2: String(it.sp2), sp3: String(it.sp3), reorderLevel: String(it.reorderLevel), openingStock: '', batchNo: '', expiryDate: '', branchId: primaryBranch });
    setTouched(false);
    setServerErr({});
    setModal({ mode: 'edit', id: it.id });
  };

  useEffect(() => {
    if (params.get('new') && canWrite && slabsQ.data) {
      openNew('Goods');
      params.delete('new');
      setParams(params, { replace: true });
    }
    if (params.get('q')) { sv.setFilters({ q: params.get('q')!, tab: 'Goods' }); params.delete('q'); setParams(params, { replace: true }); }
    if (params.get('tab') === 'stock') { sv.setFilters({ tab: 'stock' }); params.delete('tab'); setParams(params, { replace: true }); }
    if (params.get('stock') === 'low') { sv.setFilters({ tab: 'Goods', stock: 'low' }); params.delete('stock'); setParams(params, { replace: true }); }
  }, [slabsQ.data]);

  const stockOf = (it: Item) => (branchFilter === 'all' ? it.stock : it.stockByBranch[branchFilter] ?? 0);
  const counts = { Goods: items.filter((i) => i.type === 'Goods').length, Services: items.filter((i) => i.type === 'Services').length };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (tab === 'stock') return [];
    return items
      .filter((i) => i.type === tab)
      .filter((i) => !s || [i.name, i.sku, i.barcode, i.hsn].some((v) => v.toLowerCase().includes(s)))
      .filter((i) => taxFilter === 'all' || i.taxSlabId === taxFilter)
      .filter((i) => tab === 'Services' || stockFilter === 'all' || (stockFilter === 'out' ? stockOf(i) <= 0 : stockOf(i) <= i.reorderLevel));
  }, [items, tab, q, taxFilter, stockFilter, branchFilter]);
  const pg = usePagination(rows, 10);

  /* ---------- validation ---------- */
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const errs = {
    name: !draft.name.trim() ? 'Item name is required' : '',
    cost: !(num(draft.cost) >= 0) ? 'Enter base cost' : '',
    sp1: !(num(draft.sp1) > 0) ? 'Required' : '',
    sp2: !(num(draft.sp2) > 0) ? 'Required' : '',
    sp3: !(num(draft.sp3) > 0) ? 'Required' : '',
    barcode: draft.barcode && items.some((i) => i.barcode === draft.barcode && i.id !== modal?.id) ? 'Barcode already assigned to another item' : '',
    sku: draft.sku && items.some((i) => i.sku.toLowerCase() === draft.sku.toLowerCase() && i.id !== modal?.id) ? 'SKU already exists' : '',
    taxSlabId: !draft.taxSlabId ? 'Select a tax slab' : '',
    hsn: draft.hsn && !/^\d{2,8}$/.test(draft.hsn) ? 'HSN/SAC must be 2–8 digits' : '',
  };
  const invalid = Object.values(errs).some(Boolean);
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const belowCost = (['sp1', 'sp2', 'sp3'] as const).filter((k) => num(draft[k]) > 0 && num(draft[k]) < num(draft.cost));

  const save = (another = false) => {
    setTouched(true);
    setServerErr({});
    if (invalid) return;
    const body: Record<string, unknown> = {
      type: draft.type, name: draft.name.trim(), sku: draft.sku.trim(), barcode: draft.barcode, unit: draft.unit, hsn: draft.hsn, cost: num(draft.cost),
      sp1: num(draft.sp1), sp2: num(draft.sp2), sp3: num(draft.sp3), taxSlabId: draft.taxSlabId, reorderLevel: Number(draft.reorderLevel || 0),
      trackBatches: draft.type === 'Goods' && draft.trackBatches, description: draft.description,
    };
    const onError = (err: Error) => { const f = fieldErrors(err); setServerErr(f); toast('error', Object.keys(f).length ? 'Please fix the highlighted fields' : err.message); };
    if (modal?.mode === 'edit') {
      updateItem.mutate({ id: modal.id!, body }, { onSuccess: (it) => { toast('success', 'Item updated', it.name); setModal(null); }, onError });
    } else {
      createItem.mutate(
        { ...body, openingStock: draft.type === 'Goods' ? Math.max(0, Number(draft.openingStock || 0)) : 0, branchId: draft.branchId || null, batchNo: draft.batchNo || undefined, expiryDate: draft.expiryDate || undefined },
        {
          onSuccess: (it) => {
            toast('success', 'Item created', it.name);
            sv.setFilters({ tab: it.type });
            if (another) { setDraft(blank(it.type, it.taxSlabId, draft.branchId)); setTouched(false); } else setModal(null);
          },
          onError,
        },
      );
    }
  };

  /* ---------- inline editing ---------- */
  const commitInline = () => {
    if (!editing) return;
    const { id, key, value } = editing;
    setEditing(null);
    const it = items.find((i) => i.id === id);
    if (!it || String(it[key] ?? '') === value) return;
    if (NUMERIC.includes(key)) {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n < 0 || (key.startsWith('sp') && n === 0)) return toast('error', 'Invalid value', key.startsWith('sp') ? 'Selling price must be greater than 0.' : 'Enter a non-negative number.');
      updateItem.mutate({ id, body: { [key]: n } }, { onError: (err) => toast('error', err.message) });
    } else {
      if (key === 'name' && !value.trim()) return;
      updateItem.mutate({ id, body: { [key]: value.trim() } }, { onError: (err) => toast('error', err.message) });
    }
  };

  // Plain render function (not a component) so the input keeps focus across re-renders.
  const cell = (it: Item, k: EditableKey, fmt?: (v: number) => string) => {
    const raw = it[k] as string | number | null;
    if (!canWrite || raw === null) return fmt && typeof raw === 'number' ? fmt(raw) : raw ?? <span className="muted">—</span>;
    if (editing?.id === it.id && editing.key === k) {
      const isNum = NUMERIC.includes(k);
      return (
        <input className={`cell-input ${isNum ? 'num' : ''}`} autoFocus type={isNum ? 'number' : 'text'} value={editing.value} aria-label={`Edit ${k}`}
          onChange={(ev) => setEditing({ ...editing, value: ev.target.value })} onBlur={commitInline}
          onKeyDown={(ev) => { if (ev.key === 'Enter') commitInline(); if (ev.key === 'Escape') setEditing(null); }} />
      );
    }
    return (
      <span className="cell-edit" title="Click to edit" role="button" tabIndex={0} onClick={() => setEditing({ id: it.id, key: k, value: String(raw) })} onKeyDown={(ev) => ev.key === 'Enter' && setEditing({ id: it.id, key: k, value: String(raw) })}>
        {fmt && typeof raw === 'number' ? fmt(raw) : raw === '' ? <span className="muted">—</span> : raw}
      </span>
    );
  };

  const handleScan = (code: string) => {
    const found = items.find((i) => i.barcode === code);
    setScan('');
    if (found) {
      sv.setFilters({ tab: found.type, q: found.barcode });
      setFlash(found.id);
      setTimeout(() => setFlash(''), 1800);
      toast('info', 'Item found', `${found.name} · ${money(found.sp1)} · ${found.stock} in stock`);
    } else if (canWrite) {
      toast('info', 'New barcode detected', 'Fill in the details to create this item.');
      openNew('Goods', code);
    } else toast('error', 'No item with that barcode', code);
  };

  const margin = (sp: number, cost: number | null) => (cost === null ? null : sp > 0 ? Math.round(((sp - cost) / sp) * 100) : 0);
  const allOnPage = pg.slice.length > 0 && pg.slice.every((i) => selected.has(i.id));
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="page">
      <PageHeader
        title="Items"
        subtitle="Goods and services you sell, with tiered pricing and branch-wise stock."
        actions={
          <>
            <div className="input-group" style={{ width: 280 }}>
              <span className="lead" style={{ color: 'var(--brand-600)' }}><ScanBarcode size={16} /></span>
              <input className="input" style={{ height: 38 }} placeholder="Quick scan: look up or add by barcode" value={scan} onChange={(ev) => setScan(ev.target.value.trim())} onKeyDown={(ev) => ev.key === 'Enter' && scan && handleScan(scan)} aria-label="Quick barcode scan" />
            </div>
            <button className="btn btn-secondary" onClick={() => download('/shop/items/export.csv', 'items.csv').catch((err) => toast('error', err.message))}><Download size={15} /> Export</button>
            {canWrite && <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>}
            {canWrite && <button className="btn btn-primary" onClick={() => openNew()} title="Alt I"><Plus size={16} /> New Item</button>}
          </>
        }
      />

      <div className="card">
        <div className="row between" style={{ padding: '14px 16px 0', flexWrap: 'wrap', gap: 10 }}>
          <Segmented
            value={tab}
            onChange={(v) => { sv.setFilters({ tab: v, stock: 'all' }); pg.setPage(1); setSelected(new Set()); }}
            options={[
              { value: 'Goods', label: <>Goods <span className="chip" style={{ marginLeft: 2 }}>{counts.Goods}</span></>, icon: Package },
              { value: 'Services', label: <>Services <span className="chip" style={{ marginLeft: 2 }}>{counts.Services}</span></>, icon: Wrench },
              { value: 'stock', label: 'Stock & alerts', icon: Boxes },
            ]}
          />
          {tab !== 'stock' && <SavedViewsMenu sv={sv} isActive={(f) => JSON.stringify(f) === JSON.stringify(sv.filters)} />}
        </div>

        {tab === 'stock' ? <StockAlerts onOpen={(id) => { const it = items.find((i) => i.id === id); if (it) setStockItem(it); }} /> : (
          <>
            <div className="toolbar">
              <div className="toolbar-left">
                <SearchInput value={q} onChange={(v) => { sv.setFilters({ q: v }); pg.setPage(1); }} placeholder="Search name, SKU, barcode, HSN…" />
                <select className="select" value={taxFilter} onChange={(ev) => sv.setFilters({ tax: ev.target.value })} aria-label="Tax slab filter">
                  <option value="all">All tax slabs</option>
                  {slabs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {tab === 'Goods' && (
                  <>
                    <select className="select" value={stockFilter} onChange={(ev) => sv.setFilters({ stock: ev.target.value as typeof stockFilter })} aria-label="Stock filter">
                      <option value="all">All stock levels</option>
                      <option value="low">At / below reorder level</option>
                      <option value="out">Out of stock</option>
                    </select>
                    {branches.length > 1 && (
                      <select className="select" value={branchFilter} onChange={(ev) => sv.setFilters({ branch: ev.target.value })} aria-label="Branch">
                        <option value="all">All branches</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </>
                )}
              </div>
              {canWrite && <div className="toolbar-right small muted"><Pencil size={13} /> Click a value to edit it</div>}
            </div>

            {selected.size > 0 && (
              <div className="bulk-bar">
                {selected.size} selected
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/app/items/labels?ids=${[...selected].join(',')}`)}><Tag size={14} /> Print barcode labels</button>
                {canWrite && (
                  <>
                    <select className="select" style={{ height: 32, width: 170 }} value={bulkTax} onChange={(ev) => setBulkTax(ev.target.value)} aria-label="New tax slab">
                      <option value="">Change tax slab…</option>
                      {activeSlabs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="btn btn-secondary btn-sm" disabled={!bulkTax} onClick={() => bulk.mutate({ ids: [...selected], action: 'setTax', taxSlabId: bulkTax }, { onSuccess: () => { setSelected(new Set()); setBulkTax(''); } })}>Apply</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => bulk.mutate({ ids: [...selected], action: 'archive' }, { onSuccess: () => setSelected(new Set()) })}><Archive size={14} /> Archive</button>
                  </>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}><X size={14} /> Clear</button>
              </div>
            )}

            <div className="table-wrap">
              {itemsQ.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 240 }} /></div> : rows.length === 0 ? (
                <EmptyState icon={tab === 'Goods' ? Package : Wrench} title={items.some((i) => i.type === tab) ? 'No items match your filters' : `No ${tab.toLowerCase()} yet`}
                  text={tab === 'Goods' ? 'Scan a barcode, import a CSV, or add your first product.' : 'Add services like repairs, installation or AMC.'}
                  action={canWrite && <button className="btn btn-primary" onClick={() => openNew()}><Plus size={15} /> New Item</button>} />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}><input type="checkbox" className="checkbox" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); pg.slice.forEach((i) => (allOnPage ? n.delete(i.id) : n.add(i.id))); return n; })} aria-label="Select all on page" /></th>
                      <th>Item</th><th>SKU</th>
                      {me.can('items.cost') && <th className="num">Base cost</th>}
                      <th className="num">SP1 · Standard</th><th className="num">SP2 · Loyal</th><th className="num">SP3 · New</th><th>Tax</th>
                      {tab === 'Goods' && <th className="num">Stock</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pg.slice.map((it) => {
                      const st = stockOf(it);
                      return (
                        <tr key={it.id} style={flash === it.id ? { background: 'var(--brand-50)' } : undefined}>
                          <td><input type="checkbox" className="checkbox" checked={selected.has(it.id)} onChange={() => toggleSel(it.id)} aria-label={`Select ${it.name}`} /></td>
                          <td>
                            <div className="name-cell">
                              <span className={`stat-icon ${it.type === 'Goods' ? 'tone-blue' : 'tone-violet'}`} style={{ width: 34, height: 34 }}>{it.type === 'Goods' ? <Package size={16} /> : <Wrench size={16} />}</span>
                              <div>
                                <div className="title">{cell(it, 'name')}</div>
                                <div className="sub">{it.barcode ? <span className="row" style={{ gap: 4 }}><ScanBarcode size={12} /> {it.barcode}</span> : it.hsn ? `${it.type === 'Goods' ? 'HSN' : 'SAC'} ${it.hsn}` : 'No barcode'}{it.trackBatches && ' · batches'}</div>
                              </div>
                            </div>
                          </td>
                          <td>{cell(it, 'sku')}</td>
                          {me.can('items.cost') && <td className="num">{cell(it, 'cost', money)}</td>}
                          {(['sp1', 'sp2', 'sp3'] as const).map((k, i) => {
                            const m = margin(it[k], it.cost);
                            return <td key={k} className={`num ${i === 0 ? 'strong' : ''}`}>{cell(it, k, money)}{m !== null && <div className="muted" style={m < 0 ? { color: 'var(--red-600)' } : undefined}>{m}%{i === 0 ? ' margin' : ''}</div>}</td>;
                          })}
                          <td><Badge tone="gray" plain>{it.taxRate}%</Badge></td>
                          {tab === 'Goods' && (
                            <td className="num">
                              <button className="cell-edit" style={{ border: 'none', background: 'none', font: 'inherit', fontWeight: 600, color: 'var(--ink-900)' }} onClick={() => setStockItem(it)} title="Stock details">{st} <span className="muted" style={{ fontWeight: 400 }}>{it.unit}</span></button>
                              <div>{st <= 0 ? <Badge tone="red">Out</Badge> : st <= it.reorderLevel ? <Badge tone="amber">Low</Badge> : null}</div>
                            </td>
                          )}
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {it.type === 'Goods' && <button className="icon-btn" title="Stock, batches & history" onClick={() => setStockItem(it)}><Boxes size={15} /></button>}
                            {canWrite && <button className="icon-btn" title="Edit" onClick={() => openEdit(it)}><Pencil size={15} /></button>}
                            {canWrite && <button className="icon-btn danger" title="Archive" onClick={() => setDel(it)}><Trash2 size={15} /></button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <Pagination {...pg} />
          </>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} size="lg" title={modal?.mode === 'edit' ? 'Edit item' : 'New item'} subtitle="Scan the product barcode to start — scanners type the code and press Enter automatically."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            {modal?.mode === 'new' && <button className="btn btn-secondary" disabled={createItem.isPending} onClick={() => save(true)}>Save &amp; add another</button>}
            <button className="btn btn-primary" disabled={createItem.isPending || updateItem.isPending} onClick={() => save()}>{(createItem.isPending || updateItem.isPending) && <Loader2 size={15} className="spin" />} {modal?.mode === 'edit' ? 'Save changes' : 'Save item'}</button>
          </>
        }>
        <div className="row between" style={{ marginBottom: 18 }}>
          <Segmented value={draft.type} onChange={(v) => setDraft({ ...draft, type: v, unit: v === 'Goods' ? 'pcs' : 'job' })} options={[{ value: 'Goods', label: 'Goods', icon: Package }, { value: 'Services', label: 'Service', icon: Wrench }]} />
          <span className="small muted">{modal?.mode === 'new' ? `Added ${fmtDate(todayISO())}` : ''}</span>
        </div>
        <div className="form-grid">
          <Field label="Barcode" className="span-all" error={e('barcode')} hint="Autofocused — scan now, or use the camera button.">
            <BarcodeInput value={draft.barcode} autoFocus={!!modal} invalid={!!e('barcode')} onChange={(v) => setDraft((d) => ({ ...d, barcode: v }))}
              onScan={(code) => { const existing = items.find((i) => i.barcode === code && i.id !== modal?.id); if (existing) toast('error', 'Barcode already in use', existing.name); else document.getElementById('item-name')?.focus(); }} />
          </Field>
          <Field label="Item name" required error={e('name')} className="span-all">
            <input id="item-name" className={`input ${e('name') ? 'invalid' : ''}`} value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} placeholder={draft.type === 'Goods' ? 'e.g. Logitech M331 Silent Mouse' : 'e.g. Laptop Servicing'} />
          </Field>
          <Field label="SKU" error={e('sku')}><input className={`input ${e('sku') ? 'invalid' : ''}`} value={draft.sku} onChange={(ev) => setDraft({ ...draft, sku: ev.target.value })} placeholder="e.g. LOG-M331" /></Field>
          <Field label={draft.type === 'Goods' ? 'HSN code' : 'SAC code'} error={e('hsn')} hint="Needed for GSTR-1 HSN summary"><input className={`input ${e('hsn') ? 'invalid' : ''}`} value={draft.hsn} onChange={(ev) => setDraft({ ...draft, hsn: ev.target.value.replace(/\D/g, '') })} placeholder={draft.type === 'Goods' ? '8471' : '9987'} maxLength={8} /></Field>
          <Field label="Unit">
            <select className="select" value={draft.unit} onChange={(ev) => setDraft({ ...draft, unit: ev.target.value })}>
              {(draft.type === 'Goods' ? ['pcs', 'nos', 'box', 'kg', 'g', 'ltr', 'mtr', 'ream', 'dozen'] : ['job', 'hour', 'day', 'month', 'year']).map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Tax slab" required error={e('taxSlabId')} hint="Managed in the platform Tax Lab">
            <select className={`select ${e('taxSlabId') ? 'invalid' : ''}`} value={draft.taxSlabId} onChange={(ev) => setDraft({ ...draft, taxSlabId: ev.target.value })}>
              {activeSlabs.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.rate}%)</option>)}
            </select>
          </Field>
        </div>

        <div className="section-title mt-24">Cost &amp; pricing tiers</div>
        <div className="form-grid">
          <Field label="Base cost" required error={e('cost')} hint="Your purchase cost per unit">
            <div className="input-addon"><span>₹</span><input className={`input ${e('cost') ? 'invalid' : ''}`} type="number" min={0} value={draft.cost} onChange={(ev) => setDraft({ ...draft, cost: ev.target.value })} placeholder="10.00" /></div>
          </Field>
          {draft.type === 'Goods' ? (
            <Field label="Reorder level" hint="Alert when total stock falls to this level">
              <div className="input-addon"><span>{draft.unit}</span><input className="input" type="number" min={0} value={draft.reorderLevel} onChange={(ev) => setDraft({ ...draft, reorderLevel: ev.target.value })} /></div>
            </Field>
          ) : <div />}
        </div>
        <div className="form-grid cols-3" style={{ marginTop: 16 }}>
          {([['sp1', 'SP1 (Standard)', 'Walk-in / regular price'], ['sp2', 'SP2 (Loyal)', 'Repeat & loyal customers'], ['sp3', 'SP3 (New)', 'First-time / promotional']] as const).map(([k, label, hint]) => {
            const m = margin(num(draft[k]), num(draft.cost) || 0) ?? 0;
            return (
              <Field key={k} label={label} required error={e(k)} hint={num(draft[k]) > 0 && num(draft.cost) >= 0 ? <span className="row" style={{ gap: 4, color: m < 0 ? 'var(--red-600)' : 'var(--green-700)' }}><TrendingUp size={12} /> {m}% margin</span> : hint}>
                <div className="input-addon"><span>₹</span><input className={`input ${e(k) ? 'invalid' : ''}`} type="number" min={0} value={draft[k]} onChange={(ev) => setDraft({ ...draft, [k]: ev.target.value })} /></div>
              </Field>
            );
          })}
        </div>
        {belowCost.length > 0 && (
          <div className="row small" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--amber-50)', color: 'var(--amber-700)', gap: 8 }}>
            <AlertTriangle size={15} /> {belowCost.map((k) => k.toUpperCase()).join(', ')} {belowCost.length > 1 ? 'are' : 'is'} below base cost — you’ll sell at a loss.
          </div>
        )}

        {draft.type === 'Goods' && (
          <>
            <div className="section-title mt-24">Stock</div>
            <div className="row between" style={{ marginBottom: 14 }}>
              <div><div className="strong">Track batches &amp; expiry</div><div className="small muted">For medicines, food and other perishables. Sales use first-expiry-first-out automatically.</div></div>
              <Toggle checked={draft.trackBatches} onChange={(v) => setDraft({ ...draft, trackBatches: v })} />
            </div>
            {modal?.mode === 'new' && (
              <div className="form-grid">
                <Field label="Opening stock"><div className="input-addon"><span>{draft.unit}</span><input className="input" type="number" min={0} value={draft.openingStock} onChange={(ev) => setDraft({ ...draft, openingStock: ev.target.value })} placeholder="0" /></div></Field>
                <Field label="At branch"><select className="select" value={draft.branchId} onChange={(ev) => setDraft({ ...draft, branchId: ev.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
                {draft.trackBatches && (
                  <>
                    <Field label="Batch number"><input className="input" value={draft.batchNo} onChange={(ev) => setDraft({ ...draft, batchNo: ev.target.value })} placeholder="e.g. B2410" /></Field>
                    <Field label="Expiry date"><input className="input" type="date" value={draft.expiryDate} onChange={(ev) => setDraft({ ...draft, expiryDate: ev.target.value })} /></Field>
                  </>
                )}
              </div>
            )}
            {modal?.mode === 'edit' && <p className="small muted">Change stock from the <Boxes size={12} style={{ verticalAlign: -2 }} /> stock panel (adjustments and transfers keep a full history).</p>}
          </>
        )}
        <Field label="Description" className="mt-16">
          <textarea className="textarea" value={draft.description} onChange={(ev) => setDraft({ ...draft, description: ev.target.value })} placeholder="Internal notes (optional)" />
        </Field>
      </Modal>

      {stockItem && <StockDrawer item={items.find((i) => i.id === stockItem.id) ?? stockItem} onClose={() => setStockItem(null)} canWrite={canWrite} />}

      <CsvImport open={importOpen} onClose={() => setImportOpen(false)} endpoint="/shop/items/import" title="Import items" template={ITEM_TEMPLATE} invalidate={['items', 'stockAlerts']} />

      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Archive item?" confirmLabel="Archive"
        text={<>“{del?.name}” will be hidden from your catalogue and billing. Past invoices keep their details.</>} onConfirm={() => archive.mutate(del!.id)} />
    </div>
  );
}

function StockAlerts({ onOpen }: { onOpen: (itemId: string) => void }) {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useStockAlerts(days);
  return (
    <div className="grid-2" style={{ padding: 16, alignItems: 'start' }}>
      <div className="card" style={{ boxShadow: 'none' }}>
        <div className="card-header"><div><h3>Reorder now</h3><p>Total stock at or below the item’s reorder level</p></div></div>
        <div className="table-wrap">
          {isLoading ? <div className="skeleton" style={{ height: 120, margin: 16 }} /> : data?.lowStock.length ? (
            <table className="table"><thead><tr><th>Item</th><th className="num">Stock</th><th className="num">Reorder at</th></tr></thead>
              <tbody>{data.lowStock.map((r) => <tr key={r.itemId} className="clickable" onClick={() => onOpen(r.itemId)}><td className="strong">{r.name}</td><td className="num" style={{ color: r.stock <= 0 ? 'var(--red-600)' : 'var(--amber-700)', fontWeight: 700 }}>{r.stock} {r.unit}</td><td className="num muted">{r.reorderLevel}</td></tr>)}</tbody></table>
          ) : <EmptyState icon={Boxes} title="Stock looks healthy" text="No items are at their reorder level." />}
        </div>
      </div>
      <div className="card" style={{ boxShadow: 'none' }}>
        <div className="card-header">
          <div><h3>Expiring batches</h3><p>Batch-tracked stock expiring soon</p></div>
          <select className="select" style={{ width: 140, height: 34 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Expiry window">{[7, 30, 60, 90].map((d) => <option key={d} value={d}>Next {d} days</option>)}</select>
        </div>
        <div className="table-wrap">
          {data?.expiring.length ? (
            <table className="table"><thead><tr><th>Item</th><th>Batch</th><th>Expires</th><th className="num">Qty</th></tr></thead>
              <tbody>{data.expiring.map((r) => <tr key={r.itemId + r.batchNo + r.branch} className="clickable" onClick={() => onOpen(r.itemId)}><td className="strong">{r.name}<div className="muted">{r.branch}</div></td><td><span className="chip mono">{r.batchNo}</span></td><td style={{ color: r.expiryDate < todayISO() ? 'var(--red-600)' : 'var(--amber-700)', fontWeight: 600 }}>{fmtDate(r.expiryDate)}</td><td className="num">{r.qty}</td></tr>)}</tbody></table>
          ) : !isLoading && <EmptyState icon={CalendarClock} title="Nothing expiring" text={`No batches expire in the next ${days} days.`} />}
        </div>
      </div>
    </div>
  );
}

function StockDrawer({ item, onClose, canWrite }: { item: Item; onClose: () => void; canWrite: boolean }) {
  const branches = useBranches().data ?? [];
  const { data, isLoading } = useMovements(item.id);
  const [mode, setMode] = useState<'none' | 'adjust' | 'transfer'>('none');
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? '', toBranchId: branches[1]?.id ?? '', qty: '', dir: 'in' as 'in' | 'out', note: '', batchNo: '', expiryDate: '' });
  const keys = [['items'], ['movements'], ['stockAlerts'], ['notifications'], ['dashboard']];
  const adjust = useMut((b: Record<string, unknown>) => api.post<Item>(`/shop/items/${item.id}/adjust`, b), keys, { success: 'Stock adjusted' });
  const transfer = useMut((b: Record<string, unknown>) => api.post<Item>('/shop/stock/transfer', b), keys, { success: 'Stock transferred' });
  useEffect(() => { if (!form.branchId && branches[0]) setForm((f) => ({ ...f, branchId: branches[0]!.id, toBranchId: branches[1]?.id ?? '' })); }, [branches, form.branchId]);

  const submit = () => {
    const qty = Number(form.qty);
    if (!(qty > 0)) return;
    if (mode === 'adjust') adjust.mutate({ branchId: form.branchId, qty: form.dir === 'in' ? qty : -qty, note: form.note || 'Manual adjustment', batchNo: form.batchNo || undefined, expiryDate: form.expiryDate || undefined }, { onSuccess: () => { setMode('none'); setForm((f) => ({ ...f, qty: '', note: '' })); } });
    else transfer.mutate({ itemId: item.id, fromBranchId: form.branchId, toBranchId: form.toBranchId, qty, note: form.note }, { onSuccess: () => { setMode('none'); setForm((f) => ({ ...f, qty: '', note: '' })); } });
  };

  return (
    <>
      <div className="overlay" style={{ padding: 0 }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Stock for ${item.name}`}>
        <div className="drawer-head">
          <div><h3 style={{ fontSize: 17 }}>{item.name}</h3><p className="small muted">{item.sku || 'No SKU'} · reorder at {item.reorderLevel} {item.unit}</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, branches.length + 1)}, 1fr)`, gap: 10 }}>
            <div className="card" style={{ padding: 12, boxShadow: 'none', background: 'var(--brand-50)' }}><div className="small muted">Total</div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-900)' }}>{item.stock} <span className="small muted">{item.unit}</span></div></div>
            {branches.map((b) => <div key={b.id} className="card" style={{ padding: 12, boxShadow: 'none' }}><div className="small muted">{b.name}</div><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-900)' }}>{item.stockByBranch[b.id] ?? 0}</div></div>)}
          </div>
          {canWrite && (
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className={`btn btn-sm ${mode === 'adjust' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode(mode === 'adjust' ? 'none' : 'adjust')}><SlidersHorizontal size={14} /> Adjust stock</button>
              {branches.length > 1 && <button className={`btn btn-sm ${mode === 'transfer' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode(mode === 'transfer' ? 'none' : 'transfer')}><ArrowLeftRight size={14} /> Transfer</button>}
            </div>
          )}
          {mode !== 'none' && (
            <div className="card" style={{ padding: 14, marginTop: 12, boxShadow: 'none', background: 'var(--ink-50)' }}>
              <div className="form-grid">
                {mode === 'adjust' && <Field label="Direction" className="span-all"><Segmented value={form.dir} onChange={(v) => setForm({ ...form, dir: v })} options={[{ value: 'in', label: 'Add stock' }, { value: 'out', label: 'Remove (damage, loss…)' }]} /></Field>}
                <Field label={mode === 'transfer' ? 'From branch' : 'Branch'}><select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({item.stockByBranch[b.id] ?? 0})</option>)}</select></Field>
                {mode === 'transfer' ? <Field label="To branch"><select className="select" value={form.toBranchId} onChange={(e) => setForm({ ...form, toBranchId: e.target.value })}>{branches.filter((b) => b.id !== form.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field> : <div />}
                <Field label="Quantity" required><input className="input" type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} autoFocus /></Field>
                <Field label="Reason / note" required={mode === 'adjust'}><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={mode === 'adjust' ? 'e.g. Stock count correction' : 'Optional'} /></Field>
                {mode === 'adjust' && form.dir === 'in' && item.trackBatches && (
                  <>
                    <Field label="Batch number"><input className="input" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} /></Field>
                    <Field label="Expiry date"><input className="input" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></Field>
                  </>
                )}
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('none')}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={!(Number(form.qty) > 0) || (mode === 'adjust' && !form.note.trim()) || adjust.isPending || transfer.isPending} onClick={submit}>Save</button>
              </div>
            </div>
          )}

          {item.trackBatches && (
            <>
              <div className="section-title mt-24">Batches</div>
              {data?.batches.length ? (
                <table className="table"><thead><tr><th>Batch</th><th>Branch</th><th>Expiry</th><th className="num">Qty</th></tr></thead>
                  <tbody>{data.batches.map((b) => <tr key={b.id}><td><span className="chip mono">{b.batchNo}</span></td><td className="muted">{b.branch}</td><td style={b.expiryDate && b.expiryDate < todayISO() ? { color: 'var(--red-600)', fontWeight: 600 } : undefined}>{b.expiryDate ? fmtDate(b.expiryDate) : '—'}</td><td className="num strong">{b.qty}</td></tr>)}</tbody></table>
              ) : <p className="small muted">No batch stock.</p>}
            </>
          )}

          <div className="section-title mt-24">Movement history</div>
          {isLoading ? <div className="skeleton" style={{ height: 120 }} /> : (
            <div className="timeline">
              {(data?.movements ?? []).map((m) => (
                <div key={m.id} className="timeline-item">
                  <div className="row between">
                    <strong style={{ color: 'var(--ink-900)', fontSize: 13 }}>{REASON_LABEL[m.reason] ?? m.reason}</strong>
                    <span style={{ fontWeight: 700, color: m.qty > 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
                  </div>
                  <div className="small muted">{new Date(m.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {m.branch} · {m.user}{m.note ? ` · ${m.note}` : ''}{m.batchNo ? ` · batch ${m.batchNo}` : ''}</div>
                </div>
              ))}
              {data?.movements.length === 0 && <p className="small muted">No movements yet.</p>}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
