import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Package, Wrench, Pencil, Trash2, ScanBarcode, AlertTriangle, TrendingUp } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Pagination, SearchInput, Segmented, usePagination } from '@/components/ui';
import { BarcodeInput } from '@/components/BarcodeInput';
import { money, todayISO, uid } from '@/lib/format';
import type { Item } from '@/lib/types';

type ItemType = Item['type'];
type Draft = Omit<Item, 'id' | 'createdAt' | 'cost' | 'sp1' | 'sp2' | 'sp3' | 'stock'> & { cost: string; sp1: string; sp2: string; sp3: string; stock: string };

const blank = (type: ItemType, taxSlabId: string, barcode = ''): Draft => ({
  type,
  name: '',
  sku: '',
  barcode,
  unit: type === 'Goods' ? 'pcs' : 'job',
  hsn: '',
  cost: '',
  sp1: '',
  sp2: '',
  sp3: '',
  taxSlabId,
  stock: '',
  description: '',
});

type EditableKey = 'name' | 'sku' | 'cost' | 'sp1' | 'sp2' | 'sp3' | 'stock';
const NUMERIC: EditableKey[] = ['cost', 'sp1', 'sp2', 'sp3', 'stock'];

export default function Items() {
  const { tenant, mutate, activeTaxSlabs, platform, taxRateOf } = useTenant();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<ItemType>('Goods');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [taxFilter, setTaxFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; id?: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank('Goods', 'tax_18'));
  const [touched, setTouched] = useState(false);
  const [del, setDel] = useState<Item | null>(null);
  const [editing, setEditing] = useState<{ id: string; key: EditableKey; value: string } | null>(null);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState('');

  const defaultSlab = activeTaxSlabs.find((s) => s.rate === 18)?.id ?? activeTaxSlabs[0]?.id ?? '';

  const openNew = (type: ItemType = tab, barcode = '') => {
    setDraft(blank(type, defaultSlab, barcode));
    setTouched(false);
    setModal({ mode: 'new' });
  };
  const openEdit = (it: Item) => {
    setDraft({ ...it, cost: String(it.cost), sp1: String(it.sp1), sp2: String(it.sp2), sp3: String(it.sp3), stock: String(it.stock) });
    setTouched(false);
    setModal({ mode: 'edit', id: it.id });
  };

  useEffect(() => {
    if (params.get('new')) {
      openNew('Goods');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []);

  const counts = { Goods: tenant.items.filter((i) => i.type === 'Goods').length, Services: tenant.items.filter((i) => i.type === 'Services').length };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenant.items
      .filter((i) => i.type === tab)
      .filter((i) => !s || [i.name, i.sku, i.barcode, i.hsn].some((v) => v.toLowerCase().includes(s)))
      .filter((i) => taxFilter === 'all' || i.taxSlabId === taxFilter)
      .filter((i) => tab === 'Services' || stockFilter === 'all' || (stockFilter === 'out' ? i.stock <= 0 : i.stock <= 10))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tenant.items, tab, q, taxFilter, stockFilter]);
  const pg = usePagination(rows, 8);

  /* ---------- validation ---------- */
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const errs = {
    name: !draft.name.trim() ? 'Item name is required' : '',
    cost: !(num(draft.cost) >= 0) ? 'Enter base cost' : '',
    sp1: !(num(draft.sp1) > 0) ? 'Required' : '',
    sp2: !(num(draft.sp2) > 0) ? 'Required' : '',
    sp3: !(num(draft.sp3) > 0) ? 'Required' : '',
    barcode: draft.barcode && tenant.items.some((i) => i.barcode === draft.barcode && i.id !== modal?.id) ? 'Barcode already assigned to another item' : '',
    sku: draft.sku && tenant.items.some((i) => i.sku.toLowerCase() === draft.sku.toLowerCase() && i.id !== modal?.id) ? 'SKU already exists' : '',
    taxSlabId: !draft.taxSlabId ? 'Select a tax slab' : '',
  };
  const invalid = Object.values(errs).some(Boolean);
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');
  const belowCost = (['sp1', 'sp2', 'sp3'] as const).filter((k) => num(draft[k]) > 0 && num(draft[k]) < num(draft.cost));

  const save = (another = false) => {
    setTouched(true);
    if (invalid) return;
    const item: Omit<Item, 'id' | 'createdAt'> = {
      ...draft,
      name: draft.name.trim(),
      sku: draft.sku.trim().toUpperCase(),
      cost: num(draft.cost),
      sp1: num(draft.sp1),
      sp2: num(draft.sp2),
      sp3: num(draft.sp3),
      stock: draft.type === 'Goods' ? Math.max(0, num(draft.stock) || 0) : 0,
    };
    if (modal?.mode === 'edit') {
      mutate((t) => {
        const i = t.items.find((x) => x.id === modal.id)!;
        Object.assign(i, item);
      });
      toast('success', 'Item updated', item.name);
      setModal(null);
    } else {
      mutate((t) => {
        t.items.unshift({ ...item, id: uid('it_'), createdAt: new Date().toISOString() });
      });
      toast('success', 'Item created', item.name);
      setTab(item.type);
      if (another) {
        setDraft(blank(item.type, item.taxSlabId));
        setTouched(false);
      } else setModal(null);
    }
  };

  /* ---------- inline editing ---------- */
  const commitInline = () => {
    if (!editing) return;
    const { id, key, value } = editing;
    if (NUMERIC.includes(key)) {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n < 0 || (key.startsWith('sp') && n === 0)) {
        toast('error', 'Invalid value', key.startsWith('sp') ? 'Selling price must be greater than 0.' : 'Enter a non-negative number.');
        return setEditing(null);
      }
      mutate((t) => void ((t.items.find((x) => x.id === id) as unknown as Record<string, number>)[key] = n));
    } else {
      if (key === 'name' && !value.trim()) return setEditing(null);
      mutate((t) => void ((t.items.find((x) => x.id === id) as unknown as Record<string, string>)[key] = key === 'sku' ? value.trim().toUpperCase() : value.trim()));
    }
    setEditing(null);
  };

  // Plain render function (not a component) so the input keeps focus across re-renders.
  const cell = (it: Item, k: EditableKey, fmt?: (v: number) => string) => {
    const isNum = NUMERIC.includes(k);
    if (editing?.id === it.id && editing.key === k) {
      return (
        <input
          className={`cell-input ${isNum ? 'num' : ''}`}
          autoFocus
          type={isNum ? 'number' : 'text'}
          value={editing.value}
          onChange={(ev) => setEditing({ ...editing, value: ev.target.value })}
          onBlur={commitInline}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') commitInline();
            if (ev.key === 'Escape') setEditing(null);
          }}
        />
      );
    }
    const raw = it[k] as string | number;
    return (
      <span className="cell-edit" title="Click to edit" onClick={() => setEditing({ id: it.id, key: k, value: String(raw) })}>
        {fmt && typeof raw === 'number' ? fmt(raw) : raw === '' ? <span className="muted">—</span> : raw}
      </span>
    );
  };

  const handleScan = (code: string) => {
    const found = tenant.items.find((i) => i.barcode === code);
    setScan('');
    if (found) {
      setTab(found.type);
      setQ(found.barcode);
      setFlash(found.id);
      setTimeout(() => setFlash(''), 1800);
      toast('info', 'Item found', `${found.name} · ${money(found.sp1)}`);
    } else {
      toast('info', 'New barcode detected', 'Fill in the details to create this item.');
      openNew('Goods', code);
    }
  };

  const margin = (sp: number, cost: number) => (sp > 0 ? Math.round(((sp - cost) / sp) * 100) : 0);

  return (
    <div className="page">
      <PageHeader
        title="Items"
        subtitle="Goods and services you sell, with tiered pricing for every customer type."
        actions={
          <>
            <div className="input-group" style={{ width: 280 }}>
              <span className="lead" style={{ color: 'var(--brand-600)' }}><ScanBarcode size={16} /></span>
              <input className="input" style={{ height: 38 }} placeholder="Quick scan: lookup or add by barcode" value={scan} onChange={(ev) => setScan(ev.target.value.trim())} onKeyDown={(ev) => ev.key === 'Enter' && scan && handleScan(scan)} />
            </div>
            <button className="btn btn-primary" onClick={() => openNew()}>
              <Plus size={16} /> New Item
            </button>
          </>
        }
      />

      <div className="card">
        <div style={{ padding: '14px 16px 0' }}>
          <Segmented
            value={tab}
            onChange={(v) => { setTab(v); pg.setPage(1); setStockFilter('all'); }}
            options={[
              { value: 'Goods', label: <>Goods <span className="chip" style={{ marginLeft: 2 }}>{counts.Goods}</span></>, icon: Package },
              { value: 'Services', label: <>Services <span className="chip" style={{ marginLeft: 2 }}>{counts.Services}</span></>, icon: Wrench },
            ]}
          />
        </div>
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search name, SKU, barcode, HSN…" />
            <select className="select" value={taxFilter} onChange={(ev) => setTaxFilter(ev.target.value)}>
              <option value="all">All tax slabs</option>
              {platform.taxSlabs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {tab === 'Goods' && (
              <select className="select" value={stockFilter} onChange={(ev) => setStockFilter(ev.target.value as typeof stockFilter)}>
                <option value="all">All stock levels</option>
                <option value="low">Low stock (≤ 10)</option>
                <option value="out">Out of stock</option>
              </select>
            )}
          </div>
          <div className="toolbar-right small muted">
            <Pencil size={13} /> Click any value to edit inline
          </div>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <EmptyState
              icon={tab === 'Goods' ? Package : Wrench}
              title={tenant.items.some((i) => i.type === tab) ? 'No items match your filters' : `No ${tab.toLowerCase()} yet`}
              text={tab === 'Goods' ? 'Scan a barcode or add your first product.' : 'Add services like repairs, installation or AMC.'}
              action={<button className="btn btn-primary" onClick={() => openNew()}><Plus size={15} /> New Item</button>}
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th className="num">Base cost</th>
                  <th className="num">SP1 · Standard</th>
                  <th className="num">SP2 · Loyal</th>
                  <th className="num">SP3 · New</th>
                  <th>Tax</th>
                  {tab === 'Goods' && <th className="num">Stock</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((it) => (
                  <tr key={it.id} style={flash === it.id ? { background: 'var(--brand-50)' } : undefined}>
                    <td>
                      <div className="name-cell">
                        <span className={`stat-icon ${it.type === 'Goods' ? 'tone-blue' : 'tone-violet'}`} style={{ width: 34, height: 34 }}>
                          {it.type === 'Goods' ? <Package size={16} /> : <Wrench size={16} />}
                        </span>
                        <div>
                          <div className="title">{cell(it, 'name')}</div>
                          <div className="sub">{it.barcode ? <span className="row" style={{ gap: 4 }}><ScanBarcode size={12} /> {it.barcode}</span> : `${it.hsn ? (it.type === 'Goods' ? 'HSN ' : 'SAC ') + it.hsn : 'No barcode'}`}</div>
                        </div>
                      </div>
                    </td>
                    <td>{cell(it, 'sku')}</td>
                    <td className="num">{cell(it, 'cost', money)}</td>
                    <td className="num strong">{cell(it, 'sp1', money)}<div className="muted">{margin(it.sp1, it.cost)}% margin</div></td>
                    <td className="num">{cell(it, 'sp2', money)}<div className="muted">{margin(it.sp2, it.cost)}%</div></td>
                    <td className="num">{cell(it, 'sp3', money)}<div className="muted">{margin(it.sp3, it.cost)}%</div></td>
                    <td><Badge tone="gray" plain>{taxRateOf(it.taxSlabId)}%</Badge></td>
                    {tab === 'Goods' && (
                      <td className="num">
                        {cell(it, 'stock')}
                        <div>{it.stock <= 0 ? <Badge tone="red">Out</Badge> : it.stock <= 10 ? <Badge tone="amber">Low</Badge> : <span className="muted">{it.unit}</span>}</div>
                      </td>
                    )}
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Edit" onClick={() => openEdit(it)}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title="Delete" onClick={() => setDel(it)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination {...pg} />
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="lg"
        title={modal?.mode === 'edit' ? 'Edit item' : 'New item'}
        subtitle="Scan the product barcode to start — scanners type the code and press Enter automatically."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            {modal?.mode === 'new' && <button className="btn btn-secondary" onClick={() => save(true)}>Save &amp; add another</button>}
            <button className="btn btn-primary" onClick={() => save()}>{modal?.mode === 'edit' ? 'Save changes' : 'Save item'}</button>
          </>
        }
      >
        <div className="row between" style={{ marginBottom: 18 }}>
          <Segmented
            value={draft.type}
            onChange={(v) => setDraft({ ...draft, type: v, unit: v === 'Goods' ? 'pcs' : 'job' })}
            options={[
              { value: 'Goods', label: 'Goods', icon: Package },
              { value: 'Services', label: 'Service', icon: Wrench },
            ]}
          />
          <span className="small muted">Added {todayISO()}</span>
        </div>

        <div className="form-grid">
          <Field label="Barcode" className="span-all" error={e('barcode')} hint="Autofocused — scan now, or use the camera button.">
            <BarcodeInput
              value={draft.barcode}
              autoFocus={!!modal}
              invalid={!!e('barcode')}
              onChange={(v) => setDraft((d) => ({ ...d, barcode: v }))}
              onScan={(code) => {
                const existing = tenant.items.find((i) => i.barcode === code && i.id !== modal?.id);
                if (existing) toast('error', 'Barcode already in use', existing.name);
                else document.getElementById('item-name')?.focus();
              }}
            />
          </Field>
          <Field label="Item name" required error={e('name')} className="span-all">
            <input id="item-name" className={`input ${e('name') ? 'invalid' : ''}`} value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} placeholder={draft.type === 'Goods' ? 'e.g. Logitech M331 Silent Mouse' : 'e.g. Laptop Servicing'} />
          </Field>
          <Field label="SKU" error={e('sku')}>
            <input className={`input ${e('sku') ? 'invalid' : ''}`} value={draft.sku} onChange={(ev) => setDraft({ ...draft, sku: ev.target.value })} placeholder="e.g. LOG-M331" />
          </Field>
          <Field label={draft.type === 'Goods' ? 'HSN code' : 'SAC code'}>
            <input className="input" value={draft.hsn} onChange={(ev) => setDraft({ ...draft, hsn: ev.target.value.replace(/\D/g, '') })} placeholder={draft.type === 'Goods' ? '8471' : '9987'} />
          </Field>
          <Field label="Unit">
            <select className="select" value={draft.unit} onChange={(ev) => setDraft({ ...draft, unit: ev.target.value })}>
              {(draft.type === 'Goods' ? ['pcs', 'box', 'kg', 'g', 'ltr', 'mtr', 'ream', 'dozen'] : ['job', 'hour', 'day', 'month', 'year']).map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Tax slab" required error={e('taxSlabId')} hint="Managed in the platform Tax Lab">
            <select className={`select ${e('taxSlabId') ? 'invalid' : ''}`} value={draft.taxSlabId} onChange={(ev) => setDraft({ ...draft, taxSlabId: ev.target.value })}>
              {activeTaxSlabs.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.rate}%)</option>)}
            </select>
          </Field>
        </div>

        <div className="section-title mt-24">Cost &amp; pricing tiers</div>
        <div className="form-grid">
          <Field label="Base cost" required error={e('cost')} hint="Your purchase cost per unit">
            <div className="input-addon"><span>₹</span><input className={`input ${e('cost') ? 'invalid' : ''}`} type="number" min={0} value={draft.cost} onChange={(ev) => setDraft({ ...draft, cost: ev.target.value })} placeholder="10.00" /></div>
          </Field>
          {draft.type === 'Goods' ? (
            <Field label="Opening stock">
              <div className="input-addon"><span>{draft.unit}</span><input className="input" type="number" min={0} value={draft.stock} onChange={(ev) => setDraft({ ...draft, stock: ev.target.value })} placeholder="0" /></div>
            </Field>
          ) : <div />}
        </div>
        <div className="form-grid cols-3" style={{ marginTop: 16 }}>
          {(
            [
              ['sp1', 'SP1 (Standard)', 'Walk-in / regular price'],
              ['sp2', 'SP2 (Loyal)', 'Repeat & loyal customers'],
              ['sp3', 'SP3 (New)', 'First-time / promotional'],
            ] as const
          ).map(([k, label, hint]) => {
            const m = margin(num(draft[k]), num(draft.cost) || 0);
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
        <Field label="Description" className="mt-16">
          <textarea className="textarea" value={draft.description} onChange={(ev) => setDraft({ ...draft, description: ev.target.value })} placeholder="Shown on invoices below the item name (optional)" />
        </Field>
      </Modal>

      <ConfirmModal
        open={!!del}
        onClose={() => setDel(null)}
        title="Delete item?"
        text={<>“{del?.name}” will be removed from your catalogue. Existing invoices keep their line details.</>}
        onConfirm={() => {
          mutate((t) => void (t.items = t.items.filter((x) => x.id !== del!.id)));
          toast('success', 'Item deleted');
        }}
      />
    </div>
  );
}
