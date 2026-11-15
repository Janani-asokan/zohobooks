import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useClickOutside } from './useClickOutside';

/** A button that opens a small dropdown menu; children get `close` to call after picking. */
export function Menu({ label, icon: Icon, children, primary, onOpen, align }: { label: string; icon: LucideIcon; children: (close: () => void) => ReactNode; primary?: boolean; onOpen?: () => void; align?: 'right' }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { if (!open) onOpen?.(); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open}><Icon size={15} /> {label} <ChevronDown size={14} /></button>
      {open && <div className="dropdown" role="menu" style={align === 'right' ? { right: 0, left: 'auto' } : undefined}>{children(close)}</div>}
    </div>
  );
}
