import { useCallback, useState } from 'react';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import { useClickOutside } from './useClickOutside';

/**
 * Named filter presets per list, kept in this browser (a per-viewer convenience).
 * The current filters are also remembered between visits.
 */
export function useSavedViews<T extends Record<string, unknown>>(key: string, initial: T) {
  const storeKey = `ledgerly.views.${key}`;
  const lastKey = `ledgerly.last.${key}`;
  const read = <V,>(k: string, d: V): V => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as V) : d;
    } catch {
      return d;
    }
  };
  const [filters, setFiltersState] = useState<T>(() => ({ ...initial, ...read<Partial<T>>(lastKey, {}) }));
  const [views, setViews] = useState<Array<{ name: string; filters: T }>>(() => read(storeKey, []));
  const persist = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  const setFilters = useCallback((patch: Partial<T>) => {
    setFiltersState((f) => {
      const next = { ...f, ...patch };
      persist(lastKey, next);
      return next;
    });
  }, [lastKey]);
  const saveView = (name: string) => {
    const next = [...views.filter((v) => v.name !== name), { name, filters }];
    setViews(next);
    persist(storeKey, next);
  };
  const removeView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    persist(storeKey, next);
  };
  return { filters, setFilters, views, saveView, removeView, reset: () => setFilters(initial) };
}

export function SavedViewsMenu<T extends Record<string, unknown>>({ sv, isActive }: { sv: ReturnType<typeof useSavedViews<T>>; isActive: (f: T) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu"><Bookmark size={14} /> Saved views{sv.views.length ? ` (${sv.views.length})` : ''}</button>
      {open && (
        <div className="dropdown" style={{ left: 0, right: 'auto', width: 260 }}>
          {sv.views.length === 0 && <div className="small muted" style={{ padding: '6px 10px' }}>No saved views yet.</div>}
          {sv.views.map((v) => (
            <div key={v.name} className="row" style={{ gap: 4 }}>
              <button className="dropdown-item" style={{ flex: 1, fontWeight: isActive(v.filters) ? 700 : 500 }} onClick={() => { sv.setFilters(v.filters); close(); }}>
                <Bookmark size={14} /> {v.name}
              </button>
              <button className="icon-btn sm" aria-label={`Delete view ${v.name}`} onClick={() => sv.removeView(v.name)}><X size={13} /></button>
            </div>
          ))}
          <div className="dropdown-sep" />
          <form className="row" style={{ gap: 6, padding: '4px 6px' }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { sv.saveView(name.trim()); setName(''); } }}>
            <input className="input" style={{ height: 32 }} placeholder="Name this view" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!name.trim()}><BookmarkPlus size={14} /></button>
          </form>
        </div>
      )}
    </div>
  );
}
