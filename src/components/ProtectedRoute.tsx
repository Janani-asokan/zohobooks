import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import ForcePasswordChange from '@/pages/ForcePasswordChange';

export function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <Loader2 size={28} className="spin" style={{ color: 'var(--brand-600)' }} />
    </div>
  );
}

/** Guards a route group: signed-out → /login, wrong role → its own home, forced password change, expired license → billing only. */
export function ProtectedRoute({ kind }: { kind: 'super' | 'user' }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.kind !== kind) return <Navigate to={homeFor(me)} replace />;
  if (me.kind === 'user') {
    if (me.user.mustChangePassword) return <ForcePasswordChange />;
    if (me.shop.licenseExpired && !location.pathname.startsWith('/app/billing')) return <Navigate to="/app/billing" replace />;
  }
  return <Outlet />;
}
