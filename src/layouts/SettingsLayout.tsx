import { NavLink, Outlet } from 'react-router-dom';
import { Building2, Users } from 'lucide-react';

/** Settings pages share a left sub-navigation, like a classic settings screen. */
export default function SettingsLayout() {
  const links = [
    { to: '/app/organization', label: 'Business profile', icon: Building2 },
    { to: '/app/team', label: 'Users, roles & branches', icon: Users },
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
