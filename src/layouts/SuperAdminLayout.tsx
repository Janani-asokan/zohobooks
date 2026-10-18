import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, Layers, History } from 'lucide-react';
import { Sidebar, useSidebarState, type NavItem } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { PrefsMenu } from './PrefsMenu';
import { useAuth } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';

export default function SuperAdminLayout() {
  const { me, logout } = useAuth();
  const { t } = usePrefs();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sb = useSidebarState('ledgerly.sa.sidebar');
  const NAV: NavItem[] = [
    { label: t('nav.dashboard'), icon: LayoutDashboard, to: '/super-admin', end: true },
    { label: t('nav.configuration'), icon: Settings2, to: '/super-admin/configuration' },
    { label: 'Plans & limits', icon: Layers, to: '/super-admin/plans' },
    { label: 'Activity & backups', icon: History, to: '/super-admin/activity' },
  ];
  const title = pathname.includes('configuration') ? 'Platform Configuration' : pathname.includes('plans') ? 'Plans & limits' : pathname.includes('activity') ? 'Activity & backups' : 'SaaS Overview';

  return (
    <div className="shell">
      <Sidebar
        items={NAV}
        variant="super"
        brand={{ home: '/super-admin', tag: 'Console' }}
        collapsed={sb.collapsed}
        onToggle={sb.toggle}
        mobileOpen={sb.mobileOpen}
        onNavigate={() => sb.setMobileOpen(false)}
        collapseLabel={t('nav.collapse')}
        footer={
          <div className="sidebar-card">
            <strong className="row" style={{ gap: 6 }}>
              <ShieldCheck size={15} /> Privacy by design
            </strong>
            Shop financials, pricing and customer data are isolated per tenant in the database and never visible from this console.
          </div>
        }
      />
      {sb.mobileOpen && <div className="scrim" onClick={() => sb.setMobileOpen(false)} />}
      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => sb.setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{title}</div>
            <div className="org-sub">Platform-wide controls</div>
          </div>
          <div className="topbar-actions">
            <span className="badge badge-violet desktop-only">Super Admin</span>
            <ProfileMenu name={me!.user.name} sub="Platform owner" email={me!.user.email}>
              {(close) => (
                <>
                  <button className="dropdown-item" onClick={() => { close(); navigate('/super-admin/configuration'); }}>
                    <Settings2 size={16} /> {t('nav.configuration')}
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
    </div>
  );
}
