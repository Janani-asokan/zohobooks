import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { homeFor, useAuth } from '@/context/AuthContext';
import { useStore } from '@/context/StoreContext';
import type { Role } from '@/lib/types';

/** Guards a route group: unauthenticated → /login, wrong role → that role's own home. */
export function ProtectedRoute({ role }: { role: Role }) {
  const { session } = useAuth();
  const { db } = useStore();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.role !== role) return <Navigate to={homeFor(session.role)} replace />;
  if (role === 'CustomerAdmin') {
    const shop = db.shops.find((s) => s.id === session.shopId);
    if (!shop || !shop.active || !db.tenants[shop.id]) return <Navigate to="/login" replace state={{ reason: 'inactive' }} />;
  }
  return <Outlet />;
}
