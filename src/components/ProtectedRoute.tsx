import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import ForcePasswordChange from '@/pages/ForcePasswordChange';

export function FullPageSpinner() {
  // A server that was asleep (free hosting stops it when idle) can take up to a minute to answer the first request.
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 4000); return () => clearTimeout(t); }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12, textAlign: 'center', maxWidth: 340 }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--brand-600)' }} />
        {slow && (
          <div role="status">
            <div className="strong">Starting up Corpus360…</div>
            <div className="small muted" style={{ marginTop: 4 }}>The server was resting after a quiet spell. The first visit can take up to a minute; after that it’s quick.</div>
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
  if (me.kind === 'user') {
    if (me.user.mustChangePassword) return <ForcePasswordChange />;
    if (me.shop.licenseExpired && !location.pathname.startsWith('/app/billing')) return <Navigate to="/app/billing" replace />;
  }
  return <Outlet />;
}
