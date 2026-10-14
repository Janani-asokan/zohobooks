import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Home, Package, ShoppingCart, ShoppingBag, Landmark, BarChart3, LogOut, Menu, Search, Building2, Users, Plus, Bell, FileText, UserRound, Boxes, ScanLine, CreditCard, Keyboard, WifiOff } from 'lucide-react';
import { Sidebar, useSidebarState, type NavItem } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { PrefsMenu } from './PrefsMenu';
import { ShortcutsModal } from './ShortcutsModal';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useCustomers, useInvoices, useItems, useNotifications, useOrg } from '@/api/hooks';
import { useClickOutside } from '@/components/useClickOutside';
import { useShortcuts } from '@/components/useShortcuts';
import { useOnline } from '@/components/useOnline';
import { daysUntil, fyLabel } from '@/lib/fy';
import { initials } from '@/lib/format';

export function OrgLogo({ logo, name, size = 36 }: { logo?: string; name: string; size?: number }) {
  return (
    <span className="org-logo" style={{ width: size, height: size }}>
      {logo ? <img src={logo} alt={`${name} logo`} /> : initials(name)}
    </span>
  );
}

function GlobalSearch({ inputRef }: { inputRef: React.RefObject<HTMLInputElement> }) {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  // Uses the same cached lists as the Items/Customers/Invoices pages; results are computed only while searching.
  const active = open && q.trim().length > 0;
  const items = useItems();
  const customers = useCustomers();
  const invoices = useInvoices();

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!active) return [];
    return [
      ...(items.data ?? [])
        .filter((i) => [i.name, i.sku, i.barcode].some((v) => v.toLowerCase().includes(s)))
        .slice(0, 5)
        .map((i) => ({ group: t('nav.items'), icon: Boxes, label: i.name, meta: i.sku || i.type, to: `/app/items?q=${encodeURIComponent(i.name)}` })),
      ...(customers.data ?? [])
        .filter((c) => [c.name, c.companyName, c.customId, c.phone, c.email, c.gstin].some((v) => v.toLowerCase().includes(s)))
        .slice(0, 5)
        .map((c) => ({ group: t('nav.customers'), icon: UserRound, label: c.companyName || c.name, meta: c.customId, to: `/app/sales/customers?q=${encodeURIComponent(c.customId)}` })),
      ...(invoices.data ?? [])
        .filter((i) => (i.number ?? 'draft').toLowerCase().includes(s) || (i.customer.companyName || i.customer.name).toLowerCase().includes(s))
        .slice(0, 5)
        .map((i) => ({ group: t('nav.invoices'), icon: FileText, label: i.number ?? 'Draft', meta: i.customer.companyName || i.customer.name, to: `/app/sales/invoices/${i.id}` })),
    ];
  }, [q, active, items.data, customers.data, invoices.data, t]);

  const go = (to: string) => {
    navigate(to);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="global-search desktop-only" ref={ref}>
      <Search size={16} />
      <input
        ref={inputRef}
        className="input"
        placeholder={t('shell.search')}
        value={q}
        aria-label={t('common.search')}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1));
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter' && results[hl]) go(results[hl]!.to);
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
        }}
      />
      {!q && <kbd>Ctrl K</kbd>}
      {open && q && (
        <div className="search-results">
          {(items.isLoading || customers.isLoading || invoices.isLoading) && <div className="small muted" style={{ padding: 12 }}>{t('common.loading')}</div>}
          {!items.isLoading && results.length === 0 && <div className="small muted" style={{ padding: 12 }}>No matches for “{q}”.</div>}
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

function NotificationBell() {
  const { t } = usePrefs();
  const { data = [] } = useNotifications();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const urgent = data.some((n) => n.tone === 'red');
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={t('shell.notifications')} onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <Bell size={18} />
        {data.length > 0 && <span style={{ position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 9, background: urgent ? 'var(--red-500)' : 'var(--amber-600)', border: '2px solid var(--surface)' }} />}
      </button>
      {open && (
        <div className="dropdown" style={{ width: 320 }}>
          <div style={{ padding: '6px 10px 8px', fontWeight: 700, color: 'var(--ink-900)' }}>{t('shell.notifications')}</div>
          {data.length === 0 && <div className="small muted" style={{ padding: '6px 10px 12px' }}>{t('shell.noNotifications')} ✨</div>}
          {data.map((n) => (
            <Link key={n.kind} to={n.link} className="notif-item" onClick={close}>
              <span className="notif-dot" style={{ background: n.tone === 'red' ? 'var(--red-500)' : n.tone === 'amber' ? 'var(--amber-600)' : 'var(--brand-500)' }} />
              {n.text}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { logout } = useAuth();
  const me = useShopUser();
  const { t } = usePrefs();
  const org = useOrg();
  const navigate = useNavigate();
  const sb = useSidebarState('ledgerly.app.sidebar');
  const online = useOnline();
  const [shortcuts, setShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const days = daysUntil(me.shop.licenseEnd);
  const canSell = me.can('sales.write');

  // NOTE: no Configuration / system settings entry here — platform rules belong to the Super Admin.
  const nav: NavItem[] = useMemo(
    () => [
      { label: t('nav.home'), icon: Home, to: '/app', end: true },
      ...(canSell ? [{ label: t('nav.pos'), icon: ScanLine, to: '/app/pos' }] : []),
      { label: t('nav.items'), icon: Package, to: '/app/items' },
      {
        label: t('nav.sales'),
        icon: ShoppingCart,
        children: [
          { label: t('nav.customers'), to: '/app/sales/customers' },
          { label: t('nav.salesOrders'), to: '/app/sales/orders' },
          { label: t('nav.invoices'), to: '/app/sales/invoices' },
          { label: t('nav.payments'), to: '/app/sales/payments' },
          { label: t('nav.creditNotes'), to: '/app/sales/credit-notes' },
          ...(me.can('admin') ? [{ label: t('nav.recurring'), to: '/app/sales/recurring' }] : []),
        ],
      },
      ...(me.can('purchases.read') ? [{ label: t('nav.purchases'), icon: ShoppingBag, to: '/app/purchases' }] : []),
      ...(me.can('banking.read') ? [{ label: t('nav.banking'), icon: Landmark, to: '/app/banking' }] : []),
      ...(me.can('reports.read') ? [{ label: t('nav.reports'), icon: BarChart3, to: '/app/reports' }] : []),
    ],
    [t, canSell, me],
  );

  useShortcuts({
    'mod+k': () => searchRef.current?.focus(),
    '/': () => searchRef.current?.focus(),
    '?': () => setShortcuts(true),
    'alt+n': () => canSell && navigate('/app/sales/invoices/new'),
    'alt+p': () => canSell && navigate('/app/pos'),
    'alt+c': () => navigate('/app/sales/customers?new=1'),
    'alt+i': () => me.can('items.write') && navigate('/app/items?new=1'),
    'g h': () => navigate('/app'),
    'g i': () => navigate('/app/sales/invoices'),
    'g c': () => navigate('/app/sales/customers'),
    'g t': () => navigate('/app/items'),
    'g r': () => me.can('reports.read') && navigate('/app/reports'),
  });

  useEffect(() => {
    if (org.data?.companyName) document.title = `${org.data.companyName} · Ledgerly Books`;
  }, [org.data?.companyName]);

  const name = org.data?.companyName ?? me.shop.name;

  return (
    <div className="shell">
      <Sidebar
        items={nav}
        brand={{ title: 'Ledgerly Books', sub: `FY ${fyLabel(new Date(), me.platform.fyStartMonth)}`, mark: 'L' }}
        collapsed={sb.collapsed}
        onToggle={sb.toggle}
        mobileOpen={sb.mobileOpen}
        onNavigate={() => sb.setMobileOpen(false)}
        collapseLabel={t('nav.collapse')}
      />
      {sb.mobileOpen && <div className="scrim" onClick={() => sb.setMobileOpen(false)} />}
      <div className="shell-main">
        {!online && (
          <div className="offline-bar no-print" role="status">
            <WifiOff size={15} /> {t('shell.offline')}
          </div>
        )}
        <header className="topbar no-print">
          <button className="icon-btn mobile-only" onClick={() => sb.setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-org">
            <OrgLogo logo={org.data?.logo} name={name} />
            <div style={{ minWidth: 0 }}>
              <div className="org-name">{name}</div>
              <div className="org-sub">{org.data?.gstin ? `GSTIN ${org.data.gstin}` : 'GSTIN not added'}</div>
            </div>
          </div>
          <GlobalSearch inputRef={searchRef} />
          <div className="topbar-actions">
            <Link to={me.can('admin') ? '/app/billing' : '#'} className={`license-pill ${days <= 30 ? 'warn' : ''}`} title={`License valid till ${me.shop.licenseEnd}`}>
              {me.shop.planName} · {days}{t('shell.daysLeft')}
            </Link>
            {canSell && (
              <button className="btn btn-primary btn-sm desktop-only" onClick={() => navigate('/app/sales/invoices/new')} title="Alt N">
                <Plus size={15} /> {t('shell.newInvoice')}
              </button>
            )}
            <NotificationBell />
            <ProfileMenu name={me.user.name} sub={`${me.user.role} · ${me.shop.name}`} email={me.user.email}>
              {(close) => (
                <>
                  {me.can('admin') && (
                    <>
                      <button className="dropdown-item" onClick={() => { close(); navigate('/app/organization'); }}>
                        <Building2 size={16} /> {t('shell.orgProfile')}
                      </button>
                      <button className="dropdown-item" onClick={() => { close(); navigate('/app/team'); }}>
                        <Users size={16} /> {t('shell.team')}
                      </button>
                      <button className="dropdown-item" onClick={() => { close(); navigate('/app/billing'); }}>
                        <CreditCard size={16} /> {t('shell.billing')}
                      </button>
                    </>
                  )}
                  <button className="dropdown-item" onClick={() => { close(); setShortcuts(true); }}>
                    <Keyboard size={16} /> {t('shell.shortcuts')} <span className="kbd" style={{ marginLeft: 'auto' }}>?</span>
                  </button>
                  <div className="dropdown-sep" />
                  <PrefsMenu />
                  <div className="dropdown-sep" />
                  <button className="dropdown-item danger" onClick={async () => { await logout(); navigate('/login'); }}>
                    <LogOut size={16} /> {t('shell.signOut')}
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
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}
