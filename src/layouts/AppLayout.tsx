import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, UserRound, LogOut, Menu, Search, Building2, Users, Plus, Bell, FileText, Keyboard, WifiOff, Printer, RotateCcw, ChevronDown, Check } from 'lucide-react';
import { buildActions, buildCreate, buildNav } from './nav';
import { CommandPalette } from './CommandPalette';
import { resetHints } from '@/components/kit';
import { Sidebar, useSidebarState } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { PrefsMenu } from './PrefsMenu';
import { ShortcutsModal } from './ShortcutsModal';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useNotifications, useOrg } from '@/api/hooks';
import { useClickOutside } from '@/components/useClickOutside';
import { useShortcuts } from '@/components/useShortcuts';
import { useOnline } from '@/components/useOnline';
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
    <button className="search-trigger desktop-only" onClick={onOpen} aria-label={t('common.search')}>
      <Search size={15} />
      <span>Search invoices, customers, items…</span>
      <kbd>{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

function QuickCreate({ me }: { me: ReturnType<typeof useShopUser> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const cols = buildCreate(me.can);
  if (!cols.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="qc-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Plus size={16} /><span className="desktop-only">New</span></button>
      {open && (
        <div className="dropdown" role="menu" style={{ width: 'auto', right: 0 }} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="qc-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
            {cols.map((c) => (
              <div key={c.title} className="qc-col">
                <h5>{c.title}</h5>
                {c.links.map((l) => <button key={l.label} role="menuitem" onClick={() => { close(); navigate(l.to); }}><l.icon size={15} /> {l.label}{l.keys && <span className="kbd" style={{ marginLeft: 'auto' }}>{l.keys}</span>}</button>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Organisation switcher. Lists the organisations this person can open (memberships) and the current org's settings. */
function OrgSwitcher({ name, logo, gstin, isAdmin }: { name: string; logo?: string; gstin?: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  return (
    <div ref={ref} className="topbar-org">
      <button className="org-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <OrgLogo logo={logo} name={name} size={28} />
        <span style={{ minWidth: 0 }}>
          <span className="org-name" style={{ display: 'block' }}>{name}</span>
          <span className="org-sub" style={{ display: 'block' }}>{gstin ? `GSTIN ${gstin}` : 'GSTIN not added'}</span>
        </span>
        <ChevronDown size={14} className="muted" />
      </button>
      {open && (
        <div className="dropdown" role="menu" style={{ left: 0, right: 'auto', width: 280 }}>
          <div className="small muted" style={{ padding: '4px 8px' }}>Organisations</div>
          <button className="dropdown-item" role="menuitem" onClick={close}><OrgLogo logo={logo} name={name} size={20} /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span> <Check size={14} /></button>
          {isAdmin && <><div className="dropdown-sep" /><button className="dropdown-item" role="menuitem" onClick={() => { close(); navigate('/app/organization'); }}><Building2 size={15} /> Organisation settings</button></>}
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
          <div style={{ padding: '4px 8px 6px', fontWeight: 600, color: 'var(--ink-900)', fontSize: 13 }}>{t('shell.notifications')}</div>
          {data.length === 0 && <div className="small muted" style={{ padding: '6px 10px 12px' }}>Nothing needs your attention right now.</div>}
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
  const canSell = me.can('sales.write');

  const nav = useMemo(() => buildNav(me.can), [me]);
  const actions = useMemo(() => buildActions(me.can), [me]);

  useShortcuts({
    'mod+k': () => setPalette(true),
    n: () => canSell && navigate('/app/sales/invoices/new'),
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
    if (org.data?.companyName) document.title = `${org.data.companyName} · Corpus360`;
  }, [org.data?.companyName]);

  const name = org.data?.companyName ?? me.shop.name;

  return (
    <div className="shell">
      <Sidebar
        items={nav}
        brand={{ home: '/app' }}
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
          <OrgSwitcher name={name} logo={org.data?.logo} gstin={org.data?.gstin} isAdmin={me.can('admin')} />
          <SearchTrigger onOpen={() => setPalette(true)} />
          <div className="topbar-actions">
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
                      <button className="dropdown-item" onClick={() => { close(); navigate('/app/print-settings'); }}>
                        <Printer size={16} /> Print settings
                      </button>
                      <button className="dropdown-item" onClick={() => { close(); navigate('/app/team'); }}>
                        <Users size={16} /> {t('shell.team')}
                      </button>
                    </>
                  )}
                  <button className="dropdown-item" onClick={() => { close(); resetHints(); try { Object.keys(localStorage).filter((k) => k.startsWith('ledgerly.gs.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } window.location.reload(); }}>
                    <RotateCcw size={16} /> Show help tips again
                  </button>
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
        <nav className="bottom-nav no-print" aria-label="Quick navigation">
          <NavLink to="/app" end><LayoutDashboard size={20} />Home</NavLink>
          <NavLink to="/app/sales/invoices"><FileText size={20} />Invoices</NavLink>
          {canSell ? <button onClick={() => navigate('/app/sales/invoices/new')} aria-label="New invoice"><span className="bn-fab"><Plus size={22} /></span></button> : <NavLink to="/app/sales/customers"><UserRound size={20} />Customers</NavLink>}
          <NavLink to="/app/items"><Package size={20} />Items</NavLink>
          <button onClick={() => sb.setMobileOpen(true)}><Menu size={20} />More</button>
        </nav>
      </div>
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} actions={actions} />
    </div>
  );
}
