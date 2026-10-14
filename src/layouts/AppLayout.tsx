import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Home, Package, ShoppingCart, ShoppingBag, Landmark, BarChart3, LogOut, Menu, Search, Building2, Users, Plus, Bell, FileText, UserRound, Boxes } from 'lucide-react';
import { Sidebar, useSidebarState, type NavItem } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import { useClickOutside } from '@/components/useClickOutside';
import { daysUntil, fyLabel } from '@/lib/fy';
import { initials } from '@/lib/format';

// NOTE: no Configuration / system settings entry here — those belong to the Super Admin.
const NAV: NavItem[] = [
  { label: 'Home', icon: Home, to: '/app', end: true },
  { label: 'Items', icon: Package, to: '/app/items' },
  {
    label: 'Sales',
    icon: ShoppingCart,
    children: [
      { label: 'Customers', to: '/app/sales/customers' },
      { label: 'Sales Orders', to: '/app/sales/orders' },
      { label: 'Invoices', to: '/app/sales/invoices' },
    ],
  },
  { label: 'Purchases', icon: ShoppingBag, to: '/app/purchases' },
  { label: 'Banking', icon: Landmark, to: '/app/banking' },
  { label: 'Reports', icon: BarChart3, to: '/app/reports' },
];

export function OrgLogo({ logo, name, size = 36 }: { logo: string; name: string; size?: number }) {
  return (
    <span className="org-logo" style={{ width: size, height: size }}>
      {logo ? <img src={logo} alt={`${name} logo`} /> : initials(name)}
    </span>
  );
}

function GlobalSearch() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const custName = (id: string) => tenant.customers.find((c) => c.id === id)?.name ?? '';
    return [
      ...tenant.items
        .filter((i) => [i.name, i.sku, i.barcode].some((v) => v.toLowerCase().includes(s)))
        .slice(0, 5)
        .map((i) => ({ group: 'Items', icon: Boxes, label: i.name, meta: i.sku || i.type, to: `/app/items?q=${encodeURIComponent(i.name)}` })),
      ...tenant.customers
        .filter((c) => [c.name, c.companyName, c.customId, c.phone, c.email].some((v) => v.toLowerCase().includes(s)))
        .slice(0, 5)
        .map((c) => ({ group: 'Customers', icon: UserRound, label: c.companyName || c.name, meta: c.customId, to: `/app/sales/customers?q=${encodeURIComponent(c.customId)}` })),
      ...tenant.invoices
        .filter((i) => i.number.toLowerCase().includes(s) || custName(i.customerId).toLowerCase().includes(s))
        .slice(0, 5)
        .map((i) => ({ group: 'Invoices', icon: FileText, label: i.number, meta: custName(i.customerId), to: `/app/sales/invoices/${i.id}` })),
    ];
  }, [q, tenant]);

  const go = (to: string) => {
    navigate(to);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="global-search desktop-only" ref={ref}>
      <Search size={16} />
      <input
        ref={inputRef}
        className="input"
        placeholder="Search items, customers, invoices…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHl(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1));
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter' && results[hl]) go(results[hl]!.to);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {!q && <kbd>Ctrl K</kbd>}
      {open && q && (
        <div className="search-results">
          {results.length === 0 && <div className="small muted" style={{ padding: 12 }}>No matches for “{q}”.</div>}
          {results.map((r, i) => (
            <div key={r.group + r.label + i}>
              {(i === 0 || results[i - 1]!.group !== r.group) && <div className="group">{r.group}</div>}
              <button className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)} onClick={() => go(r.to)}>
                <r.icon size={15} className="muted" />
                {r.label}
                <span className="meta">{r.meta}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { session, logout } = useAuth();
  const { tenant, shop } = useTenant();
  const navigate = useNavigate();
  const sb = useSidebarState('ledgerly.app.sidebar');
  const days = daysUntil(shop.licenseEnd);
  const outstanding = tenant.invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Overdue').length;

  return (
    <div className="shell">
      <Sidebar
        items={NAV}
        brand={{ title: 'Ledgerly Books', sub: `FY ${fyLabel()}`, mark: 'L' }}
        collapsed={sb.collapsed}
        onToggle={sb.toggle}
        mobileOpen={sb.mobileOpen}
        onNavigate={() => sb.setMobileOpen(false)}
      />
      {sb.mobileOpen && <div className="scrim" onClick={() => sb.setMobileOpen(false)} />}
      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => sb.setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-org">
            <OrgLogo logo={tenant.org.logo} name={tenant.org.companyName} />
            <div style={{ minWidth: 0 }}>
              <div className="org-name">{tenant.org.companyName}</div>
              <div className="org-sub">{tenant.org.gstin ? `GSTIN ${tenant.org.gstin}` : 'GSTIN not added'}</div>
            </div>
          </div>
          <GlobalSearch />
          <div className="topbar-actions">
            <span className={`license-pill ${days <= 30 ? 'warn' : ''}`} title={`License valid till ${shop.licenseEnd}`}>
              {shop.plan} · {days}d left
            </span>
            <button className="btn btn-primary btn-sm desktop-only" onClick={() => navigate('/app/sales/invoices/new')}>
              <Plus size={15} /> New Invoice
            </button>
            <button className="icon-btn" aria-label="Notifications" title={`${outstanding} invoices awaiting payment`} style={{ position: 'relative' }}>
              <Bell size={18} />
              {outstanding > 0 && <span style={{ position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 9, background: 'var(--red-500)', border: '2px solid #fff' }} />}
            </button>
            <ProfileMenu name={session!.name} sub="Owner · Admin" email={session!.email}>
              {(close) => (
                <>
                  <button className="dropdown-item" onClick={() => { close(); navigate('/app/organization'); }}>
                    <Building2 size={16} /> Organization profile
                  </button>
                  <button className="dropdown-item" onClick={() => { close(); navigate('/app/team'); }}>
                    <Users size={16} /> Staff, roles &amp; branches
                  </button>
                  <div className="dropdown-sep" />
                  <div className="small muted" style={{ padding: '4px 10px 6px' }}>
                    Receivables: <strong style={{ color: 'var(--ink-800)' }}>{outstanding} open invoices</strong>
                  </div>
                  <div className="dropdown-sep" />
                  <button className="dropdown-item danger" onClick={() => { logout(); navigate('/login'); }}>
                    <LogOut size={16} /> Sign out
                  </button>
                </>
              )}
            </ProfileMenu>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
