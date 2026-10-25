import { NavLink, Outlet } from 'react-router-dom';
import { useShopUser } from '@/context/AuthContext';
import { Building2, History, Printer, Users } from 'lucide-react';

/** Settings pages share a left sub-navigation, like a classic settings screen. */
export default function SettingsLayout() {
  const me = useShopUser();
  const links = [
    ...(me.can('admin') ? [
      { to: '/app/organization', label: 'Business profile', icon: Building2 },
      { to: '/app/print-settings', label: 'Print settings', icon: Printer },
      { to: '/app/team', label: 'Users, roles & branches', icon: Users },
    ] : []),
    ...(me.can('audit.read') ? [{ to: '/app/audit', label: 'Audit log', icon: History }] : []),
  ];
  return (
    <div className="settings-shell">
      <nav className="card settings-nav" aria-label="Settings">
        <h4>Settings</h4>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <l.icon size={16} /> {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
