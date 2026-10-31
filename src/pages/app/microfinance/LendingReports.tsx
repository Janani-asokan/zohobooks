import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart2 } from 'lucide-react';
import { api } from '@/api/client';
import { EmptyState, PageHeader } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { money, todayISO } from '@/lib/format';

const REPORTS = [
  { id: 'daily-collection', label: 'Daily collection', param: 'date' },
  { id: 'monthly-cashflow', label: 'Monthly cash flow', param: 'month' },
  { id: 'loan-book', label: 'Loan book' },
  { id: 'defaulters', label: 'Defaulters' },
  { id: 'areas', label: 'Areas' },
  { id: 'collectors', label: 'Collectors' },
  { id: 'profit', label: 'Interest & recovery', param: 'year' },
] as const;
type Report = { title: string; summary?: Record<string, number>; rows: Array<Record<string, string | number>> };

const LABEL: Record<string, string> = {
  cashOut: 'Cash lent', collected: 'Collected', net: 'Net cash', interestBooked: 'Interest booked', feesBooked: 'Fees', newLoans: 'New loans', receipts: 'Receipts', total: 'Total',
  loans: 'Loans', principal: 'Lent', paid: 'Repaid', outstanding: 'Outstanding', overdue: 'Overdue', interest: 'Interest', fees: 'Fees', lateCharges: 'Late charges',
  income: 'Total income', recoveryRate: 'Recovery rate %', atRisk: 'At risk (overdue loans)',
};
const COUNTS = new Set(['receipts', 'newLoans', 'loans', 'recoveryRate', 'loans_count']);
const head = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const MONEY_COLS = new Set(['amount', 'principal', 'cashGiven', 'interest', 'paid', 'balance', 'overdueAmount', 'given', 'collected', 'outstanding', 'today', 'thisMonth', 'total']);

/** Lending reports for the owner, the accountant and the bank. */
export default function LendingReports() {
  const [kind, setKind] = useState<(typeof REPORTS)[number]['id']>('daily-collection');
  const [date, setDate] = useState(todayISO());
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const def = REPORTS.find((r) => r.id === kind)!;
  const qs = 'param' in def ? `?${def.param}=${def.param === 'date' ? date : def.param === 'month' ? month : year}` : '';
  const q = useQuery({ queryKey: ['lending', 'report', kind, qs], queryFn: () => api.get<Report>(`/shop/lending/reports/${kind}${qs}`) });
  const r = q.data;
  const cols = r?.rows[0] ? Object.keys(r.rows[0]) : [];

  return (
    <div className="page">
      <PageHeader title="Microfinance reports" crumbs={<><Link to="/app/microfinance">Microfinance</Link> <span>/</span> Reports</>} icon={FileBarChart2}
        actions={<ExportMenu disabled={!r?.rows.length} table={() => ({ title: r!.title, subtitle: '', filename: kind, columns: cols.map((c) => ({ label: head(c), money: MONEY_COLS.has(c) })), rows: r!.rows.map((x) => ({ cells: cols.map((c) => x[c] ?? '') })) })} />} />
      <div className="filter-chips" style={{ padding: 0, marginBottom: 12 }}>
        {REPORTS.map((x) => <button key={x.id} className={`filter-chip ${kind === x.id ? 'active' : ''}`} onClick={() => setKind(x.id)}>{x.label}</button>)}
      </div>
      <div className="card">
        <div className="card-header">
          <div><h3>{r?.title ?? def.label}</h3></div>
          {'param' in def && (def.param === 'date' ? <input id="rp-date" className="input" type="date" max={todayISO()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
            : def.param === 'month' ? <input id="rp-month" className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 170 }} />
            : <select id="rp-year" className="select" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 120 }}>{[0, 1, 2, 3].map((i) => String(Number(todayISO().slice(0, 4)) - i)).map((y) => <option key={y}>{y}</option>)}</select>)}
        </div>
        {r?.summary && <div className="lend-summary">{Object.entries(r.summary).map(([k, v]) => <div key={k}><span>{LABEL[k] ?? head(k)}</span><strong>{COUNTS.has(k) ? v : money(v)}</strong></div>)}</div>}
        <div className="table-wrap">
          {q.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : !r?.rows.length ? <EmptyState icon={FileBarChart2} title="Nothing to show" text="Try another date or report." /> : (
            <table className="table">
              <thead><tr>{cols.map((c) => <th key={c} className={MONEY_COLS.has(c) ? 'num' : ''}>{head(c)}</th>)}</tr></thead>
              <tbody>{r.rows.map((x, i) => <tr key={i}>{cols.map((c) => <td key={c} className={MONEY_COLS.has(c) ? 'num' : ''}>{MONEY_COLS.has(c) ? money(Number(x[c])) : String(x[c] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
