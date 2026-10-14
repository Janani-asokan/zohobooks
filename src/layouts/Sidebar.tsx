import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string;
  end?: boolean;
  children?: Array<{ label: string; to: string }>;
}

export function Sidebar({
  items,
  brand,
  variant,
  collapsed,
  onToggle,
  mobileOpen,
  onNavigate,
  footer,
}: {
  items: NavItem[];
  brand: { title: string; sub: string; mark: string };
  variant?: 'super';
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onNavigate: () => void;
  footer?: ReactNode;
}) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<{ label: string; top: number } | null>(null);

  // Auto-expand the group containing the active route.
  useEffect(() => {
    for (const it of items) if (it.children?.some((c) => pathname.startsWith(c.to))) setOpen((o) => ({ ...o, [it.label]: true }));
  }, [pathname, items]);

  return (
    <aside className={`sidebar ${variant ?? ''} ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-mark">{brand.mark}</div>
        <div className="brand-text">
          <strong>{brand.title}</strong>
          <span>{brand.sub}</span>
        </div>
      </div>
      <nav className="sidebar-nav" onMouseLeave={() => setFlyout(null)}>
        {items.map((it) => {
          if (!it.children) {
            return (
              <NavLink key={it.label} to={it.to!} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate} title={collapsed ? it.label : undefined}>
                <it.icon size={19} />
                <span className="nav-text">{it.label}</span>
              </NavLink>
            );
          }
          const groupActive = it.children.some((c) => pathname.startsWith(c.to));
          const isOpen = open[it.label];
          return (
            <div key={it.label}>
              <button
                className={`nav-link ${isOpen ? 'open' : ''} ${groupActive ? (collapsed ? 'active' : 'parent-active') : ''}`}
                onClick={() => setOpen((o) => ({ ...o, [it.label]: !o[it.label] }))}
                onMouseEnter={(e) => collapsed && setFlyout({ label: it.label, top: e.currentTarget.getBoundingClientRect().top })}
                aria-expanded={!!isOpen}
              >
                <it.icon size={19} />
                <span className="nav-text">{it.label}</span>
                <ChevronRight size={15} className="chev" />
              </button>
              {isOpen && (
                <div className="nav-sub">
                  {it.children.map((c) => (
                    <NavLink key={c.to} to={c.to} className={({ isActive }) => `nav-link ${isActive || pathname.startsWith(c.to + '/') ? 'active' : ''}`} onClick={onNavigate}>
                      <span className="nav-text">{c.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
              {collapsed && flyout?.label === it.label && (
                <div className="flyout" style={{ top: flyout.top, left: 'calc(var(--sidebar-w-collapsed) - 4px)' }}>
                  <div className="nav-caption" style={{ color: 'var(--ink-400)', padding: '6px 10px' }}>{it.label}</div>
                  {it.children.map((c) => (
                    <NavLink key={c.to} to={c.to} className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setFlyout(null)}>
                      {c.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {footer}
      <div className="sidebar-foot desktop-only">
        <button className="nav-link" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          <span className="nav-text sidebar-foot-text">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

/** Persisted collapse state + mobile drawer state shared by both shells. */
export function useSidebarState(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(key, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  return { collapsed, toggle, mobileOpen, setMobileOpen };
}
