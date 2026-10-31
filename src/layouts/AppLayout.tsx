import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, UserRound, LogOut, Lock, HandCoins, ReceiptIndianRupee, Menu, Search, Building2, Users, Plus, Bell, FileText, Keyboard, WifiOff, Printer, RotateCcw, ChevronDown, Check, Loader2 } from 'lucide-react';
import { buildActions, buildCreate, buildNav, canOpen } from './nav';
import { CommandPalette } from './CommandPalette';
import { resetHints } from '@/components/kit';
import { Sidebar, useSidebarState } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { PrefsMenu } from './PrefsMenu';
import { ShortcutsModal } from './ShortcutsModal';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useNotifications, useOrg, useOrgs } from '@/api/hooks';
import { api, fieldErrors } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { EmptyState, Field, Modal } from '@/components/ui';
import { GSTIN_RE, INDIAN_STATES } from '../../shared/gst';
import { useClickOutside } from '@/components/useClickOutside';
import { useShortcuts } from '@/components/useShortcuts';
import { useOnline } from '@/components/useOnline';
import { initials } from '@/lib/format';
import { AssistantButton } from '@/components/Assistant';
import { useFieldTracker } from '@/lib/geo';

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

/** Organisation switcher: every business this login can open, plus adding another one (owner only). */
function OrgSwitcher({ name, logo, gstin, isAdmin, isOwner }: { name: string; logo?: string; gstin?: string; isAdmin: boolean; isOwner: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const orgs = useOrgs();
  const go = async (id: string, label: string) => {
    setBusy(id);
    try { await switchOrg(id); close(); navigate('/app'); toast('success', `Switched to ${label}`); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
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
        <div className="dropdown" role="menu" style={{ left: 0, right: 'auto', width: 300 }} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="small muted" style={{ padding: '4px 8px' }}>Organisations</div>
          {(orgs.data ?? [{ id: 'current', name, role: '', gstin: gstin ?? '', current: true, active: true, licenseExpired: false }]).map((o) => (
            <button key={o.id} className="dropdown-item" role="menuitem" disabled={o.current || !o.active || !!busy} onClick={() => go(o.id, o.name)} style={{ height: 'auto', padding: '6px 8px' }}>
              <OrgLogo logo={o.current ? logo : undefined} name={o.name} size={22} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-900)', fontWeight: 500 }}>{o.name}</span>
                <span className="small muted">{[o.role, o.gstin || 'No GSTIN', !o.active ? 'Deactivated' : o.licenseExpired ? 'License expired' : ''].filter(Boolean).join(' · ')}</span>
              </span>
              {busy === o.id ? <Loader2 size={14} className="spin" /> : o.current && <Check size={14} />}
            </button>
          ))}
          {(isAdmin || isOwner) && <div className="dropdown-sep" />}
          {isOwner && <button className="dropdown-item" role="menuitem" onClick={() => { close(); setAdding(true); }}><Plus size={15} /> Add an organisation</button>}
          {isAdmin && <button className="dropdown-item" role="menuitem" onClick={() => { close(); navigate('/app/organization'); }}><Building2 size={15} /> Organisation settings</button>}
        </div>
      )}
      {adding && <NewOrgModal onClose={() => setAdding(false)} onCreated={(id, label) => { setAdding(false); go(id, label); }} />}
    </div>
  );
}

function NewOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: (shopId: string, name: string) => void }) {
  const [f, setF] = useState({ companyName: '', gstin: '', state: 'Tamil Nadu', address: '', phone: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.companyName.trim().length < 2) e.companyName = 'Enter the business name';
    if (f.gstin && !GSTIN_RE.test(f.gstin.toUpperCase())) e.gstin = 'Enter a valid 15-character GSTIN';
    setErr(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const r = await api.post<{ shopId: string }>('/shop/organizations', { ...f, gstin: f.gstin.toUpperCase() });
      onCreated(r.shopId, f.companyName.trim());
    } catch (x) { setErr({ ...fieldErrors(x), form: (x as Error).message }); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add an organisation" subtitle="A separate business with its own customers, items, invoices and books. It shares this login and your current plan."
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={submit}>{saving && <Loader2 size={15} className="spin" />} Create and open</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Business name" required error={err.companyName}><input className={`input ${err.companyName ? 'invalid' : ''}`} autoFocus value={f.companyName} maxLength={120} onChange={(e) => setF({ ...f, companyName: e.target.value })} placeholder="e.g. Aravind Mobiles" /></Field>
        <div className="form-grid">
          <Field label="GSTIN" error={err.gstin}><input className={`input mono ${err.gstin ? 'invalid' : ''}`} value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} placeholder="Optional" /></Field>
          <Field label="State" required><select className="select" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Address"><input className="input" value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {err.form && <div className="field-error">{err.form}</div>}
      </div>
    </Modal>
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
  const onDuty = useFieldTracker();
  const [shortcuts, setShortcuts] = useState(false);
  const [palette, setPalette] = useState(false);
  // The search palette loads every item, customer and invoice to search them; only do that once someone opens it.
  const [paletteUsed, setPaletteUsed] = useState(false);
  useEffect(() => { if (palette) setPaletteUsed(true); }, [palette]);
  const canSell = me.can('sales.write');
  // Staff who only handle loans (collectors) get lending shortcuts in the phone bar instead of shop ones.
  const lendingOnly = !!org.data?.lendingEnabled && !(['sales.write', 'customers.write', 'items.write', 'reports.read'] as const).some((p) => me.can(p)) && (me.can('lending.collect') || me.can('lending.read'));

  const lendingOn = !!org.data?.lendingEnabled;
  const nav = useMemo(() => buildNav(me.can, { lending: lendingOn }), [me, lendingOn]);
  const location = useLocation();
  const actions = useMemo(() => buildActions(me.can, { lending: lendingOn }), [me, lendingOn]);

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
    'g a': () => me.can('accounting.read') && navigate('/app/accounting/accounts'),
    'g b': () => me.can('purchases.read') && navigate('/app/purchases/bills'),
    'g p': () => me.can('reports.read') && navigate('/app/reports/profit-loss'),
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
          <OrgSwitcher name={name} logo={org.data?.logo} gstin={org.data?.gstin} isAdmin={me.can('admin')} isOwner={me.user.role === 'Owner'} />
          <SearchTrigger onOpen={() => setPalette(true)} />
          <div className="topbar-actions">
            <button className="icon-btn mobile-only" onClick={() => setPalette(true)} aria-label="Search"><Search size={18} /></button>
            <AssistantButton />
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
        {onDuty && <Link to="/app/field" className="duty-bar no-print" role="status"><span className="fh-dot" /> On duty · sharing location while the app is open · tap to check in or end your day</Link>}
        <main>
          {canOpen(location.pathname, me.can) ? <Outlet /> : (
            <div className="page"><div className="card">
              <EmptyState icon={Lock} title="This page isn’t part of your role" text={`Your ${me.user.role} login can’t open this page. Ask the shop owner if you need access.`}
                action={<Link to="/app" className="btn btn-primary">Go to dashboard</Link>} />
            </div></div>
          )}
        </main>
        {lendingOnly ? (
          <nav className="bottom-nav no-print" aria-label="Quick navigation">
            <NavLink to="/app/microfinance" end><LayoutDashboard size={20} />Home</NavLink>
            <NavLink to="/app/microfinance/collections"><ReceiptIndianRupee size={20} />Collect</NavLink>
            <NavLink to="/app/microfinance/loans"><HandCoins size={20} />Loans</NavLink>
            <button onClick={() => sb.setMobileOpen(true)}><Menu size={20} />More</button>
          </nav>
        ) : (
          <nav className="bottom-nav no-print" aria-label="Quick navigation">
            <NavLink to="/app" end><LayoutDashboard size={20} />Home</NavLink>
            <NavLink to="/app/sales/invoices"><FileText size={20} />Invoices</NavLink>
            {canSell ? <button onClick={() => navigate('/app/sales/invoices/new')} aria-label="New invoice"><span className="bn-fab"><Plus size={22} /></span></button> : <NavLink to="/app/sales/customers"><UserRound size={20} />Customers</NavLink>}
            <NavLink to="/app/items"><Package size={20} />Items</NavLink>
            <button onClick={() => sb.setMobileOpen(true)}><Menu size={20} />More</button>
          </nav>
        )}
      </div>
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
      {paletteUsed && <CommandPalette open={palette} onClose={() => setPalette(false)} actions={actions} />}
    </div>
  );
}
