import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandCoins, Plus } from 'lucide-react';
import { LOAN_TONE, useLendingSettings, useLoans } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, PageHeader, SearchInput, usePagination, Pagination } from '@/components/ui';
import { RepaidBar } from '@/components/lending';
import { ExportMenu } from '@/components/ExportMenu';
import { fmtDate, money } from '@/lib/format';

const STATUSES = ['All', 'Active', 'Overdue', 'Defaulters', 'Closed'] as const;

/** The loan book: every loan with its balance, how much is repaid, and filters to find any of them. */
export default function Loans() {
  const me = useShopUser();
  const navigate = useNavigate();
  const { data = [], isLoading } = useLoans();
  const settings = useLendingSettings().data;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('All');
  const [plan, setPlan] = useState('');
  const [area, setArea] = useState('');
  const [collector, setCollector] = useState('');
  const [month, setMonth] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((l) => status === 'All' || (status === 'Defaulters' ? l.state.isDefaulter : l.state.status === status))
      .filter((l) => (!plan || l.loanType === plan) && (!area || l.areaCode === area) && (!collector || l.collectorId === collector) && (!month || l.borrowDate.startsWith(month)))
      .filter((l) => !s || [l.number, l.borrowerName, l.borrowerCode, l.mobile, l.areaName].join(' ').toLowerCase().includes(s));
  }, [data, q, status, plan, area, collector, month]);
  const pg = usePagination(rows, 25);
  const tot = rows.reduce((t, l) => ({ principal: t.principal + l.principal, paid: t.paid + l.state.paid, balance: t.balance + l.state.balance }), { principal: 0, paid: 0, balance: 0 });
  const count = (s: (typeof STATUSES)[number]) => (s === 'All' ? data.length : s === 'Defaulters' ? data.filter((l) => l.state.isDefaulter).length : data.filter((l) => l.state.status === s).length);

  return (
    <div className="page">
      <PageHeader title="Loans" crumbs={<><Link to="/app/lending">Microfinance</Link> <span>/</span> Loans</>} icon={HandCoins}
        subtitle={`${money(tot.principal)} lent · ${money(tot.paid)} repaid · ${money(tot.balance)} outstanding${rows.length !== data.length ? ` (${rows.length} shown)` : ''}`}
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Loan book', subtitle: `${rows.length} loans`, filename: 'loan-book',
          columns: [{ label: 'Loan' }, { label: 'Date' }, { label: 'Borrower' }, { label: 'Area' }, { label: 'Plan' }, { label: 'Amount', money: true }, { label: 'Cash given', money: true }, { label: 'Interest', money: true }, { label: 'Paid', money: true }, { label: 'Balance', money: true }, { label: 'Status' }, { label: 'Collector' }],
          rows: rows.map((l) => ({ cells: [l.number, fmtDate(l.borrowDate), `${l.borrowerName} (${l.borrowerCode})`, l.areaCode, l.loanType, l.principal, l.netDisbursed, l.upfrontInterest, l.state.paid, l.state.balance, l.state.status, l.collectorName] })),
        })} />{me.can('lending.write') && <Link className="btn btn-primary" to="/app/lending/loans/new"><Plus size={16} /> Give a loan</Link>}</>} />
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search loan number, borrower, mobile…" />
            <select id="l-plan" className="select" style={{ width: 150 }} value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan"><option value="">All plans</option>{settings?.loanTypes.map((t) => <option key={t}>{t}</option>)}</select>
            <select id="l-area" className="select" style={{ width: 140 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{settings?.areas.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select>
            {me.can('lending.read') && <select id="l-coll" className="select" style={{ width: 150 }} value={collector} onChange={(e) => setCollector(e.target.value)} aria-label="Collector"><option value="">All collectors</option>{settings?.collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            <input id="l-month" className="input" type="month" style={{ width: 150 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month lent" />
          </div>
          <div className="filter-chips" style={{ padding: 0 }}>
            {STATUSES.map((s) => <button key={s} className={`filter-chip ${status === s ? 'active' : ''}`} onClick={() => { setStatus(s); pg.setPage(1); }}>{s} <span className="n">{count(s)}</span></button>)}
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 240 }} /></div> : !rows.length ? (
            <EmptyState icon={HandCoins} title={data.length ? 'No loans match' : 'No loans yet'} text="Give a loan to a verified borrower to start your book." action={me.can('lending.write') && <Link className="btn btn-primary" to="/app/lending/loans/new"><Plus size={15} /> Give a loan</Link>} />
          ) : (
            <table className="table lend-book">
              <thead><tr><th>Loan</th><th>Borrower</th><th>Plan</th><th className="num">Amount</th><th>Repaid</th><th className="num">Balance</th><th>Status</th></tr></thead>
              <tbody>{pg.slice.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => navigate(`/app/lending/loans/${l.id}`)}>
                  <td className="strong">{l.number}<div className="muted small">{fmtDate(l.borrowDate)}</div></td>
                  <td>{l.borrowerName} <span className="muted small">{l.borrowerCode}</span><div className="muted small">{l.areaName}{l.collectorName ? ` · ${l.collectorName}` : ''}</div></td>
                  <td>{l.loanType}<div className="muted small">{money(l.instalment)} × {l.periods}</div></td>
                  <td className="num">{money(l.principal)}<div className="muted small">cash {money(l.netDisbursed)}</div></td>
                  <td><RepaidBar loan={l} /><div className="muted small">{l.state.instalmentsPaid}/{l.periods}{l.state.nextDue ? ` · next ${fmtDate(l.state.nextDue)}` : ''}</div></td>
                  <td className="num strong">{money(l.state.balance)}{l.state.penaltyBalance > 0 && <div className="muted small">incl. {money(l.state.penaltyBalance)} late</div>}</td>
                  <td><Badge tone={LOAN_TONE[l.state.status]}>{l.state.status}</Badge>{l.state.isDefaulter && <div className="small" style={{ color: 'var(--red-600)' }}>{l.state.overdueDays}d overdue</div>}{l.state.alert && !l.state.isDefaulter && <div className="small" style={{ color: 'var(--amber-700, #a15c07)' }}>{l.state.alert}</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {rows.length > 25 && <Pagination page={pg.page} pages={pg.pages} setPage={pg.setPage} total={pg.total} pageSize={pg.pageSize} />}
      </div>
    </div>
  );
}
