import { Badge } from './ui';
import { usePrefs } from '@/context/PrefsContext';

const TONE: Record<string, string> = { Paid: 'green', 'Partially Paid': 'blue', Unpaid: 'amber', Overdue: 'red', Draft: 'gray', Cancelled: 'gray' };

/** Payment-status badge with translated label. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = usePrefs();
  return <Badge tone={TONE[status] ?? 'gray'}>{t(`status.${status}`, status)}</Badge>;
}
