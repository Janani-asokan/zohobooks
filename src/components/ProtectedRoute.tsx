import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import ForcePasswordChange from '@/pages/ForcePasswordChange';

export function FullPageSpinner() {
  // Normally gone in a second. If the connection is slow, say so; if it stalls, the request gives up after 25 s
  // (api/client) and the app moves on (login page, or the last copy it saw when offline).
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 5000); return () => clearTimeout(t); }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12, textAlign: 'center', maxWidth: 340 }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--brand-600)' }} />
        {slow && (
          <div role="status">
            <div className="strong">Connecting to Corpus360…</div>
            <div className="small muted" style={{ marginTop: 4 }}>This is taking longer than usual. Check your internet connection; the app keeps trying.</div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Try again</button>
          </div>
        )}
      </div>
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
  if (me.kind === 'super' && me.user.mustChangePassword) return <ForcePasswordChange />;
  if (me.kind === 'user') {
    if (me.user.mustChangePassword) return <ForcePasswordChange />;
    if (me.shop.licenseExpired && !location.pathname.startsWith('/app/billing')) return <Navigate to="/app/billing" replace />;
  }
  return <Outlet />;
}
