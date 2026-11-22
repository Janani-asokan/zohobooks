/** Staff attendance: turning check-in / check-out marks into days present and hours worked. */
import { istDate } from './support';

export interface Mark { userId: string; kind: 'in' | 'out'; day: string; at: string; outside?: boolean; method?: string; manual?: boolean; note?: string }
export interface DaySummary { status: 'present' | 'in' | 'absent'; firstIn: string | null; lastOut: string | null; minutes: number; open: boolean }
export interface PersonSummary { daysPresent: number; minutes: number; days: Record<string, DaySummary>; outsideMarks: number; noBiometricMarks: number; manualMarks: number }

/**
 * Per person and day: first check-in, last check-out and minutes worked (each check-in paired with the next
 * check-out). A day still open counts up to now when it is today; an earlier day left open (no check-out) counts
 * as present but adds no hours, and is flagged so the owner can fix it by hand.
 */
export function attendanceSummary(marks: Mark[], _from: string, _to: string, now: Date): Record<string, PersonSummary> {
  const today = istDate(now);
  const out: Record<string, PersonSummary> = {};
  const sorted = [...marks].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const open = new Map<string, number>(); // userId|day → check-in time
  for (const m of sorted) {
    const p = (out[m.userId] ??= { daysPresent: 0, minutes: 0, days: {}, outsideMarks: 0, noBiometricMarks: 0, manualMarks: 0 });
    const d = (p.days[m.day] ??= { status: 'present', firstIn: null, lastOut: null, minutes: 0, open: false });
    if (m.outside) p.outsideMarks++;
    if (m.manual) p.manualMarks++;
    if (m.note?.startsWith('No fingerprint')) p.noBiometricMarks++;
    const k = `${m.userId}|${m.day}`;
    const t = new Date(m.at).getTime();
    if (m.kind === 'in') {
      d.firstIn ??= m.at;
      if (!open.has(k)) open.set(k, t);
    } else {
      d.lastOut = m.at;
      const start = open.get(k);
      if (start !== undefined) { d.minutes += Math.max(0, Math.round((t - start) / 60000)); open.delete(k); }
    }
  }
  for (const [k, start] of open) {
    const [userId, day] = k.split('|') as [string, string];
    const d = out[userId]!.days[day]!;
    d.open = true;
    if (day === today) { d.status = 'in'; d.minutes += Math.max(0, Math.round((now.getTime() - start) / 60000)); }
  }
  for (const p of Object.values(out)) {
    p.daysPresent = Object.keys(p.days).length;
    p.minutes = Object.values(p.days).reduce((s, d) => s + d.minutes, 0);
  }
  return out;
}

export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
