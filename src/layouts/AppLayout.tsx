import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Home, Package, ShoppingCart, ShoppingBag, Landmark, BarChart3, LogOut, Menu, Search, Building2, Users, Plus, Bell, FileText, UserRound, Boxes, ScanLine, CreditCard, Keyboard, WifiOff, ClipboardList, Wrench, Receipt, Wallet, Truck, LifeBuoy, RotateCcw, Repeat, IndianRupee, FileMinus } from 'lucide-react';
import { CommandPalette, type PaletteAction } from './CommandPalette';
import { resetHints } from '@/components/kit';
import { Sidebar, useSidebarState, type NavItem } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { PrefsMenu } from './PrefsMenu';
import { ShortcutsModal } from './ShortcutsModal';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useNotifications, useOrg } from '@/api/hooks';
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

function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = usePrefs();
  return (
    <button className="global-search search-trigger desktop-only" onClick={onOpen} aria-label={t('common.search')}>
      <Search size={16} />
      <span>{t('shell.search')}</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}

function QuickCreate({ me }: { me: ReturnType<typeof useShopUser> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const cols = [
    { title: 'Sales', links: [
      me.can('sales.write') && { label: 'Invoice', icon: FileText, to: '/app/sales/invoices/new' },
      me.can('sales.write') && { label: 'POS sale', icon: ScanLine, to: '/app/pos' },
      me.can('sales.write') && { label: 'Sales order', icon: ClipboardList, to: '/app/sales/orders?new=1' },
      me.can('customers.write') && { label: 'Customer', icon: UserRound, to: '/app/sales/customers?new=1' },
    ] },
    { title: 'Inventory', links: [
      me.can('items.write') && { label: 'Item', icon: Boxes, to: '/app/items/new' },
      me.can('items.write') && { label: 'Service', icon: Wrench, to: '/app/items/new?type=Services' },
      me.can('purchases.write') && { label: 'Purchase order', icon: ClipboardList, to: '/app/purchases/orders?new=1' },
    ] },
    { title: 'Purchases', links: [
      me.can('purchases.write') && { label: 'Bill', icon: Receipt, to: '/app/purchases/bills?new=1' },
      me.can('purchases.write') && { label: 'Expense', icon: Wallet, to: '/app/purchases/expenses?new=1' },
      me.can('purchases.write') && { label: 'Vendor', icon: Truck, to: '/app/purchases/vendors?new=1' },
    ] },
  ].map((c) => ({ ...c, links: c.links.filter(Boolean) as Array<{ label: string; icon: typeof FileText; to: string }> })).filter((c) => c.links.length);
  if (!cols.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="qc-btn" aria-label="Quick create" title="Quick create" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Plus size={18} /></button>
      {open && (
        <div className="dropdown" style={{ width: 'auto', right: 0 }}>
          <div className="qc-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
            {cols.map((c) => (
              <div key={c.title} className="qc-col">
                <h5>{c.title}</h5>
                {c.links.map((l) => <button key={l.label} onClick={() => { close(); navigate(l.to); }}><l.icon size={15} /> {l.label}</button>)}
              </div>
            ))}
          </div>
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
  const [palette, setPalette] = useState(false);
  const days = daysUntil(me.shop.licenseEnd);
  const canSell = me.can('sales.write');

  // NOTE: no Configuration / system settings entry here — platform rules belong to the Super Admin.
  const nav: NavItem[] = useMemo(
    () => [
      { label: t('nav.home'), icon: Home, to: '/app', end: true },
      ...(canSell ? [{ label: t('nav.pos'), icon: ScanLine, to: '/app/pos' }] : []),
      { label: t('nav.items'), icon: Package, to: '/app/items', section: t('nav.secBusiness') },
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
      ...(me.can('purchases.read')
        ? [{
            label: t('nav.purchases'),
            icon: ShoppingBag,
            children: [
              { label: t('nav.vendors'), to: '/app/purchases/vendors' },
              { label: t('nav.purchaseOrders'), to: '/app/purchases/orders' },
              { label: t('nav.bills'), to: '/app/purchases/bills' },
              { label: t('nav.expenses'), to: '/app/purchases/expenses' },
            ],
          }]
        : []),
      ...(me.can('banking.read') ? [{ label: t('nav.banking'), icon: Landmark, to: '/app/banking', section: t('nav.secAccounts') }] : []),
      ...(me.can('reports.read') ? [{ label: t('nav.reports'), icon: BarChart3, to: '/app/reports', ...(me.can('banking.read') ? {} : { section: t('nav.secAccounts') }) }] : []),
    ],
    [t, canSell, me],
  );

  const actions: PaletteAction[] = useMemo(() => {
    const A = (cond: boolean, group: string, label: string, icon: PaletteAction['icon'], to: string, keywords = '', meta?: string) => (cond ? [{ group, label, icon, to, keywords, meta }] : []);
    const create = 'Create';
    const goTo = 'Go to';
    return [
      ...A(canSell, create, 'New invoice', FileText, '/app/sales/invoices/new', 'bill sale gst', 'Alt N'),
      ...A(canSell, create, 'New POS sale', ScanLine, '/app/pos', 'counter retail scan', 'Alt P'),
      ...A(me.can('items.write'), create, 'New item', Boxes, '/app/items/new', 'product goods add', 'Alt I'),
      ...A(me.can('customers.write'), create, 'New customer', UserRound, '/app/sales/customers?new=1', 'client party', 'Alt C'),
      ...A(canSell, create, 'New sales order', ClipboardList, '/app/sales/orders?new=1', 'quote estimate quotation'),
      ...A(me.can('purchases.write'), create, 'New purchase order', ClipboardList, '/app/purchases/orders?new=1', 'po restock order vendor'),
      ...A(me.can('purchases.write'), create, 'New bill', Receipt, '/app/purchases/bills?new=1', 'purchase vendor payable'),
      ...A(me.can('purchases.write'), create, 'Record expense', Wallet, '/app/purchases/expenses?new=1', 'rent salary electricity spend'),
      ...A(me.can('purchases.write'), create, 'New vendor', Truck, '/app/purchases/vendors?new=1', 'supplier'),
      ...A(true, goTo, 'Home dashboard', Home, '/app', 'overview'),
      ...A(true, goTo, 'Items', Package, '/app/items', 'inventory products catalogue'),
      ...A(true, goTo, 'Stock & alerts', Boxes, '/app/items?tab=stock', 'low stock reorder expiry batches'),
      ...A(true, goTo, 'Customers', UserRound, '/app/sales/customers'),
      ...A(true, goTo, 'Invoices', FileText, '/app/sales/invoices'),
      ...A(true, goTo, 'Sales orders', ClipboardList, '/app/sales/orders', 'quotes estimates'),
      ...A(true, goTo, 'Payments received', IndianRupee, '/app/sales/payments', 'collections receipts'),
      ...A(true, goTo, 'Credit notes', FileMinus, '/app/sales/credit-notes', 'returns refund'),
      ...A(me.can('admin'), goTo, 'Recurring invoices', Repeat, '/app/sales/recurring', 'subscription monthly'),
      ...A(me.can('purchases.read'), goTo, 'Vendors', Truck, '/app/purchases/vendors', 'suppliers'),
      ...A(me.can('purchases.read'), goTo, 'Purchase orders', ClipboardList, '/app/purchases/orders', 'po'),
      ...A(me.can('purchases.read'), goTo, 'Bills', Receipt, '/app/purchases/bills', 'payables'),
      ...A(me.can('purchases.read'), goTo, 'Expenses', Wallet, '/app/purchases/expenses'),
      ...A(me.can('banking.read'), goTo, 'Banking', Landmark, '/app/banking', 'cash bank accounts reconcile'),
      ...A(me.can('reports.read'), goTo, 'Reports', BarChart3, '/app/reports', 'gstr gstr-1 gstr-3b profit loss p&l sales tax hsn'),
      ...A(me.can('admin'), 'Settings', 'Organization profile', Building2, '/app/organization', 'logo gstin upi address invoice template'),
      ...A(me.can('admin'), 'Settings', 'Staff, roles & branches', Users, '/app/team', 'users team branch'),
      ...A(me.can('admin'), 'Settings', 'Subscription & billing', CreditCard, '/app/billing', 'plan license renew'),
    ];
  }, [canSell, me]);

  useShortcuts({
    'mod+k': () => setPalette(true),
    '/': () => setPalette(true),
    '?': () => setShortcuts(true),
    'alt+n': () => canSell && navigate('/app/sales/invoices/new'),
    'alt+p': () => canSell && navigate('/app/pos'),
    'alt+c': () => navigate('/app/sales/customers?new=1'),
    'alt+i': () => me.can('items.write') && navigate('/app/items/new'),
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
        footer={
          <div className="sidebar-help">
            <strong><LifeBuoy size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Need a hand?</strong>
            Press <b>Ctrl + K</b> to find anything, or <b>?</b> for shortcuts.
            <div className="row" style={{ gap: 6 }}>
              <button onClick={() => setPalette(true)}>Search</button>
              <button onClick={() => { resetHints(); try { Object.keys(localStorage).filter((k) => k.startsWith('ledgerly.gs.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } navigate('/app'); window.location.reload(); }} title="Show the help tips and setup checklist again"><RotateCcw size={12} style={{ verticalAlign: -1 }} /> Show tips</button>
            </div>
          </div>
        }
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
          <SearchTrigger onOpen={() => setPalette(true)} />
          <div className="topbar-actions">
            <Link to={me.can('admin') ? '/app/billing' : '#'} className={`license-pill ${days <= 30 ? 'warn' : ''}`} title={`License valid till ${me.shop.licenseEnd}`}>
              {me.shop.planName} · {days}{t('shell.daysLeft')}
            </Link>
            {canSell && (
              <button className="btn btn-primary btn-sm desktop-only" onClick={() => navigate('/app/sales/invoices/new')} title="Alt N">
                <Plus size={15} /> {t('shell.newInvoice')}
              </button>
            )}
            <button className="icon-btn mobile-only" onClick={() => setPalette(true)} aria-label="Search"><Search size={18} /></button>
            <QuickCreate me={me} />
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
      <CommandPalette open={palette} onClose={() => setPalette(false)} actions={actions} />
    </div>
  );
}
