import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { fmtDate, money, todayISO } from '@/lib/format';
import { LENDING_RULES, LOAN_TYPES, quoteLoan, type LoanType } from '../../../../shared/lending';

/** Try amounts, rates and terms and compare the three plans side by side, with the same maths as a real loan. */
export default function Planner() {
  const [amount, setAmount] = useState(50000);
  const [rate, setRate] = useState<number>(LENDING_RULES.defaultMonthlyRate);
  const [periods, setPeriods] = useState<Record<LoanType, number>>({ ...LENDING_RULES.defaultPeriods });
  const quotes = useMemo(() => LOAN_TYPES.map((t) => {
    try { return { t, q: quoteLoan({ principal: amount, monthlyRate: rate, loanType: t, periods: periods[t], borrowDate: todayISO() }) }; } catch (e) { return { t, error: (e as Error).message }; }
  }), [amount, rate, periods]);

  return (
    <div className="page">
      <PageHeader title="EMI planner" crumbs={<><Link to="/app/lending">Microfinance</Link> <span>/</span> Planner</>} icon={Calculator}
        subtitle="Show a borrower what each plan means before you lend: cash in hand, instalment, and the last due date." />
      <div className="card card-body form-grid">
        <label className="span-all"><span className="small muted">Loan amount</span>
          <div className="row" style={{ gap: 12 }}><input id="pl-amt-r" type="range" min={5000} max={500000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ flex: 1 }} aria-label="Loan amount slider" />
            <div className="input-addon" style={{ width: 160 }}><span>₹</span><input id="pl-amt" className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></div></div></label>
        <label className="span-all"><span className="small muted">Interest per month (%)</span>
          <div className="row" style={{ gap: 12 }}><input id="pl-rate-r" type="range" min={LENDING_RULES.minMonthlyRate} max={LENDING_RULES.maxMonthlyRate} step={0.01} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ flex: 1 }} aria-label="Interest slider" />
            <input id="pl-rate" className="input" style={{ width: 160 }} type="number" step={0.01} value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} /></div></label>
      </div>
      <div className="lend-plans mt-16">
        {quotes.map(({ t, q, error }) => (
          <section key={t} className="card card-body">
            <div className="row between"><h3 style={{ margin: 0 }}>{t === 'Daily 100-Day' ? 'Daily' : t === 'Monthly EMI' ? 'Monthly' : t}</h3>
              <label className="small muted row" style={{ gap: 6 }}><input id={`pl-n-${t}`} className="input" type="number" min={1} max={600} value={periods[t]} onChange={(e) => setPeriods({ ...periods, [t]: Number(e.target.value) || 1 })} style={{ width: 76, height: 32 }} /> {t === 'Daily 100-Day' ? 'days' : t === 'Weekly' ? 'weeks' : 'months'}</label></div>
            {error || !q ? <p className="error-state small">{error}</p> : <>
              <div className="lq-cash"><span>Cash in hand</span><strong>{money(q.netDisbursed)}</strong></div>
              <dl className="lend-dl">
                <div><dt>Instalment</dt><dd className="strong">{money(q.instalment)}</dd></div>
                <div><dt>Interest (upfront)</dt><dd>{money(q.upfrontInterest)}</dd></div>
                <div><dt>Repay in total</dt><dd>{money(q.totalRepayment)}</dd></div>
                <div><dt>Last due</dt><dd>{fmtDate(q.maturity)}</dd></div>
                <div><dt>Effective yearly rate</dt><dd>{q.apr.toFixed(1)}%</dd></div>
              </dl>
              <Link className="btn btn-secondary btn-block" to={`/app/lending/loans/new`}>Use this plan</Link>
            </>}
          </section>
        ))}
      </div>
    </div>
  );
}
