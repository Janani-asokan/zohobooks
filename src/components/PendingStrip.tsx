import { useCallback, useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useShopUser } from '@/context/AuthContext';
import { onOutboxChange, pendingFor, type OutboxEntry } from '@/lib/outbox';
import { OfflineBillsModal } from '@/components/OfflineBills';

/**
 * "Waiting to send" note on a screen: what was saved on this device for it (new invoices on the invoice list, a
 * payment on its invoice…), so nobody saves it twice thinking it was lost.
 */
export function PendingStrip({ match, what }: { match: (e: OutboxEntry) => boolean; what: [string, string] }) {
  const me = useShopUser();
  const [list, setList] = useState<OutboxEntry[]>([]);
  const [open, setOpen] = useState(false);
  // `match` changes every render; the note only needs to refresh when the saved changes do.
  const load = useCallback(() => { void pendingFor(me.shop.id, match).then(setList); }, [me.shop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return onOutboxChange(load); }, [load]);
  if (!list.length) return null;
  const failed = list.filter((e) => e.status === 'failed').length;
  return (
    <div className="pos-offline" role="status">
      <CloudOff size={16} />
      <span style={{ flex: 1 }}>
        <strong>{list.length} {list.length === 1 ? what[0] : what[1]} saved on this device</strong>{failed ? `, ${failed} couldn’t be saved: check it` : ', sent by itself when the internet is back'}: {list.slice(0, 3).map((e) => e.label).join(' · ')}{list.length > 3 ? ' …' : ''}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Offline changes</button>
      <OfflineBillsModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
