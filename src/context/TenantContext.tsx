import { useCallback } from 'react';
import type { Draft } from 'immer';
import type { Tenant } from '@/lib/types';
import { useStore } from './StoreContext';
import { useAuth } from './AuthContext';
import { fyLabel } from '@/lib/fy';

/** Scoped access to the logged-in shop's data only (tenant isolation). */
export function useTenant() {
  const { db, update } = useStore();
  const { session } = useAuth();
  const shopId = session?.shopId ?? '';
  const tenant = db.tenants[shopId] as Tenant;
  const shop = db.shops.find((s) => s.id === shopId)!;
  const platform = db.platform;

  const mutate = useCallback(
    (recipe: (t: Draft<Tenant>) => void) => update((d) => recipe(d.tenants[shopId]!)),
    [update, shopId],
  );

  const activeTaxSlabs = platform.taxSlabs.filter((s) => s.active);
  const taxRateOf = (slabId: string) => platform.taxSlabs.find((s) => s.id === slabId)?.rate ?? 0;

  /** Peek at the next invoice number without consuming it. */
  const nextInvoiceNumber = (date: string) => {
    const fy = fyLabel(date, platform.fyStartMonth);
    const key = platform.autoResetInvoiceNumbering ? fy : 'all';
    const n = (tenant.counters.invoice[key] ?? 0) + 1;
    return { fy, key, number: `INV-${platform.autoResetInvoiceNumbering ? fy + '-' : ''}${String(n).padStart(4, '0')}`, n };
  };

  const nextCustomerId = () => `${platform.customerIdPrefix}-${tenant.counters.customer + 1}`;

  return { tenant, shop, platform, mutate, activeTaxSlabs, taxRateOf, nextInvoiceNumber, nextCustomerId };
}
