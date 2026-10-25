import { useItemSerials } from '@/api/hooks';
import { splitSerials } from '@/components/StockLines';

/** Serial numbers for one invoice line: type or scan them, or click the ones in stock at the branch. */
export function SerialField({ itemId, branchId, qty, value, onChange }: { itemId: string; branchId?: string | null; qty: number; value: string[]; onChange: (v: string[]) => void }) {
  const q = useItemSerials(itemId);
  const available = (q.data ?? []).filter((s) => (s.status === 'In stock' && (!branchId || s.branchId === branchId)) || value.includes(s.serial));
  const free = available.filter((s) => !value.includes(s.serial));
  const ok = value.length === qty;
  return (
    <div className="serial-field">
      <input className={`input ${value.length && !ok ? 'invalid' : ''}`} value={value.join(', ')} onChange={(e) => onChange(splitSerials(e.target.value))} placeholder="Serial numbers (type, scan or pick below)" aria-label="Serial numbers" />
      <div className="small" style={{ color: ok ? 'var(--green-700)' : 'var(--ink-500)' }}>{value.length} of {qty} serial number{qty === 1 ? '' : 's'}{free.length && value.length < qty ? ' · pick from stock:' : q.data && !available.length ? ' · none registered at this branch' : ''}</div>
      {free.length > 0 && value.length < qty && (
        <div className="serial-chips">
          {free.slice(0, 12).map((s) => <button key={s.id} type="button" className="chip" onClick={() => onChange([...value, s.serial])}>{s.serial}</button>)}
          {free.length > 12 && <span className="small muted">+{free.length - 12} more</span>}
        </div>
      )}
    </div>
  );
}
