import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { hasFeature } from '../../shared/features';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import type { Me } from '@/api/types';
import type { Permission } from '../../shared/permissions';
import { IS_APP, cacheClear, setAppToken } from '@/lib/platform';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
  can: (p: Permission) => boolean;
  /** Open another organisation this login has access to. */
  switchOrg: (shopId: string) => Promise<Me>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Forget everything cached for the previous account, but keep the ['me'] query itself:
 * clearing it would detach the auth observer and leave the app thinking nobody is signed in.
 */
const dropDataCache = (qc: QueryClient) => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });

/** The last signed-in user on this device, for opening the app without internet. Cleared on sign-out and on 401. */
const ME_KEY = 'c360.me';
function rememberMe(me: Me | null) { try { if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY); } catch { /* private mode */ } }
function lastMe(): Me | null { try { const v = localStorage.getItem(ME_KEY); return v ? (JSON.parse(v) as Me) : null; } catch { return null; } }

export const homeFor = (me: Me) => (me.kind === 'super' ? '/super-admin' : '/app');

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api.get<Me>('/auth/me');
        rememberMe(me);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { rememberMe(null); return null; }
        // No internet: the session cookie is still on this device, so open the app as the same person (the counter can
        // keep billing offline). Every request still goes to the server, which checks the session when it is back.
        if (e instanceof ApiError && e.code === 'network') { const last = lastMe(); if (last) return last; }
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Any 401 / license / forced-password response from the API refreshes who we are.
  useEffect(() => {
    const onAuth = (ev: Event) => {
      const err = (ev as CustomEvent<ApiError>).detail;
      if (err.status === 401) qc.setQueryData(['me'], null);
      else refetch();
    };
    window.addEventListener('api:auth', onAuth);
    return () => window.removeEventListener('api:auth', onAuth);
  }, [qc, refetch]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const { token, ...me } = await api.post<Me & { token?: string }>('/auth/login', { email, password, remember });
      // Phone app: the session is a bearer token kept on the phone.
      if (IS_APP) { setAppToken(token ?? null); await cacheClear(); }
      dropDataCache(qc);
      rememberMe(me);
      qc.setQueryData(['me'], me);
      return me;
    },
    [qc],
  );

  const switchOrg = useCallback(
    async (shopId: string) => {
      const me = await api.post<Me>('/auth/switch', { shopId });
      dropDataCache(qc);
      rememberMe(me);
      qc.setQueryData(['me'], me);
      return me;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    if (IS_APP) { setAppToken(null); await cacheClear(); }
    dropDataCache(qc);
    rememberMe(null);
    qc.setQueryData(['me'], null);
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({
      me: data ?? null,
      loading: isLoading,
      login,
      logout,
      refresh: refetch,
      switchOrg,
      can: (p) => data?.kind === 'user' && data.permissions.includes(p),
    }),
    [data, isLoading, login, logout, refetch, switchOrg],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Shop-user session (throws if used outside the /app shell). */
export function useShopUser() {
  const { me, can } = useAuth();
  if (me?.kind !== 'user') throw new Error('Not a shop user');
  /** True when the shop has this add-on feature (at `minLevel` or above). Core billing needs no check. */
  const has = (key: string, minLevel?: string) => hasFeature(me.shop.features ?? {}, key, minLevel);
  return { ...me, can, has };
}
