import { Badge } from './ui';
import { usePrefs } from '@/context/PrefsContext';

const TONE: Record<string, string> = {
  Paid: 'green', 'Partially Paid': 'amber', Sent: 'blue', Overdue: 'red', Draft: 'gray', Void: 'gray', Unpaid: 'amber', Cancelled: 'gray',
  Accepted: 'green', Declined: 'red', Expired: 'gray', Invoiced: 'green', Confirmed: 'blue',
  'In transit': 'amber', Received: 'green', 'In stock': 'green', Sold: 'blue', 'Written off': 'gray', Open: 'blue', Packed: 'gray', Dispatched: 'amber', Delivered: 'green',
};

/** Payment-status badge with translated label. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = usePrefs();
  return <Badge tone={TONE[status] ?? 'gray'}>{t(`status.${status}`, status)}</Badge>;
}
