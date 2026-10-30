import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banknote, CalendarDays, IndianRupee, ReceiptIndianRupee, Search, Smartphone, Landmark } from 'lucide-react';
import { LOAN_TONE, type Loan, type LoanPayment, useDayReceipts, useLoans } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { CollectModal, ReceiptModal } from '@/components/lending';
import { ExportMenu } from '@/components/ExportMenu';
import { fmtDate, money, todayISO } from '@/lib/format';

/** Collection counter: find a loan by name, number or mobile and take the payment; today's receipts below. */
export default function Collections() {
  const me = useShopUser();
  const navigate = useNavigate();
  const canCollect = me.can('lending.collect') || me.can('lending.write');
  const loans = useLoans().data ?? [];
  const [q, setQ] = useState('');
  const [date, setDate] = useState(todayISO());
  const day = useDayReceipts(date);
  const [collect, setCollect] = useState<Loan | null>(null);
  const [receipt, setReceipt] = useState<{ p: LoanPayment; l: Pick<Loan, 'number' | 'borrowerName' | 'borrowerCode' | 'mobile' | 'loanType' | 'state'> } | null>(null);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return loans.filter((l) => l.state.status === 'Active' || l.state.status === 'Overdue')
      .filter((l) => [l.number, l.borrowerName, l.borrowerCode, l.mobile].join(' ').toLowerCase().includes(s)).slice(0, 8);
  }, [q, loans]);
  const r = day.data;

  return (
    <div className="page">
      <PageHeader title="Collections" crumbs={<><Link to="/app/lending">Lending</Link> <span>/</span> Collections</>} icon={ReceiptIndianRupee}
        subtitle={me.can('lending.read') ? 'Take payments and see every receipt of the day.' : 'Take payments on your loans and see your receipts.'} />

      {canCollect && (
        <section className="card card-body">
          <div className="input-addon lend-find"><span><Search size={16} /></span><input id="col-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Borrower name, loan number or mobile…" autoFocus /></div>
          {q.trim().length >= 2 && (!found.length ? <p className="small muted" style={{ marginTop: 10 }}>No open loan matches “{q}”.</p> : (
            <ul className="lend-found">{found.map((l) => (
              <li key={l.id}>
                <button className="lend-found-main" onClick={() => navigate(`/app/lending/loans/${l.id}`)}>
                  <strong>{l.borrowerName}</strong> <span className="muted small">{l.borrowerCode} · {l.number} · {l.mobile}</span>
                  <div className="small">{l.loanType} · {money(l.instalment)} / {l.loanType === 'Daily 100-Day' ? 'day' : l.loanType === 'Weekly' ? 'week' : 'month'} · balance <strong>{money(l.state.balance)}</strong>
                    {l.state.overdueAmount > 0 && <span style={{ color: 'var(--red-600)' }}> · {money(l.state.overdueAmount)} overdue</span>} <Badge tone={LOAN_TONE[l.state.status]}>{l.state.status}</Badge></div>
                </button>
                <button className="btn btn-primary" onClick={() => setCollect(l)}><IndianRupee size={15} /> Collect</button>
              </li>
            ))}</ul>
          ))}
        </section>
      )}

      <div className="row between mt-16" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Receipts for {date === todayISO() ? 'today' : fmtDate(date)}</h3>
        <div className="row" style={{ gap: 8 }}>
          <label className="row small muted" style={{ gap: 6 }}><CalendarDays size={14} /><input id="col-date" className="input" type="date" max={todayISO()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ height: 34 }} /></label>
          <ExportMenu disabled={!r?.payments.length} table={() => ({
            title: 'Collections', subtitle: fmtDate(date), filename: `receipts-${date}`,
            columns: [{ label: 'Time' }, { label: 'Receipt' }, { label: 'Borrower' }, { label: 'Loan' }, { label: 'Mode' }, { label: 'Reference' }, { label: 'Collector' }, { label: 'Amount', money: true }, { label: 'Status' }],
            rows: (r?.payments ?? []).map((p) => ({ cells: [new Date(p.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }), p.receiptNo, p.borrowerName ?? '', p.loanNumber ?? '', p.mode, p.reference, p.collectorName, p.amount, p.status] })),
          })} />
        </div>
      </div>
      <div className="stat-grid mt-16">
        <StatCard label="Total" value={money(r?.total ?? 0)} icon={IndianRupee} tone="green" foot={`${r?.payments.filter((p) => p.status === 'Posted').length ?? 0} receipts`} />
        <StatCard label="Cash" value={money(r?.byMode.Cash ?? 0)} icon={Banknote} tone="amber" />
        <StatCard label="UPI" value={money(r?.byMode.UPI ?? 0)} icon={Smartphone} tone="violet" />
        <StatCard label="Bank transfer" value={money(r?.byMode['Bank Transfer'] ?? 0)} icon={Landmark} tone="blue" />
      </div>
      <div className="card mt-16">
        <div className="table-wrap">
          {!r ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 160 }} /></div> : !r.payments.length ? <EmptyState icon={ReceiptIndianRupee} title="No receipts" text="Payments you take appear here with their receipt numbers." /> : (
            <table className="table">
              <thead><tr><th>Time</th><th>Receipt</th><th>Borrower</th><th>Mode</th><th>Collector</th><th className="num">Amount</th></tr></thead>
              <tbody>{r.payments.map((p) => (
                <tr key={p.id} className={`clickable ${p.status === 'Reversed' ? 'muted' : ''}`} onClick={() => p.status === 'Posted' && setReceipt({ p, l: { number: p.loanNumber ?? '', borrowerName: p.borrowerName ?? '', borrowerCode: p.borrowerCode ?? '', mobile: loans.find((x) => x.id === p.loanId)?.mobile ?? '', loanType: loans.find((x) => x.id === p.loanId)?.loanType ?? 'Daily 100-Day', state: loans.find((x) => x.id === p.loanId)?.state as Loan['state'] } })}>
                  <td>{new Date(p.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{p.receiptNo}{p.status === 'Reversed' && <Badge tone="gray">Reversed</Badge>}</td>
                  <td>{p.borrowerName} <span className="muted small">{p.loanNumber}</span></td>
                  <td>{p.mode}{p.reference ? <div className="muted small">{p.reference}</div> : null}</td>
                  <td>{p.collectorName}</td>
                  <td className="num strong">{money(p.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      {collect && <CollectModal loan={collect} onClose={() => setCollect(null)} onDone={(p, l) => { setCollect(null); setQ(''); setReceipt({ p, l }); }} />}
      {receipt && <ReceiptModal payment={receipt.p} loan={receipt.l} onClose={() => setReceipt(null)} />}
    </div>
  );
}
