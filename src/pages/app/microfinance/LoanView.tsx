import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Ban, CalendarClock, CircleCheck, FileText, Gavel, HandCoins, IndianRupee, Printer, Receipt, Undo2, Wallet } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import { LENDING_KEYS, LOAN_TONE, newRequestId, type Loan, type LoanPayment, useLendingSettings, useLoan } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, Segmented, StatCard } from '@/components/ui';
import { CollectModal, ReceiptModal, RepaidBar } from '@/components/lending';
import { printWithPage } from '@/components/printing';
import { fmtDate, money } from '@/lib/format';

const ROW_TONE: Record<string, string> = { Paid: 'green', 'Part paid': 'amber', Overdue: 'red', 'Due today': 'blue', Upcoming: 'gray' };

/** One loan: balance and next due, quick actions, the instalment schedule, receipts and the full terms. */
export default function LoanView() {
  const { id } = useParams();
  const me = useShopUser();
  const canWrite = me.can('lending.write');
  const canCollect = canWrite || me.can('lending.collect');
  const isOwner = me.can('admin');
  const q = useLoan(id);
  const settings = useLendingSettings().data;
  const [collect, setCollect] = useState<'Collection' | 'Prepayment' | null>(null);
  const [receipt, setReceipt] = useState<LoanPayment | null>(null);
  const [close, setClose] = useState<{ mode: string; reference: string; reason: string; confirm: string; accountId: string; requestId: string } | null>(null);
  const [reverse, setReverse] = useState<{ p: LoanPayment; reason: string } | null>(null);
  const [waive, setWaive] = useState<{ amount: string; reason: string } | null>(null);
  const [late, setLate] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const closeM = useMut((b: Record<string, unknown>) => api.post<{ payment: LoanPayment | null; loan: Loan }>(`/shop/lending/loans/${id}/close`, b), LENDING_KEYS, { success: 'Loan closed', silentError: true });
  const reverseM = useMut((v: { pid: string; reason: string }) => api.post(`/shop/lending/payments/${v.pid}/reverse`, { reason: v.reason }), LENDING_KEYS, { success: 'Receipt reversed', silentError: true });
  const waiveM = useMut((b: Record<string, unknown>) => api.post(`/shop/lending/loans/${id}/waive`, b), LENDING_KEYS, { success: 'Late charge waived', silentError: true });
  const lateM = useMut((n: number) => api.post(`/shop/lending/loans/${id}/late-charge`, { instalment: n }), LENDING_KEYS, { success: 'Late charge applied' });

  if (q.isError) return <div className="page"><div className="card"><EmptyState icon={HandCoins} title="Loan not found" text={(q.error as Error).message} action={<Link className="btn btn-primary" to="/app/microfinance/loans">Back to loans</Link>} /></div></div>;
  const d = q.data;
  if (!d) return <div className="page"><div className="skeleton" style={{ height: 520 }} /></div>;
  const l = d.loan;
  const st = l.state;
  const open = st.status === 'Active' || st.status === 'Overdue';
  const firstOpen = d.schedule.findIndex((r) => r.state !== 'Paid');
  const sched = showAll ? d.schedule : d.schedule.slice(Math.max(0, firstOpen - 3), Math.max(0, firstOpen - 3) + 12);

  return (
    <div className="page">
      <PageHeader title={<>{l.number} <Badge tone={LOAN_TONE[st.status]}>{st.status}</Badge>{st.isDefaulter && <Badge tone="red">Defaulter</Badge>}</>} icon={HandCoins}
        crumbs={<><Link to="/app/microfinance">Microfinance</Link> <span>/</span> <Link to="/app/microfinance/loans">Loans</Link> <span>/</span> {l.number}</>}
        subtitle={<><Link to={`/app/microfinance/borrowers/${l.borrowerId}`}>{l.borrowerName}</Link> · {l.borrowerCode} · {l.mobile} · {l.areaName} · {l.loanType}</>}
        actions={<>
          <button className="btn btn-secondary" onClick={() => printWithPage('size: A4 portrait; margin: 14mm;', 'print-loan')}><Printer size={15} /> Loan card</button>
          {open && canCollect && <button className="btn btn-secondary" onClick={() => setCollect('Prepayment')}><Wallet size={15} /> Prepayment</button>}
          {open && canWrite && <button className="btn btn-secondary" onClick={() => { setErr({}); setClose({ mode: 'Cash', reference: '', reason: '', confirm: '', accountId: '', requestId: newRequestId() }); }}><CircleCheck size={15} /> Close loan</button>}
          {open && canCollect && <button className="btn btn-primary" onClick={() => setCollect('Collection')}><IndianRupee size={15} /> Collect</button>}
        </>} />

      <div className="stat-grid">
        <StatCard label="Balance" value={money(st.balance)} icon={Wallet} tone={st.status === 'Overdue' ? 'red' : 'blue'} foot={st.penaltyBalance > 0 ? `incl. ${money(st.penaltyBalance)} late charges` : `of ${money(l.principal)}`} />
        <StatCard label="Repaid" value={money(st.paid)} icon={IndianRupee} tone="green" foot={<><RepaidBar loan={l} /> {st.instalmentsPaid} of {l.periods} instalments</>} />
        <StatCard label="Next due" value={st.nextDue ? fmtDate(st.nextDue) : '—'} icon={CalendarClock} tone="violet" foot={open ? `${money(l.instalment)} · ${st.remaining} left` : l.closureReason || 'Closed'} />
        <StatCard label="Overdue" value={money(st.overdueAmount)} icon={AlertTriangle} tone={st.overdueDays ? 'red' : 'green'} foot={st.overdueDays ? `${st.overdueDays} days · ${st.alert ?? 'pay soon'}` : 'On time'} />
      </div>

      {open && (st.isDefaulter || st.penaltyBalance > 0) && (
        <div className="card card-body lend-late mt-16">
          <Gavel size={18} />
          <div style={{ flex: 1 }}>
            <strong>{st.isDefaulter ? `Defaulter: oldest unpaid instalment is ${st.overdueDays} days overdue` : 'Late charges outstanding'}</strong>
            <div className="small muted">{d.lateCharge.message || `Late charge ${money(l.lateFee)} can be applied to instalment ${d.lateCharge.nextInstalment}.`}{st.penaltyBalance > 0 ? ` · ${money(st.penaltyBalance)} late charges unpaid.` : ''}</div>
          </div>
          {canWrite && d.lateCharge.nextInstalment && <button className="btn btn-secondary btn-sm" onClick={() => setLate(true)}>Apply late charge</button>}
          {isOwner && st.penaltyBalance > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setErr({}); setWaive({ amount: String(st.penaltyBalance), reason: '' }); }}>Waive</button>}
        </div>
      )}

      <div className="lend-grid mt-16">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-header"><div><h3>Instalments</h3><p>{money(l.instalment)} {l.loanType === 'Daily 100-Day' ? 'a day' : l.loanType === 'Weekly' ? 'a week' : 'a month'} · {fmtDate(l.firstDue)} to {fmtDate(l.maturity)}</p></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show around today' : `Show all ${d.schedule.length}`}</button></div>
            <div className="table-wrap" style={{ maxHeight: showAll ? 520 : undefined, overflowY: showAll ? 'auto' : undefined }}>
              <table className="table">
                <thead><tr><th>#</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th>Status</th></tr></thead>
                <tbody>{sched.map((r) => <tr key={r.n}><td className="muted">{r.n}</td><td>{fmtDate(r.due)}</td><td className="num">{money(r.amount)}</td><td className="num">{r.paid ? money(r.paid) : '—'}</td><td><Badge tone={ROW_TONE[r.state]}>{r.state}</Badge></td></tr>)}</tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <div className="card-header"><div><h3>Receipts</h3><p>{d.payments.filter((p) => p.status === 'Posted').length} posted · {money(st.paid)} received</p></div></div>
            {!d.payments.length ? <div className="card-body small muted">No payments yet.</div> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Date</th><th>Receipt</th><th>Mode</th><th className="num">Amount</th><th className="num">Balance after</th><th /></tr></thead>
                <tbody>{d.payments.map((p) => (
                  <tr key={p.id} className={p.status === 'Reversed' ? 'muted' : ''}>
                    <td>{fmtDate(p.date)}<div className="muted small">{p.collectorName}</div></td>
                    <td>{p.receiptNo}{p.kind !== 'Collection' && <div className="muted small">{p.kind}</div>}{p.status === 'Reversed' && <div className="small" style={{ color: 'var(--red-600)' }}>Reversed: {p.reversedReason}</div>}</td>
                    <td>{p.mode}{p.reference ? <div className="muted small">{p.reference}</div> : null}</td>
                    <td className="num strong">{money(p.amount)}{p.penaltyPart > 0 && <div className="muted small">{money(p.penaltyPart)} late charges</div>}</td>
                    <td className="num">{money(p.balanceAfter)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {p.kind !== 'Opening balance' && <button className="icon-btn" title="Show receipt" onClick={() => setReceipt(p)}><Receipt size={15} /></button>}
                      {isOwner && p.status === 'Posted' && p.kind !== 'Opening balance' && <button className="icon-btn danger" title="Reverse this receipt" onClick={() => { setErr({}); setReverse({ p, reason: '' }); }}><Undo2 size={15} /></button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          {!!d.charges.length && (
            <section className="card">
              <div className="card-header"><div><h3>Late charges</h3></div></div>
              <table className="table"><tbody>{d.charges.map((c) => <tr key={c.id}><td>{fmtDate(c.date)}</td><td>{c.kind}{c.instalment ? ` · instalment ${c.instalment}` : ''}<div className="muted small">{c.reason}</div></td><td className="num strong">{c.kind === 'Penalty waiver' ? '−' : ''}{money(c.amount)}</td></tr>)}</tbody></table>
            </section>
          )}
        </div>

        <aside className="card card-body">
          <h3 style={{ marginBottom: 10 }}><FileText size={16} /> Loan terms</h3>
          <dl className="lend-dl">
            <div><dt>Loan amount</dt><dd className="strong">{money(l.principal)}</dd></div>
            {!l.existingLoan && <div><dt>Cash given</dt><dd>{money(l.netDisbursed)}{l.cashRounding !== 0 && <span className="muted small"> (rounded from {money(l.calculatedNet)})</span>} · {l.disbursementMode}</dd></div>}
            <div><dt>Interest (upfront)</dt><dd>{money(l.upfrontInterest)} · {l.monthlyRate}% a month</dd></div>
            {l.processingFee > 0 && <div><dt>Processing fee</dt><dd>{money(l.processingFee)}</dd></div>}
            <div><dt>Effective yearly rate</dt><dd>{l.apr.toFixed(2)}%</dd></div>
            <div><dt>Instalments</dt><dd>{money(l.instalment)} × {l.periods}</dd></div>
            <div><dt>Loan date</dt><dd>{fmtDate(l.borrowDate)}</dd></div>
            <div><dt>Late charge</dt><dd>{l.lateFee ? `${money(l.lateFee)} per missed instalment, only after ${settings?.rules.defaulterDays ?? 30} days` : 'None agreed'}</dd></div>
            <div><dt>Collector</dt><dd>{l.collectorName || 'Office'}</dd></div>
            <div><dt>Acknowledgement</dt><dd>{l.ackReference || '—'}</dd></div>
            {l.existingLoan && <div><dt>Existing loan</dt><dd>Entered {fmtDate(l.enteredOn)} · {money(l.alreadyRepaid)} repaid before</dd></div>}
            {l.notes && <div><dt>Notes</dt><dd>{l.notes}</dd></div>}
            <div><dt>Entered by</dt><dd>{l.createdBy}</dd></div>
            {l.closedAt && <div><dt>Closed</dt><dd>{fmtDate(String(l.closedAt).slice(0, 10))} by {l.closedBy}<div className="muted small">{l.closureReason}</div></dd></div>}
          </dl>
        </aside>
      </div>

      {/* Printable loan card */}
      <div className="print-area loan-card-print only-print">
        <h2>Loan {l.number}</h2>
        <p>{l.borrowerName} ({l.borrowerCode}) · {l.mobile} · {l.areaName}</p>
        <p>{l.loanType} · Loan amount {money(l.principal)} · Cash given {money(l.netDisbursed)} · Interest {money(l.upfrontInterest)} · {money(l.instalment)} × {l.periods} from {fmtDate(l.firstDue)}</p>
        <table><thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>{d.schedule.map((r) => <tr key={r.n}><td>{r.n}</td><td>{fmtDate(r.due)}</td><td>{money(r.amount)}</td><td>{r.paid ? money(r.paid) : ''}</td><td>{r.state}</td></tr>)}</tbody></table>
        <p>Balance {money(st.balance)} as on {fmtDate(new Date().toISOString().slice(0, 10))}</p>
      </div>

      {collect && <CollectModal loan={l} kind={collect} onClose={() => setCollect(null)} onDone={(p) => { setCollect(null); setReceipt(p); }} />}
      {receipt && <ReceiptModal payment={receipt} loan={l} onClose={() => setReceipt(null)} />}

      <Modal open={!!close} onClose={() => setClose(null)} title="Close this loan" subtitle={`Settles the full balance of ${money(st.balance)} and marks the loan closed.`}
        footer={<><button className="btn btn-secondary" onClick={() => setClose(null)}>Cancel</button><button className="btn btn-primary" disabled={closeM.isPending} onClick={() => close && closeM.mutate({ ...close, accountId: close.accountId || null }, { onSuccess: (r) => { setClose(null); if (r.payment) setReceipt(r.payment); }, onError: (x) => setErr({ ...fieldErrors(x), form: x.message }) })}><CircleCheck size={15} /> Close loan</button></>}>
        {close && <div className="form-grid">
          {err.form && <div className="span-all error-state">{err.form}</div>}
          {st.balance > 0 && <>
            <Field label="Paid by"><Segmented value={close.mode} onChange={(v) => setClose({ ...close, mode: v })} options={(settings?.modes ?? ['Cash', 'UPI', 'Bank Transfer']).map((m) => ({ value: m, label: m }))} /></Field>
            <Field label="Reference" error={err.reference}><input id="cl-ref" className="input" value={close.reference} onChange={(e) => setClose({ ...close, reference: e.target.value })} placeholder={close.mode === 'Cash' ? 'Optional' : 'UPI / bank reference'} /></Field>
          </>}
          <Field label="Reason" required error={err.reason} className="span-all"><input id="cl-reason" className="input" value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} placeholder="Settled in full before the last due date" /></Field>
          <Field label={`Type ${l.number} to confirm`} required error={err.confirm} className="span-all"><input id="cl-confirm" className="input" value={close.confirm} onChange={(e) => setClose({ ...close, confirm: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!reverse} onClose={() => setReverse(null)} title="Reverse receipt" subtitle={reverse ? `${reverse.p.receiptNo} · ${money(reverse.p.amount)}. It stays on record as reversed, and the balance goes back up.` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setReverse(null)}>Cancel</button><button className="btn btn-danger" disabled={reverseM.isPending} onClick={() => reverse && reverseM.mutate({ pid: reverse.p.id, reason: reverse.reason }, { onSuccess: () => setReverse(null), onError: (x) => setErr({ reverse: x.message }) })}><Ban size={15} /> Reverse</button></>}>
        <Field label="Why?" required error={err.reverse}><input id="rv-why" className="input" value={reverse?.reason ?? ''} onChange={(e) => reverse && setReverse({ ...reverse, reason: e.target.value })} placeholder="Entered twice by mistake" autoFocus /></Field>
      </Modal>

      <Modal open={!!waive} onClose={() => setWaive(null)} title="Waive late charges"
        footer={<><button className="btn btn-secondary" onClick={() => setWaive(null)}>Cancel</button><button className="btn btn-primary" disabled={waiveM.isPending} onClick={() => waive && waiveM.mutate({ amount: Number(waive.amount), reason: waive.reason }, { onSuccess: () => setWaive(null), onError: (x) => setErr({ waive: x.message }) })}>Waive</button></>}>
        {waive && <div className="form-grid">
          {err.waive && <div className="span-all error-state">{err.waive}</div>}
          <Field label="Amount"><div className="input-addon"><span>₹</span><input id="wv-amt" className="input" type="number" value={waive.amount} onChange={(e) => setWaive({ ...waive, amount: e.target.value })} /></div></Field>
          <Field label="Reason" required><input id="wv-reason" className="input" value={waive.reason} onChange={(e) => setWaive({ ...waive, reason: e.target.value })} placeholder="Medical emergency in the family" /></Field>
        </div>}
      </Modal>

      <Modal open={late} onClose={() => setLate(false)} title="Apply late charge" subtitle={`${money(l.lateFee)} on instalment ${d.lateCharge.nextInstalment}, as agreed on this loan.`}
        footer={<><button className="btn btn-secondary" onClick={() => setLate(false)}>Cancel</button><button className="btn btn-primary" disabled={lateM.isPending} onClick={() => d.lateCharge.nextInstalment && lateM.mutate(d.lateCharge.nextInstalment, { onSuccess: () => setLate(false) })}>Apply</button></>}>
        <p className="small">The borrower pays late charges first from their next payment. The owner can waive them later.</p>
      </Modal>
    </div>
  );
}
