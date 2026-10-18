import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Item, PriceTier } from '@/api/types';
import { money } from '@/lib/format';

const priceOf = (it: Item, tier: PriceTier) => (tier === 'SP1' ? it.sp1 : tier === 'SP2' ? it.sp2 : it.sp3);

/** Rank: exact code match, then name starts with, then anything containing the query in name, SKU, HSN or barcode. */
export function searchItems(items: Item[], query: string, limit = 50) {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored: Array<[number, Item]> = [];
  for (const it of items) {
    const name = it.name.toLowerCase();
    const codes = [it.sku, it.barcode, it.hsn].map((v) => (v ?? '').toLowerCase());
    let score = -1;
    if (codes.includes(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q) || codes.some((c) => c.includes(q))) score = 3;
    if (score >= 0) scored.push([score, it]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, it]) => it);
}

/** Combobox for choosing an item on a document line. Type to search; ↑ ↓ to move, Enter to pick, Esc to close. */
export function ItemPicker({ items, value, tier, onPick, invalid, autoFocus, branchId }: {
  items: Item[]; value: string; tier: PriceTier; onPick: (id: string) => void; invalid?: boolean; autoFocus?: boolean; branchId?: string | null;
}) {
  const selected = items.find((i) => i.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = useMemo(() => searchItems(items, query), [items, query]);

  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  useEffect(() => { setActive(0); }, [query]);
  // The list is fixed to the viewport so scrolling tables don't clip it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < 280 && r.top > 300;
      setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 360), up });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = (it: Item) => { onPick(it.id); setOpen(false); setQuery(''); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); const it = results[active]; if (it) pick(it); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(''); }
  };

  const stockOf = (it: Item) => (branchId ? it.stockByBranch[branchId] ?? 0 : it.stock);
  return (
    <div ref={wrapRef} className="combo">
      <div className={`combo-field ${invalid ? 'invalid' : ''}`}>
        <Search size={14} className="combo-icon" aria-hidden />
        <input
          ref={inputRef}
          className="combo-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Item"
          autoFocus={autoFocus}
          placeholder={selected ? selected.name : 'Search name, SKU, HSN or barcode'}
          value={open ? query : selected?.name ?? ''}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKey}
        />
        <ChevronDown size={14} className="combo-caret" aria-hidden onMouseDown={(e) => { e.preventDefault(); inputRef.current?.focus(); setOpen((o) => !o); }} />
      </div>
      {open && pos && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" className="combo-list"
          style={{ left: pos.left, width: Math.min(pos.width, window.innerWidth - pos.left - 8), ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          {results.length === 0 && <li className="combo-empty">No items match “{query}”.</li>}
          {results.map((it, i) => (
            <li
              key={it.id}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={`combo-opt ${i === active ? 'active' : ''} ${it.id === value ? 'current' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
            >
              <div className="combo-main">
                <span className="combo-name">{it.name}</span>
                <span className="combo-price">{money(priceOf(it, tier))}</span>
              </div>
              <div className="combo-meta">
                {[it.sku, it.hsn && `${it.type === 'Goods' ? 'HSN' : 'SAC'} ${it.hsn}`, it.type === 'Goods' ? `${stockOf(it)} ${it.unit} in stock` : 'Service', `${it.taxRate}% GST`].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
