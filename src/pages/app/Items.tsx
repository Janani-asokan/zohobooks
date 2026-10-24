import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Package, Wrench, Pencil, Trash2, ScanBarcode, Download, Upload, Boxes, Tag, ArrowLeftRight, SlidersHorizontal, X, CalendarClock, Archive, List, LayoutGrid, ExternalLink } from 'lucide-react';
import { api, download } from '@/api/client';
import { useBranches, useItemFacets, useItems, useMovements, useMut, useStockAlerts, useTaxSlabs } from '@/api/hooks';
import type { Item } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, PageHeader, Pagination, SearchInput, Segmented, usePagination } from '@/components/ui';
import { CsvImport } from '@/components/CsvImport';
import { PriceListImport } from '@/components/PriceListImport';
import { FileUp } from 'lucide-react';
import { SavedViewsMenu, useSavedViews } from '@/components/SavedViews';
import { Hint, Thumb } from '@/components/kit';
import { fmtDate, money, todayISO } from '@/lib/format';

type ItemType = Item['type'];
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

  const sv = useSavedViews('items', { tab: 'Goods' as ItemType | 'stock', q: '', tax: 'all', stock: 'all' as 'all' | 'low' | 'out', branch: 'all', category: 'all', brand: 'all' });
  const { tab, q, tax: taxFilter, stock: stockFilter, branch: branchFilter } = sv.filters;
  const catFilter = (sv.filters as { category?: string }).category ?? 'all';
  const brandFilter = (sv.filters as { brand?: string }).brand ?? 'all';
  const [del, setDel] = useState<Item | null>(null);
  const [editing, setEditing] = useState<{ id: string; key: EditableKey; value: string } | null>(null);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTax, setBulkTax] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const setStockItem = (it: Item | null) => setOpenId(it?.id ?? null);
  const [view, setView] = useState<'list' | 'grid'>(() => { try { return (localStorage.getItem('ledgerly.items.view') as 'list' | 'grid') || 'list'; } catch { return 'list'; } });
  const changeView = (v: 'list' | 'grid') => { setView(v); try { localStorage.setItem('ledgerly.items.view', v); } catch { /* ignore */ } };
  const facets = useItemFacets().data;

  const keys = [['items'], ['stockAlerts'], ['notifications'], ['dashboard'], ['movements']];
  const updateItem = useMut((v: { id: string; body: Record<string, unknown> }) => api.patch<Item>(`/shop/items/${v.id}`, v.body), keys, { silentError: true });
  const archive = useMut((id: string) => api.del(`/shop/items/${id}`), keys, { success: 'Item archived' });
  const bulk = useMut((b: { ids: string[]; action: 'archive' | 'setTax'; taxSlabId?: string }) => api.post<{ updated: number }>('/shop/items/bulk', b), keys, { success: (r, v) => (v.action === 'archive' ? `${r.updated} items archived` : `Tax slab updated on ${r.updated} items`) });

  const openNew = (type: ItemType = tab === 'Services' ? 'Services' : 'Goods', barcode = '') =>
    navigate(`/app/items/new?type=${type}${barcode ? `&barcode=${encodeURIComponent(barcode)}` : ''}`);
  const openEdit = (it: Item) => navigate(`/app/items/${it.id}/edit`);

  useEffect(() => {
    if (params.get('new') && canWrite) { navigate('/app/items/new', { replace: true }); return; }
    if (params.get('open')) { setOpenId(params.get('open')!); params.delete('open'); setParams(params, { replace: true }); }
    if (params.get('q')) { sv.setFilters({ q: params.get('q')!, tab: 'Goods' }); params.delete('q'); setParams(params, { replace: true }); }
    if (params.get('tab') === 'stock') { sv.setFilters({ tab: 'stock' }); params.delete('tab'); setParams(params, { replace: true }); }
    if (params.get('stock') === 'low') { sv.setFilters({ tab: 'Goods', stock: 'low' }); params.delete('stock'); setParams(params, { replace: true }); }
  }, [params]);

  const stockOf = (it: Item) => (branchFilter === 'all' ? it.stock : it.stockByBranch[branchFilter] ?? 0);
  const counts = { Goods: items.filter((i) => i.type === 'Goods').length, Services: items.filter((i) => i.type === 'Services').length };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (tab === 'stock') return [];
    return items
      .filter((i) => i.type === tab)
      .filter((i) => !s || [i.name, i.sku, i.barcode, i.hsn, i.category ?? '', i.brand ?? ''].some((v) => v.toLowerCase().includes(s)))
      .filter((i) => catFilter === 'all' || i.category === catFilter)
      .filter((i) => brandFilter === 'all' || i.brand === brandFilter)
      .filter((i) => taxFilter === 'all' || i.taxSlabId === taxFilter)
      .filter((i) => tab === 'Services' || stockFilter === 'all' || (stockFilter === 'out' ? stockOf(i) <= 0 : stockOf(i) <= i.reorderLevel));
  }, [items, tab, q, taxFilter, stockFilter, branchFilter, catFilter, brandFilter]);
  const tabCats = useMemo(() => { const m = new Map<string, number>(); items.filter((i) => i.type === tab && i.category).forEach((i) => m.set(i.category, (m.get(i.category) ?? 0) + 1)); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }, [items, tab]);
  const pg = usePagination(rows, view === 'grid' ? 12 : 10);

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
            {canWrite && <button className="btn btn-secondary" onClick={() => setPdfImportOpen(true)} title="Supplier price list or catalogue as PDF or photo"><FileUp size={15} /> From price list</button>}
            {canWrite && <button className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>}
            {canWrite && <button className="btn btn-primary" onClick={() => openNew()} title="Alt I"><Plus size={16} /> New Item</button>}
          </>
        }
      />

      <Hint id="items" title="Your product & service catalogue">
        <p>Add everything you sell once — it then appears on invoices, POS and purchase orders. Each item has <strong>three price levels</strong> (SP1 Standard, SP2 Loyal, SP3 New) that are picked automatically from the customer’s tier. Click any price or name in the list to edit it in place, or click the picture to see stock, batches and history.</p>
      </Hint>

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
          {tab !== 'stock' && (
            <div className="row" style={{ gap: 8 }}>
              <div className="view-toggle" role="group" aria-label="View">
                <button className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} title="List view" aria-pressed={view === 'list'}><List size={16} /></button>
                <button className={view === 'grid' ? 'active' : ''} onClick={() => changeView('grid')} title="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16} /></button>
              </div>
              <SavedViewsMenu sv={sv} isActive={(f) => JSON.stringify(f) === JSON.stringify(sv.filters)} />
            </div>
          )}
        </div>

        {tab === 'stock' ? <StockAlerts onOpen={(id) => { const it = items.find((i) => i.id === id); if (it) setStockItem(it); }} /> : (
          <>
            <div className="toolbar">
              <div className="toolbar-left">
                <SearchInput value={q} onChange={(v) => { sv.setFilters({ q: v }); pg.setPage(1); }} placeholder="Search name, SKU, barcode, HSN…" />
                {!!facets?.brands.length && (
                  <select className="select" value={brandFilter} onChange={(ev) => { sv.setFilters({ brand: ev.target.value } as never); pg.setPage(1); }} aria-label="Brand filter">
                    <option value="all">All brands</option>
                    {facets.brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
                  </select>
                )}
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
              {canWrite && view === 'list' && <div className="toolbar-right small muted"><Pencil size={13} /> Click a value to edit it</div>}
            </div>
            {tabCats.length > 0 && (
              <div className="filter-chips" role="group" aria-label="Category">
                <button className={`filter-chip ${catFilter === 'all' ? 'active' : ''}`} onClick={() => { sv.setFilters({ category: 'all' } as never); pg.setPage(1); }}>All <span className="n">{counts[tab as ItemType]}</span></button>
                {tabCats.map(([c, n]) => (
                  <button key={c} className={`filter-chip ${catFilter === c ? 'active' : ''}`} onClick={() => { sv.setFilters({ category: catFilter === c ? 'all' : c } as never); pg.setPage(1); }}>{c} <span className="n">{n}</span></button>
                ))}
              </div>
            )}

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
              ) : view === 'grid' ? (
                <div className="item-grid">
                  {pg.slice.map((it) => {
                    const st = stockOf(it);
                    return (
                      <button key={it.id} className="item-card" onClick={() => setOpenId(it.id)} style={flash === it.id ? { borderColor: 'var(--brand-500)' } : undefined}>
                        <Thumb large name={it.name} image={it.image} />
                        <div className="ic-name">{it.name}</div>
                        <div className="ic-meta">{[it.category, it.brand].filter(Boolean).join(' · ') || it.sku || (it.type === 'Goods' ? 'Goods' : 'Service')}</div>
                        <div className="ic-foot">
                          <span className="ic-price">{money(it.sp1)}</span>
                          {it.type === 'Goods' ? <span className={`stock-pill ${st <= 0 ? 'out' : st <= it.reorderLevel ? 'low' : ''}`}>{st <= 0 ? 'Out of stock' : `${st} ${it.unit}`}</span> : <span className="stock-pill" style={{ background: 'var(--violet-50)', color: 'var(--violet-600)' }}>Service</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}><input type="checkbox" className="checkbox" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); pg.slice.forEach((i) => (allOnPage ? n.delete(i.id) : n.add(i.id))); return n; })} aria-label="Select all on page" /></th>
                      <th>Item</th>
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
                              <button className="thumb-btn" onClick={() => setOpenId(it.id)} title="Open item"><Thumb name={it.name} image={it.image} /></button>
                              <div>
                                <div className="title">{cell(it, 'name')}</div>
                                <div className="sub">{[it.sku, it.category, it.barcode || (it.hsn ? `${it.type === 'Goods' ? 'HSN' : 'SAC'} ${it.hsn}` : ''), it.trackBatches ? 'batches' : ''].filter(Boolean).join(' · ') || 'No barcode'}</div>
                              </div>
                            </div>
                          </td>
                          {me.can('items.cost') && <td className="num">{cell(it, 'cost', money)}</td>}
                          {(['sp1', 'sp2', 'sp3'] as const).map((k, i) => {
                            const m = margin(it[k], it.cost);
                            return <td key={k} className={`num ${i === 0 ? 'strong' : ''}`}>{cell(it, k, money)}{m !== null && <div className="muted" style={m < 0 ? { color: 'var(--red-600)' } : undefined}>{m}%{i === 0 ? ' margin' : ''}</div>}</td>;
                          })}
                          <td><Badge tone="gray" plain>{it.taxRate}%</Badge></td>
                          {tab === 'Goods' && (
                            <td className="num">
                              <button className="cell-edit" style={{ border: 'none', background: 'none', font: 'inherit', fontWeight: 600, color: 'var(--ink-900)' }} onClick={() => setStockItem(it)} title="Stock details">{st} <span className="muted" style={{ fontWeight: 400 }}>{it.unit}</span></button>
                              <div style={{ marginTop: 4 }}><span className={`status-pill ${st <= 0 ? 'out' : st <= it.reorderLevel ? 'low' : 'ok'}`}>{st <= 0 ? 'Out of Stock' : st <= it.reorderLevel ? 'Low Stock' : 'In Stock'}</span></div>
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

      {openId && items.find((i) => i.id === openId) && <StockDrawer item={items.find((i) => i.id === openId)!} onClose={() => setOpenId(null)} canWrite={canWrite} showCost={me.can('items.cost')} onEdit={(it) => openEdit(it)} />}

      <PriceListImport open={pdfImportOpen} onClose={() => setPdfImportOpen(false)} />
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
              <tbody>{data.lowStock.map((r) => <tr key={r.itemId} className="clickable" onClick={() => onOpen(r.itemId)}><td className="strong">{r.name}</td><td className="num" style={{ color: r.stock <= 0 ? 'var(--red-600)' : 'var(--amber-700)', fontWeight: 600 }}>{r.stock} {r.unit}</td><td className="num muted">{r.reorderLevel}</td></tr>)}</tbody></table>
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

function StockDrawer({ item, onClose, canWrite, showCost, onEdit }: { item: Item; onClose: () => void; canWrite: boolean; showCost: boolean; onEdit: (it: Item) => void }) {
  const navigate = useNavigate();
  const goods = item.type === 'Goods';
  const branches = useBranches().data ?? [];
  const { data, isLoading } = useMovements(goods ? item.id : undefined);
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
      <aside className="drawer" role="dialog" aria-label={item.name}>
        <div className="drawer-head">
          <div className="detail-hero">
            <Thumb name={item.name} image={item.image} size={52} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 16 }}>{item.name}</h3>
              <p className="small muted">{[goods ? 'Goods' : 'Service', item.category, item.brand, item.sku].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {canWrite && <button className="btn btn-soft btn-sm" onClick={() => onEdit(item)}><Pencil size={14} /> Edit</button>}
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="section-title" style={{ marginTop: 0 }}>Pricing</div>
          <div className="kv">
            <div><span>SP1 · Standard</span><strong>{money(item.sp1)}</strong></div>
            <div><span>SP2 · Loyal</span><strong>{money(item.sp2)}</strong></div>
            <div><span>SP3 · New</span><strong>{money(item.sp3)}</strong></div>
            {showCost && <div><span>Cost price</span><strong>{item.cost === null ? '—' : money(item.cost)}{item.cost !== null && item.sp1 > 0 && <span className="small muted"> · {Math.round(((item.sp1 - item.cost) / item.sp1) * 100)}% margin</span>}</strong></div>}
            <div><span>GST</span><strong>{item.taxRate}%</strong></div>
            <div><span>MRP</span><strong>{item.mrp == null ? '—' : money(item.mrp)}</strong></div>
            <div><span>{goods ? 'HSN' : 'SAC'}</span><strong>{item.hsn || '—'}</strong></div>
            {goods && <div><span>Barcode</span><strong className="mono" style={{ fontSize: 13 }}>{item.barcode || '—'}</strong></div>}
          </div>
          {item.description && <p className="small muted" style={{ marginTop: 10 }}>{item.description}</p>}
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {goods && item.barcode && <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/app/items/labels?ids=${item.id}`)}><Tag size={14} /> Print labels</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/app/sales/invoices/new?item=${item.id}`)}><ExternalLink size={14} /> Sell on invoice</button>
            {goods && <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/app/purchases/orders?new=1&item=${item.id}`)}><Boxes size={14} /> Reorder</button>}
          </div>
          {!goods ? null : (<>
          <div className="section-title mt-24">Stock · reorder at {item.reorderLevel} {item.unit}</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, branches.length + 1)}, 1fr)`, gap: 10 }}>
            <div className="card" style={{ padding: 12, boxShadow: 'none', background: 'var(--brand-50)' }}><div className="small muted">Total</div><div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-900)' }}>{item.stock} <span className="small muted">{item.unit}</span></div></div>
            {branches.map((b) => <div key={b.id} className="card" style={{ padding: 12, boxShadow: 'none' }}><div className="small muted">{b.name}</div><div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-900)' }}>{item.stockByBranch[b.id] ?? 0}</div></div>)}
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
                    <span style={{ fontWeight: 600, color: m.qty > 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
                  </div>
                  <div className="small muted">{new Date(m.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {m.branch} · {m.user}{m.note ? ` · ${m.note}` : ''}{m.batchNo ? ` · batch ${m.batchNo}` : ''}</div>
                </div>
              ))}
              {data?.movements.length === 0 && <p className="small muted">No movements yet.</p>}
            </div>
          )}
          </>)}
        </div>
      </aside>
    </>
  );
}
