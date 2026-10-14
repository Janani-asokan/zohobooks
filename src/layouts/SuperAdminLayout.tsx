import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, Bell } from 'lucide-react';
import { Sidebar, useSidebarState, type NavItem } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { useAuth } from '@/context/AuthContext';

const NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/super-admin', end: true },
  { label: 'Configuration', icon: Settings2, to: '/super-admin/configuration' },
];

export default function SuperAdminLayout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sb = useSidebarState('ledgerly.sa.sidebar');
  const title = pathname.includes('configuration') ? 'Platform Configuration' : 'SaaS Overview';

  return (
    <div className="shell">
      <Sidebar
        items={NAV}
        variant="super"
        brand={{ title: 'Ledgerly Console', sub: 'SUPER ADMIN', mark: 'L' }}
        collapsed={sb.collapsed}
        onToggle={sb.toggle}
        mobileOpen={sb.mobileOpen}
        onNavigate={() => sb.setMobileOpen(false)}
        footer={
          <div className="sidebar-card">
            <strong className="row" style={{ gap: 6 }}>
              <ShieldCheck size={15} /> Privacy by design
            </strong>
            Shop financials, pricing and customer data are isolated per tenant and never visible from this console.
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
            <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{title}</div>
            <div className="org-sub">Platform-wide controls</div>
          </div>
          <div className="topbar-actions">
            <span className="badge badge-violet desktop-only">Super Admin</span>
            <button className="icon-btn" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <ProfileMenu name={session!.name} sub="Platform owner" email={session!.email}>
              {(close) => (
                <>
                  <button className="dropdown-item" onClick={() => { close(); navigate('/super-admin/configuration'); }}>
                    <Settings2 size={16} /> Configuration
                  </button>
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
