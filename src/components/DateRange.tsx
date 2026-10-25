import { useMemo } from 'react';
import { todayISO, toISO } from '@/lib/format';

export interface Range { from: string; to: string }

/** Common periods for reports, with financial years starting in `fyStartMonth` (April in India). */
export function periodPresets(fyStartMonth: number, today = todayISO()) {
  const t = new Date(today + 'T00:00:00');
  const y = t.getFullYear(), m = t.getMonth();
  const d = (yy: number, mm: number, dd: number) => toISO(new Date(yy, mm, dd));
  const fyY = m + 1 >= fyStartMonth ? y : y - 1;
  const q = Math.floor(((m - (fyStartMonth - 1) + 12) % 12) / 3);
  const qStartMonth = fyStartMonth - 1 + q * 3;
  return [
    { id: 'this_month', label: 'This month', from: d(y, m, 1), to: today },
    { id: 'last_month', label: 'Last month', from: d(y, m - 1, 1), to: d(y, m, 0) },
    { id: 'this_quarter', label: 'This quarter', from: d(fyY, qStartMonth, 1), to: today },
    { id: 'last_quarter', label: 'Last quarter', from: d(fyY, qStartMonth - 3, 1), to: d(fyY, qStartMonth, 0) },
    { id: 'this_fy', label: 'This financial year', from: d(fyY, fyStartMonth - 1, 1), to: today },
    { id: 'last_fy', label: 'Last financial year', from: d(fyY - 1, fyStartMonth - 1, 1), to: d(fyY, fyStartMonth - 1, 0) },
  ];
}

export const rangeLabel = (r: Range) => {
  const f = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
};

/** Preset picker plus from/to dates. With `asOf`, only a single date is shown. */
export function DateRange({ value, onChange, fyStartMonth, asOf }: { value: Range; onChange: (r: Range) => void; fyStartMonth: number; asOf?: boolean }) {
  const presets = useMemo(() => periodPresets(fyStartMonth), [fyStartMonth]);
  const asOfPresets = useMemo(() => [
    { id: 'today', label: 'Today', to: todayISO() },
    ...presets.filter((p) => p.id === 'last_month' || p.id === 'last_quarter' || p.id === 'last_fy').map((p) => ({ id: p.id, label: `End of ${p.label.toLowerCase()}`, to: p.to })),
  ], [presets]);
  const current = asOf ? asOfPresets.find((p) => p.to === value.to)?.id ?? 'custom' : presets.find((p) => p.from === value.from && p.to === value.to)?.id ?? 'custom';
  return (
    <div className="report-filters no-print" role="group" aria-label="Report period">
      <select className="select" value={current} aria-label="Period" onChange={(e) => {
        if (asOf) { const p = asOfPresets.find((x) => x.id === e.target.value); if (p) onChange({ from: value.from, to: p.to }); return; }
        const p = presets.find((x) => x.id === e.target.value);
        if (p) onChange({ from: p.from, to: p.to });
      }}>
        {(asOf ? asOfPresets : presets).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom">Custom dates</option>
      </select>
      {!asOf && <><input className="input" type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label="From" /><span className="muted">to</span></>}
      <input className="input" type="date" value={value.to} min={asOf ? undefined : value.from} max={todayISO()} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label={asOf ? 'As of' : 'To'} />
    </div>
  );
}
