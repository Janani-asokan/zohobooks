import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import type { Me } from '@/api/types';
import type { Permission } from '../../shared/permissions';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Forget everything cached for the previous account, but keep the ['me'] query itself:
 * clearing it would detach the auth observer and leave the app thinking nobody is signed in.
 */
const dropDataCache = (qc: QueryClient) => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });

export const homeFor = (me: Me) => (me.kind === 'super' ? '/super-admin' : '/app');

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
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
      const me = await api.post<Me>('/auth/login', { email, password, remember });
      dropDataCache(qc);
      qc.setQueryData(['me'], me);
      return me;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    dropDataCache(qc);
    qc.setQueryData(['me'], null);
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({
      me: data ?? null,
      loading: isLoading,
      login,
      logout,
      refresh: refetch,
      can: (p) => data?.kind === 'user' && data.permissions.includes(p),
    }),
    [data, isLoading, login, logout, refetch],
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
  return { ...me, can };
}
