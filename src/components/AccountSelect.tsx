import type { LedgerAccount } from '@/api/types';
import { ACCOUNT_TYPES, TYPE_LABEL } from '../../shared/accounting';

/** Native select grouped by account type: fast to type into and works with any keyboard or screen reader. */
export function AccountSelect({ accounts, value, onChange, invalid, placeholder = 'Choose an account…', label = 'Account' }: {
  accounts: LedgerAccount[]; value: string; onChange: (key: string) => void; invalid?: boolean; placeholder?: string; label?: string;
}) {
  const live = accounts.filter((a) => !a.archived);
  return (
    <select className={`select ${invalid ? 'invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{placeholder}</option>
      {ACCOUNT_TYPES.map((t) => {
        const list = live.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
        return list.length ? <optgroup key={t} label={TYPE_LABEL[t]}>{list.map((a) => <option key={a.key} value={a.key}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}</optgroup> : null;
      })}
    </select>
  );
}
