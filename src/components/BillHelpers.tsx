import { History } from 'lucide-react';
import { fmtDate } from '@/lib/format';

/**
 * Small helpers that take typing out of billing, shared by invoices, quotes, sales orders, purchase bills and POS:
 * remember the last party and branch on this device, offer to repeat the party's last document, and move the cursor
 * to the first empty item box.
 */

/** What was used last on this screen by this user, kept on this device only (a private window simply forgets). */
export function remembered<T>(key: string) {
  return {
    read: (): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; } },
    save: (v: T) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
}

/** The party's most recent document (by date, then newest saved). */
export function latestFor<T extends { date: string; createdAt?: string }>(docs: T[], match: (d: T) => boolean): T | undefined {
  return docs.filter(match).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
}

/** Puts the cursor in the first empty item box of the item table on screen. */
export const focusFirstItem = () => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('tr.line-blank input')?.focus());

export function RepeatLastButton({ doc, label = 'Repeat last bill', onClick }: { doc: { number: string | null; date: string; lines: unknown[] }; label?: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-soft btn-sm" style={{ marginTop: 8 }} onClick={onClick}>
      <History size={14} /> {label} · {doc.number ?? 'draft'} ({doc.lines.length} item{doc.lines.length === 1 ? '' : 's'}, {fmtDate(doc.date)})
    </button>
  );
}

/** "Same … as last time · Change" under a pre-filled party. */
export function RememberedNote({ what, onChange }: { what: string; onChange: () => void }) {
  return (
    <div className="small muted" style={{ marginTop: 4 }}>
      Same {what} as last time · <button type="button" className="link-btn" onClick={onChange}>Change</button>
    </div>
  );
}
