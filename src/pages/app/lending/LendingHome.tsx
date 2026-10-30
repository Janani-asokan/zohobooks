import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, HandCoins, IndianRupee, Landmark, MapPin, Plus, Siren, TrendingUp, UserCheck, Users, Wallet } from 'lucide-react';
import { useShopUser } from '@/context/AuthContext';
import { DUE_TONE, type DueRow, type Loan, type LoanPayment, useDues, useLendingDashboard, useLoans } from '@/api/lending';
import { Badge, EmptyState, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { CollectModal, ReceiptModal } from '@/components/lending';
import { ExportMenu } from '@/components/ExportMenu';
import { Hint } from '@/components/kit';
import { fmtDate, money, moneyShort, todayISO } from '@/lib/format';

const TABS = ['Not paid', 'Arrears', 'Less paid', 'Paid', 'Upcoming'] as const;

/** Money lending home: where the book stands today, who to collect from, and what needs attention. */
export default function LendingHome() {
  const me = useShopUser();
  const navigate = useNavigate();
  const canWrite = me.can('lending.write');
  const canCollect = me.can('lending.collect') || canWrite;
  const allLoans = !me.can('lending.read');
  const dash = useLendingDashboard();
  const loans = useLoans().data ?? [];
  const [date, setDate] = useState(todayISO());
  const dues = useDues(date);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Not paid');
  const [q, setQ] = useState('');
  const [collect, setCollect] = useState<Loan | null>(null);
  const [receipt, setReceipt] = useState<{ p: LoanPayment; l: Loan } | null>(null);
  const d = dash.data;
  const rows = dues.data?.rows ?? [];
  const count = (t: string) => rows.filter((r) => r.status === t).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.status === tab).filter((r) => !s || [r.borrower, r.number, r.mobile, r.area, r.collector].join(' ').toLowerCase().includes(s));
  }, [rows, tab, q]);
  const toCollect = rows.filter((r) => r.status !== 'Paid').reduce((s, r) => s + Math.max(r.short, r.pendingAmount), 0);
  const maxTrend = Math.max(1, ...(d?.trend ?? []).map((t) => t.total));

  return (
    <div className="page">
      <PageHeader title="Money lending" crumbs={<>Lending</>} icon={HandCoins}
        subtitle={allLoans ? 'Your assigned loans: what to collect today and what is overdue.' : 'Loans given, today’s collections, dues and alerts, area by area.'}
        actions={canWrite && <>
          <Link className="btn btn-secondary" to="/app/lending/borrowers?new=1"><Users size={15} /> New borrower</Link>
          <Link className="btn btn-primary" to="/app/lending/loans/new"><Plus size={16} /> Give a loan</Link>
        </>} />
      {canWrite ? (
        <Hint id="lending-home" title="How money lending works here" icon={HandCoins}>
          <p>Register a borrower and verify them, then <strong>Give a loan</strong>: interest is taken upfront and the borrower repays the amount in equal daily, weekly or monthly instalments. Collect from the list below; every receipt posts to your books. Loans close themselves at zero.</p>
        </Hint>
      ) : (
        <Hint id="lending-collector" title="Your collection round" icon={HandCoins}>
          <p>The list below shows who should pay today. Tap <strong>Collect</strong>, enter the amount, confirm, and hand over or WhatsApp the receipt. For UPI, type the transaction ID from the customer’s phone.</p>
        </Hint>
      )}

      {!d ? <div className="stat-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div> : (
        <div className="stat-grid">
          <StatCard label="Collected today" value={money(d.totals.todayCollection)} icon={IndianRupee} tone="green" foot={`${moneyShort(d.totals.monthCollection)} this month`} />
          <StatCard label="Outstanding" value={moneyShort(d.totals.outstanding)} icon={Wallet} tone="blue" foot={`${money(d.totals.outstanding)} · ${d.totals.activeLoans} open loan${d.totals.activeLoans === 1 ? '' : 's'}`} />
          <StatCard label="Overdue" value={moneyShort(d.totals.overdueAmount)} icon={AlertTriangle} tone="red" foot={`${money(d.totals.overdueAmount)} · ${d.totals.defaulters} defaulter${d.totals.defaulters === 1 ? '' : 's'}, ${d.totals.overdueLoans} past term`} />
          {allLoans
            ? <StatCard label="Closed" value={d.totals.closedLoans} icon={UserCheck} tone="violet" foot="Fully repaid" />
            : <StatCard label="Lent this month" value={moneyShort(d.totals.monthDisbursed)} icon={Landmark} tone="violet" foot={`${money(d.totals.monthDisbursed)} cash · ${moneyShort(d.totals.monthInterest)} interest`} />}
        </div>
      )}

      <div className="lend-grid mt-16">
        <section className="card">
          <div className="card-header">
            <div><h3>Collections for {date === todayISO() ? 'today' : fmtDate(date)}</h3><p>{money(toCollect)} to collect · each plan is judged on its day, week or month</p></div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="row small muted" style={{ gap: 6 }}><CalendarDays size={14} /><input id="dues-date" className="input" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ height: 34 }} /></label>
              <ExportMenu disabled={!shown.length} table={() => ({
                title: `Collections · ${tab}`, subtitle: fmtDate(date), filename: `collections-${date}`,
                columns: [{ label: 'Borrower' }, { label: 'Mobile' }, { label: 'Loan' }, { label: 'Area' }, { label: 'Plan' }, { label: 'Due', money: true }, { label: 'Paid', money: true }, { label: 'Pending', money: true }, { label: 'Since' }],
                rows: shown.map((r) => ({ cells: [r.borrower, r.mobile, r.number, r.area, r.frequency, r.scheduled, r.paid, r.pendingAmount, r.pendingSince ? fmtDate(r.pendingSince) : ''] })),
              })} />
            </div>
          </div>
          <div className="toolbar">
            <div className="toolbar-left">
              <SearchInput value={q} onChange={setQ} placeholder="Search borrower, loan, mobile, area…" />
              <div className="filter-chips" style={{ padding: 0 }}>
                {TABS.map((t) => <button key={t} className={`filter-chip ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t} <span className="n">{count(t)}</span></button>)}
              </div>
            </div>
          </div>
          <div className="table-wrap">
            {dues.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 180 }} /></div> : !shown.length ? (
              <EmptyState icon={UserCheck} title={tab === 'Not paid' || tab === 'Arrears' ? 'Nobody pending here' : `No “${tab}” loans`} text={tab === 'Not paid' ? 'Everyone due on this date has paid, or nothing is due.' : 'Pick another tab or date.'} />
            ) : (
              <table className="table">
                <thead><tr><th>Borrower</th><th>Plan</th><th className="num">Due this {shown[0]?.frequency === 'Daily' ? 'day' : 'cycle'}</th><th className="num">Pending</th><th /></tr></thead>
                <tbody>{shown.map((r) => <DueLine key={r.loanId} r={r} canCollect={canCollect && date === todayISO()} onCollect={() => { const l = loans.find((x) => x.id === r.loanId); if (l) setCollect(l); }} onOpen={() => navigate(`/app/lending/loans/${r.loanId}`)} />)}</tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-header"><div><h3><Siren size={16} /> Needs attention</h3><p>Day 90/95/100/130 alerts, EMIs past grace, defaulters</p></div></div>
            {!d?.alerts.length ? <div className="card-body small muted">No alerts. Everything is on track.</div> : (
              <ul className="lend-alerts">{d.alerts.slice(0, 8).map((a) => (
                <li key={a.loanId}><Link to={`/app/lending/loans/${a.loanId}`}>
                  <span className={`lend-dot ${a.overdueDays >= 60 || a.alert.startsWith('Day 130') ? 'bad' : 'warn'}`} />
                  <span style={{ flex: 1, minWidth: 0 }}><strong>{a.borrower}</strong><span className="small muted"> · {a.number} · {a.area}</span><div className="small">{a.alert}{a.overdueDays ? ` · ${a.overdueDays} days overdue` : ''}</div></span>
                  <span className="strong">{moneyShort(a.balance)}</span>
                </Link></li>
              ))}</ul>
            )}
          </section>
          {!!d?.areas.length && (
            <section className="card">
              <div className="card-header"><div><h3><MapPin size={16} /> Areas</h3><p>Outstanding and today’s collection</p></div></div>
              <div className="lend-areas">{d.areas.map((a) => (
                <div key={a.code} className="lend-area">
                  <div className="row between"><strong>{a.name} <span className="muted small">{a.code}</span></strong><span className="small muted">{a.activeLoans} loans</span></div>
                  <div className="row between small"><span>Outstanding</span><span className="strong">{moneyShort(a.outstanding)}</span></div>
                  <div className="row between small"><span>Today</span><span>{money(a.today)} · {a.paidToday} paid, {a.yetToPay} to go</span></div>
                </div>
              ))}</div>
            </section>
          )}
          {!!d?.collectors.length && !allLoans && (
            <section className="card">
              <div className="card-header"><div><h3><TrendingUp size={16} /> Collectors this month</h3></div></div>
              <table className="table"><tbody>{d.collectors.sort((a, b) => b.month - a.month).map((c) => <tr key={c.name}><td>{c.name}</td><td className="num small muted">{money(c.today)} today</td><td className="num strong">{moneyShort(c.month)}</td></tr>)}</tbody></table>
            </section>
          )}
          {!!d?.trend.length && (
            <section className="card">
              <div className="card-header"><div><h3>Collections by month</h3></div></div>
              <div className="lend-trend">{d.trend.map((t) => (
                <div key={t.month} title={`${t.month}: ${money(t.total)}`}><span style={{ height: `${Math.max(4, (t.total / maxTrend) * 100)}%` }} /><em>{new Date(`${t.month}-01`).toLocaleDateString('en-IN', { month: 'short' })}</em></div>
              ))}</div>
            </section>
          )}
        </aside>
      </div>

      {collect && <CollectModal loan={collect} onClose={() => setCollect(null)} onDone={(p, l) => { setCollect(null); setReceipt({ p, l }); }} />}
      {receipt && <ReceiptModal payment={receipt.p} loan={receipt.l} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function DueLine({ r, canCollect, onCollect, onOpen }: { r: DueRow; canCollect: boolean; onCollect: () => void; onOpen: () => void }) {
  return (
    <tr className="clickable" onClick={onOpen}>
      <td><span className="strong">{r.borrower}</span> <Badge tone={DUE_TONE[r.status]}>{r.status}</Badge><div className="muted small">{r.number} · {r.area}{r.mobile ? ` · ${r.mobile}` : ''}{r.collector ? ` · ${r.collector}` : ''}</div></td>
      <td>{r.frequency}<div className="muted small">{money(r.instalment)} / {r.frequency === 'Daily' ? 'day' : r.frequency === 'Weekly' ? 'week' : 'month'}</div></td>
      <td className="num">{money(r.scheduled)}<div className="muted small">paid {money(r.paid)}</div></td>
      <td className="num">{r.pendingCount ? <><span className="strong" style={{ color: 'var(--red-600)' }}>{money(r.pendingAmount)}</span><div className="muted small">{r.pendingCount} instalment{r.pendingCount === 1 ? '' : 's'} since {r.pendingSince ? fmtDate(r.pendingSince) : ''}</div></> : <span className="muted">—</span>}</td>
      <td className="num" onClick={(e) => e.stopPropagation()}>{canCollect && r.balance > 0 && <button className="btn btn-primary btn-sm" onClick={onCollect}><IndianRupee size={13} /> Collect</button>}</td>
    </tr>
  );
}
