import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { initials } from '@/lib/format';
import { useClickOutside } from '@/components/useClickOutside';

export function ProfileMenu({ name, sub, email, children }: { name: string; sub: string; email: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="profile-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar">{initials(name)}</span>
        <span className="who">
          <strong>{name}</strong>
          <span>{sub}</span>
        </span>
        <ChevronDown size={15} className="muted desktop-only" />
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="row" style={{ padding: '8px 10px 10px' }}>
            <span className="avatar lg">{initials(name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{name}</div>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
            </div>
          </div>
          <div className="dropdown-sep" />
          {children(close)}
        </div>
      )}
    </div>
  );
}
