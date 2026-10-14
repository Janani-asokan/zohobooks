import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role, Session } from '@/lib/types';
import { useStore } from './StoreContext';
import { daysUntil } from '@/lib/fy';

const SESSION_KEY = 'ledgerly.session';

interface AuthValue {
  session: Session | null;
  login: (email: string, password: string, role: Role, remember?: boolean) => { ok: true; redirect: string } | { ok: false; error: string };
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export const homeFor = (role: Role) => (role === 'SuperAdmin' ? '/super-admin' : '/app');

export function AuthProvider({ children }: { children: ReactNode }) {
  const { db } = useStore();
  const [session, setSession] = useState<Session | null>(readSession);

  const persist = (s: Session | null, remember = true) => {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      if (s) (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    setSession(s);
  };

  /**
   * Intercepts credentials and resolves the actual role from the user directory.
   * The role dropdown on the login page is a testing aid: it must match the account's real role.
   */
  const login = useCallback<AuthValue['login']>(
    (email, password, role, remember = true) => {
      const e = email.trim().toLowerCase();
      if (db.superAdmin.email.toLowerCase() === e) {
        if (db.superAdmin.password !== password) return { ok: false, error: 'Incorrect password. Please try again.' };
        if (role !== 'SuperAdmin') return { ok: false, error: 'This account is a Super Admin. Switch the role to “Super Admin”.' };
        persist({ role: 'SuperAdmin', name: db.superAdmin.name, email: db.superAdmin.email }, remember);
        return { ok: true, redirect: '/super-admin' };
      }
      const shop = db.shops.find((s) => s.email.toLowerCase() === e);
      if (!shop) return { ok: false, error: 'No account found with this email address.' };
      if (shop.password !== password) return { ok: false, error: 'Incorrect password. Please try again.' };
      if (role !== 'CustomerAdmin') return { ok: false, error: 'This account is a Shop Owner. Switch the role to “Customer Admin”.' };
      if (!shop.active) return { ok: false, error: 'This workspace has been deactivated. Contact your service provider.' };
      if (daysUntil(shop.licenseEnd) < 0) return { ok: false, error: 'Your software license has expired. Please renew to continue.' };
      persist({ role: 'CustomerAdmin', name: shop.ownerName, email: shop.email, shopId: shop.id }, remember);
      return { ok: true, redirect: '/app' };
    },
    [db.superAdmin, db.shops],
  );

  const logout = useCallback(() => persist(null), []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
