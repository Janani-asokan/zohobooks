import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { useCustomers, useInvoices, useItems, useVendors } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { Thumb } from '@/components/kit';
import { money } from '@/lib/format';

export interface PaletteAction { label: string; icon: LucideIcon; to: string; group: string; keywords?: string; meta?: string }

/** Ctrl+K: jump anywhere, create anything, or find any record. */
export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: PaletteAction[] }) {
  const navigate = useNavigate();
  const me = useShopUser();
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useItems();
  const customers = useCustomers();
  const invoices = useInvoices();
  const vendors = useVendors(me.can('purchases.read'));

  useEffect(() => {
    if (open) {
      setQ('');
      setHl(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  type Row = { key: string; group: string; label: string; meta?: string; to: string; icon?: LucideIcon; thumb?: { name: string; image?: string } };
  const results = useMemo<Row[]>(() => {
    const s = q.trim().toLowerCase();
    const match = (...v: Array<string | undefined>) => !s || v.some((x) => x?.toLowerCase().includes(s));
    const acts: Row[] = actions.filter((a) => match(a.label, a.keywords, a.group)).map((a) => ({ key: 'a' + a.to + a.label, group: a.group, label: a.label, meta: a.meta, to: a.to, icon: a.icon }));
    if (!s) return acts;
    const recs: Row[] = [
      ...(items.data ?? []).filter((i) => match(i.name, i.sku, i.barcode, i.category, i.brand)).slice(0, 5)
        .map((i) => ({ key: 'i' + i.id, group: 'Items', label: i.name, meta: `${money(i.sp1)}${i.type === 'Goods' ? ` · ${i.stock} ${i.unit}` : ''}`, to: `/app/items?open=${i.id}`, thumb: { name: i.name, image: i.image } })),
      ...(customers.data ?? []).filter((c) => match(c.name, c.companyName, c.customId, c.phone, c.email, c.gstin)).slice(0, 5)
        .map((c) => ({ key: 'c' + c.id, group: 'Customers', label: c.companyName || c.name, meta: c.customId, to: `/app/sales/customers?q=${encodeURIComponent(c.customId)}`, thumb: { name: c.companyName || c.name } })),
      ...(invoices.data ?? []).filter((i) => match(i.number ?? 'draft', i.customer.companyName, i.customer.name)).slice(0, 5)
        .map((i) => ({ key: 'v' + i.id, group: 'Invoices', label: `${i.number ?? 'Draft'} · ${i.customer.companyName || i.customer.name}`, meta: money(i.total), to: `/app/sales/invoices/${i.id}` })),
      ...(vendors.data ?? []).filter((v) => match(v.name, v.gstin, v.phone)).slice(0, 4)
        .map((v) => ({ key: 'd' + v.id, group: 'Vendors', label: v.name, meta: v.payable ? `${money(v.payable)} due` : undefined, to: '/app/purchases/vendors', thumb: { name: v.name } })),
    ];
    return [...recs, ...acts];
  }, [q, actions, items.data, customers.data, invoices.data, vendors.data]);

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.hl')?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  if (!open) return null;
  const go = (to: string) => { navigate(to); onClose(); };

  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={18} className="muted" />
          <input ref={inputRef} value={q} placeholder="Search or type a command — e.g. “new bill”, “GSTR”, a customer…" aria-label="Search"
            onChange={(e) => { setQ(e.target.value); setHl(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && results[hl]) go(results[hl]!.to);
              if (e.key === 'Escape') onClose();
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="small muted" style={{ padding: 18, textAlign: 'center' }}>No results for “{q}”.</div>}
          {results.map((r, i) => (
            <div key={r.key}>
              {(i === 0 || results[i - 1]!.group !== r.group) && <div className="palette-group">{r.group}</div>}
              <button className={`palette-item ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => go(r.to)}>
                {r.thumb ? <Thumb name={r.thumb.name} image={r.thumb.image} size={30} /> : r.icon && <span className="pi-icon"><r.icon size={15} /></span>}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                {r.meta && <span className="pi-meta">{r.meta}</span>}
                {i === hl && <CornerDownLeft size={14} className="muted" style={{ marginLeft: r.meta ? 8 : 'auto' }} />}
              </button>
            </div>
          ))}
        </div>
        <div className="palette-foot small muted"><span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span><span><span className="kbd">Enter</span> to open</span><span><span className="kbd">?</span> all shortcuts</span></div>
      </div>
    </div>
  );
}
