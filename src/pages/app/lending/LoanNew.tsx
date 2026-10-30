import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CalendarClock, HandCoins, Loader2, Search } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import { LENDING_KEYS, type Loan, useBorrowers, useLendingSettings } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, Field, Modal, PageHeader, Segmented, Toggle } from '@/components/ui';
import { fmtDate, money, todayISO } from '@/lib/format';
import { LENDING_RULES, LOAN_TYPES, addDays, quoteLoan, type LoanType, type Quote } from '../../../../shared/lending';

const PLAN_HELP: Record<LoanType, string> = {
  'Daily 100-Day': 'Repaid every day, usually over 100 days',
  Weekly: 'Repaid every week',
  'Monthly EMI': 'Repaid every month',
};

/** Give a loan: pick a verified borrower, set the plan, see exactly what they get and repay, then confirm. */
export default function LoanNew() {
  const me = useShopUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useLendingSettings().data;
  const borrowers = useBorrowers().data ?? [];
  const today = todayISO();
  const [f, setF] = useState({
    borrowerId: params.get('borrower') ?? '', loanType: 'Daily 100-Day' as LoanType, principal: '', monthlyRate: String(LENDING_RULES.defaultMonthlyRate), periods: '100',
    borrowDate: today, processingFee: '', lateFee: '', cashHandover: '', collectorId: '', disbursementMode: 'Cash', accountId: '', ackReference: '',
    existingLoan: false, alreadyRepaid: '', repaidUpTo: today, notes: '',
  });
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { if (settings && !f.collectorId) set({ collectorId: settings.collectors.find((c) => c.id === me.user.id)?.id ?? settings.collectors[0]?.id ?? '' }); }, [settings]);

  const borrower = borrowers.find((b) => b.id === f.borrowerId);
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (s.length < 2) return [];
    return borrowers.filter((b) => [b.name, b.code, b.mobile, b.fatherName].join(' ').toLowerCase().includes(s)).slice(0, 6);
  }, [search, borrowers]);
  const approved = (s: string) => s === 'Verified' || s === 'Manual Verification Approved';

  // Live quote with the same code the server books with.
  const quote: Quote | string | null = useMemo(() => {
    if (!(Number(f.principal) > 0)) return null;
    try {
      return quoteLoan({ principal: Number(f.principal), monthlyRate: Number(f.monthlyRate), loanType: f.loanType, periods: Number(f.periods), borrowDate: f.borrowDate || today,
        processingFee: Number(f.processingFee) || 0, cashHandover: f.existingLoan ? null : Number(f.cashHandover) || null });
    } catch (e) { return (e as Error).message; }
  }, [f.principal, f.monthlyRate, f.loanType, f.periods, f.borrowDate, f.processingFee, f.cashHandover, f.existingLoan]);
  const q = typeof quote === 'object' ? quote : null;

  const create = useMut((b: Record<string, unknown>) => api.post<Loan>('/shop/lending/loans', b), LENDING_KEYS, { success: (l) => `${l.number} created`, silentError: true });
  const minDate = addDays(today, -(f.existingLoan ? LENDING_RULES.existingLoanMaxAgeDays : LENDING_RULES.newLoanBackdateDays));
  const check = () => {
    const e: Record<string, string> = {};
    if (!borrower) e.borrowerId = 'Choose a borrower';
    else if (!approved(borrower.status)) e.borrowerId = `${borrower.name} is not verified yet`;
    if (!q) e.principal = typeof quote === 'string' ? quote : 'Enter the loan amount';
    if (!f.existingLoan && f.ackReference.trim().length < 3) e.ackReference = 'Required: signed slip number or how the borrower confirmed';
    if (f.borrowDate < minDate || f.borrowDate > today) e.borrowDate = f.existingLoan ? 'Up to 5 years back' : `Today or up to ${LENDING_RULES.newLoanBackdateDays} days back. For older loans tick “Existing loan”.`;
    if (f.existingLoan && q && Number(f.alreadyRepaid) > q.totalRepayment) e.alreadyRepaid = `At most ${money(q.totalRepayment)}`;
    setErr(e);
    if (!Object.keys(e).length) setConfirm(true);
  };
  const submit = () => create.mutate({
    ...f, principal: Number(f.principal), monthlyRate: Number(f.monthlyRate), periods: Number(f.periods), processingFee: Number(f.processingFee) || 0, lateFee: Number(f.lateFee) || 0,
    cashHandover: f.existingLoan ? null : Number(f.cashHandover) || null, collectorId: f.collectorId || null, accountId: f.accountId || null, alreadyRepaid: Number(f.alreadyRepaid) || 0,
  }, { onSuccess: (l) => navigate(`/app/lending/loans/${l.id}`, { replace: true }), onError: (x) => { setConfirm(false); setErr({ ...fieldErrors(x), form: x.message }); } });

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHeader title="Give a loan" crumbs={<><Link to="/app/lending">Lending</Link> <span>/</span> <Link to="/app/lending/loans">Loans</Link> <span>/</span> New</>} icon={HandCoins}
        subtitle="Interest is taken upfront: the borrower receives the cash shown on the right and repays the full amount in equal instalments." />
      {err.form && <div className="error-state" style={{ marginBottom: 12 }}>{err.form}</div>}
      <div className="lend-grid">
        <div className="card card-body form-grid">
          <Field label="Borrower" required error={err.borrowerId} className="span-all">
            {borrower ? (
              <div className="lend-picked">
                <div><strong>{borrower.name}</strong> <span className="muted">{borrower.code} · {borrower.mobile} · {borrower.areaName}</span>
                  <div className="row" style={{ gap: 6, marginTop: 4 }}><Badge tone={approved(borrower.status) ? 'green' : 'amber'}>{borrower.status}</Badge><Badge tone={borrower.riskScore >= 75 ? 'green' : borrower.riskScore >= 55 ? 'amber' : 'red'}>Risk {borrower.riskScore}</Badge>{borrower.activeLoans > 0 && <Badge tone="blue">{borrower.activeLoans} open loan · {money(borrower.outstanding)}</Badge>}</div></div>
                <button className="btn btn-ghost btn-sm" onClick={() => { set({ borrowerId: '' }); setSearch(''); }}>Change</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div className="input-addon"><span><Search size={14} /></span><input id="ln-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type name, code or mobile…" autoFocus /></div>
                {!!matches.length && <ul className="lend-suggest">{matches.map((b) => (
                  <li key={b.id}><button type="button" onClick={() => { set({ borrowerId: b.id }); setSearch(''); }}>
                    <span><strong>{b.name}</strong> <span className="muted small">{b.code} · {b.mobile}</span></span><Badge tone={approved(b.status) ? 'green' : 'amber'}>{approved(b.status) ? 'Verified' : b.status}</Badge>
                  </button></li>
                ))}</ul>}
                <div className="small muted" style={{ marginTop: 6 }}>Not registered? <Link to="/app/lending/borrowers?new=1">Add a borrower</Link></div>
              </div>
            )}
          </Field>
          <Field label="Plan" className="span-all" hint={PLAN_HELP[f.loanType]}>
            <Segmented value={f.loanType} onChange={(v) => set({ loanType: v, periods: String(LENDING_RULES.defaultPeriods[v]) })} options={LOAN_TYPES.map((t) => ({ value: t, label: t === 'Daily 100-Day' ? 'Daily' : t === 'Monthly EMI' ? 'Monthly' : t }))} />
          </Field>
          <Field label="Loan amount" required error={err.principal && typeof quote !== 'string' ? err.principal : undefined}><div className="input-addon"><span>₹</span><input id="ln-amt" className="input" type="number" min={0} inputMode="decimal" value={f.principal} onChange={(e) => set({ principal: e.target.value })} placeholder="50000" /></div></Field>
          <Field label="Interest per month (%)" hint={`${LENDING_RULES.minMonthlyRate}% to ${LENDING_RULES.maxMonthlyRate}%`}><input id="ln-rate" className="input" type="number" step="0.01" min={LENDING_RULES.minMonthlyRate} max={LENDING_RULES.maxMonthlyRate} value={f.monthlyRate} onChange={(e) => set({ monthlyRate: e.target.value })} /></Field>
          <Field label={`Number of ${f.loanType === 'Daily 100-Day' ? 'days' : f.loanType === 'Weekly' ? 'weeks' : 'months'}`}><input id="ln-periods" className="input" type="number" min={1} max={600} value={f.periods} onChange={(e) => set({ periods: e.target.value })} /></Field>
          <Field label="Loan date" error={err.borrowDate}><input id="ln-date" className="input" type="date" min={minDate} max={today} value={f.borrowDate} onChange={(e) => set({ borrowDate: e.target.value })} /></Field>
          <Field label="Processing fee (optional)"><div className="input-addon"><span>₹</span><input id="ln-fee" className="input" type="number" min={0} value={f.processingFee} onChange={(e) => set({ processingFee: e.target.value })} /></div></Field>
          <Field label="Late charge per missed instalment" hint={`Only for defaulters: ${LENDING_RULES.defaulterDays}+ days overdue`}><div className="input-addon"><span>₹</span><input id="ln-late" className="input" type="number" min={0} value={f.lateFee} onChange={(e) => set({ lateFee: e.target.value })} placeholder="0" /></div></Field>
          <Field label="Collector"><select id="ln-coll" className="select" value={f.collectorId} onChange={(e) => set({ collectorId: e.target.value })}><option value="">Office (no collector)</option>{settings?.collectors.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}</select></Field>
          <Toggle checked={f.existingLoan} onChange={(v) => set({ existingLoan: v, borrowDate: today })} label={<span><strong>Existing loan</strong> <span className="muted small">money given before this system; no cash moves today</span></span>} />
          {f.existingLoan ? <>
            <Field label="Already repaid" error={err.alreadyRepaid}><div className="input-addon"><span>₹</span><input id="ln-repaid" className="input" type="number" min={0} value={f.alreadyRepaid} onChange={(e) => set({ alreadyRepaid: e.target.value })} /></div></Field>
            <Field label="Repaid up to"><input id="ln-upto" className="input" type="date" min={f.borrowDate} max={today} value={f.repaidUpTo} onChange={(e) => set({ repaidUpTo: e.target.value })} /></Field>
          </> : <>
            <Field label="Paid out by"><Segmented value={f.disbursementMode} onChange={(v) => set({ disbursementMode: v })} options={(settings?.modes ?? ['Cash', 'UPI', 'Bank Transfer']).map((m) => ({ value: m, label: m }))} /></Field>
            {!!settings?.accounts.length && <Field label="From account"><select id="ln-acc" className="select" value={f.accountId} onChange={(e) => set({ accountId: e.target.value })}><option value="">Undeposited cash</option>{settings.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
            <Field label="Cash handed over (rounded)" hint={q ? `Calculated ${money(q.calculatedNet)}; round by up to ₹${LENDING_RULES.maxCashRounding}` : 'Optional'}><div className="input-addon"><span>₹</span><input id="ln-cash" className="input" type="number" min={0} value={f.cashHandover} onChange={(e) => set({ cashHandover: e.target.value })} placeholder={q ? String(Math.floor(q.calculatedNet / 10) * 10) : ''} /></div></Field>
            <Field label="Borrower’s acknowledgement" required error={err.ackReference} hint="Signed slip number, or how they confirmed the amount"><input id="ln-ack" className="input" value={f.ackReference} onChange={(e) => set({ ackReference: e.target.value })} placeholder="Slip 1042" /></Field>
          </>}
          <Field label="Notes" className="span-all"><input id="ln-notes" className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" /></Field>
        </div>

        <aside className="card card-body lend-quote">
          <h3>What the borrower gets</h3>
          {typeof quote === 'string' ? <div className="error-state"><AlertTriangle size={14} /> {quote}</div> : !q ? <p className="muted small">Enter the amount to see the cash to hand over, the instalment and the dates.</p> : <>
            {!f.existingLoan && <div className="lq-cash"><span>Cash to hand over</span><strong>{money(q.netDisbursed)}</strong>{q.cashRounding !== 0 && <em>rounded from {money(q.calculatedNet)}</em>}</div>}
            <dl className="lend-dl">
              <div><dt>Loan amount (to repay)</dt><dd className="strong">{money(q.principal)}</dd></div>
              <div><dt>Interest taken upfront</dt><dd>{money(q.upfrontInterest)}<span className="muted small"> · {f.monthlyRate}% × {q.tenureMonths} months</span></dd></div>
              {q.processingFee > 0 && <div><dt>Processing fee</dt><dd>{money(q.processingFee)}</dd></div>}
              <div><dt>Instalment</dt><dd className="strong">{money(q.instalment)} × {q.rows.length}{q.rows.length && q.rows[q.rows.length - 1]!.amount !== q.instalment ? <span className="muted small"> (last {money(q.rows[q.rows.length - 1]!.amount)})</span> : ''}</dd></div>
              <div><dt>First due</dt><dd><CalendarClock size={12} /> {fmtDate(q.firstDue)}</dd></div>
              <div><dt>Last due</dt><dd>{fmtDate(q.maturity)}</dd></div>
              <div><dt>Effective yearly rate</dt><dd>{q.apr.toFixed(2)}%</dd></div>
            </dl>
            <details className="lq-sched"><summary>Repayment schedule ({q.rows.length})</summary>
              <table className="table"><tbody>{q.rows.map((r) => <tr key={r.n}><td>{r.n}</td><td>{fmtDate(r.due)}</td><td className="num">{money(r.amount)}</td></tr>)}</tbody></table>
            </details>
          </>}
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={check} disabled={!q}>{f.existingLoan ? 'Save existing loan' : 'Continue'}</button>
        </aside>
      </div>

      <Modal open={confirm && !!q && !!borrower} onClose={() => setConfirm(false)} title={f.existingLoan ? 'Save this existing loan?' : `Hand over ${q ? money(q.netDisbursed) : ''} to ${borrower?.name}?`}
        footer={<><button className="btn btn-secondary" onClick={() => setConfirm(false)} disabled={create.isPending}>Back</button><button className="btn btn-primary" onClick={submit} disabled={create.isPending}>{create.isPending ? <Loader2 size={15} className="spin" /> : <BadgeCheck size={15} />} {f.existingLoan ? 'Save loan' : 'Confirm loan'}</button></>}>
        {q && borrower && <div className="lend-confirm"><dl>
          <div><dt>Borrower</dt><dd>{borrower.name} ({borrower.code})</dd></div>
          <div><dt>Plan</dt><dd>{f.loanType} · {money(q.instalment)} × {q.rows.length} from {fmtDate(q.firstDue)}</dd></div>
          <div><dt>Loan amount</dt><dd>{money(q.principal)}</dd></div>
          {f.existingLoan ? <div><dt>Already repaid</dt><dd>{money(Number(f.alreadyRepaid) || 0)} · balance {money(q.principal - (Number(f.alreadyRepaid) || 0))}</dd></div>
            : <div><dt>Cash to hand over</dt><dd className="big">{money(q.netDisbursed)}</dd></div>}
          {!f.existingLoan && <div><dt>Acknowledgement</dt><dd>{f.ackReference}</dd></div>}
        </dl></div>}
      </Modal>
    </div>
  );
}
