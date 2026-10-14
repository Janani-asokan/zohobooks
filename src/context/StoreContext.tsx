import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { produce, type Draft } from 'immer';
import type { Database, PlatformConfig, Shop } from '@/lib/types';
import { emptyTenant, seedDatabase } from '@/lib/seed';

const STORAGE_KEY = 'ledgerly.db.v1';

function load(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Database;
      if (parsed?.version === 1) return parsed;
    }
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return seedDatabase();
}

interface StoreValue {
  db: Database;
  update: (recipe: (draft: Draft<Database>) => void) => void;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* quota exceeded or storage blocked — keep working in memory */
    }
  }, [db]);

  const update = useCallback((recipe: (draft: Draft<Database>) => void) => setDb((prev) => produce(prev, recipe)), []);
  const reset = useCallback(() => setDb(seedDatabase()), []);

  const value = useMemo(() => ({ db, update, reset }), [db, update, reset]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

/**
 * Platform-scoped access for the Super Admin.
 * Deliberately exposes only shop metadata + platform config — never tenant (shop) business data.
 */
export function usePlatform() {
  const { db, update } = useStore();
  return {
    config: db.platform,
    shops: db.shops,
    updateConfig: (patch: Partial<PlatformConfig>) => update((d) => void Object.assign(d.platform, patch)),
    updatePlatform: (recipe: (draft: Draft<Pick<Database, 'platform' | 'shops'>>) => void) => update((d) => recipe(d)),
    /** Creates the shop-owner account and provisions an empty, isolated workspace for it. */
    provisionShop: (shop: Shop) =>
      update((d) => {
        d.shops.unshift(shop);
        d.tenants[shop.id] = emptyTenant(shop);
      }),
  };
}
