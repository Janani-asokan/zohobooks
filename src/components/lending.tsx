import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Printer, ShieldCheck } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut, useOrg } from '@/api/hooks';
import { LENDING_KEYS, newRequestId, type Loan, type LoanPayment, useLendingSettings } from '@/api/lending';
import { Field, Modal, Segmented } from '@/components/ui';
import { printWithPage } from '@/components/printing';
import { waLink } from '@/pages/app/InvoiceView';
import { fmtDate, money } from '@/lib/format';

type Kind = 'Collection' | 'Prepayment';

/** Take a payment on a loan: fill in, then confirm with the balance after (the request id makes a retry safe). */
export function CollectModal({ loan, kind = 'Collection', onClose, onDone }: { loan: Loan; kind?: Kind; onClose: () => void; onDone: (p: LoanPayment, loan: Loan) => void }) {
  const settings = useLendingSettings().data;
  const suggested = Math.min(loan.state.penaltyBalance + (loan.state.overdueAmount || loan.instalment), loan.state.balance);
  const [f, setF] = useState({ amount: String(kind === 'Prepayment' ? '' : Math.round(suggested * 100) / 100), mode: 'Cash', reference: '', accountId: '', kind });
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null); // request id while confirming
  const pay = useMut((b: Record<string, unknown>) => api.post<{ payment: LoanPayment; loan: Loan; duplicate: boolean }>(`/shop/lending/loans/${loan.id}/payments`, b), LENDING_KEYS, { silentError: true });
  const amount = Number(f.amount);
  const check = () => {
    const e: Record<string, string> = {};
    if (!(amount > 0)) e.amount = 'Enter the amount';
    else if (amount > loan.state.balance + 0.001) e.amount = `The balance is ${money(loan.state.balance)}`;
    else if (f.kind === 'Prepayment' && amount >= loan.state.balance) e.amount = 'A prepayment must be less than the balance. Use Close loan to settle in full.';
    if (f.mode === 'UPI' && f.reference.trim().length < 3) e.reference = 'Enter the UPI transaction ID';
    setErr(e);
    if (!Object.keys(e).length) setConfirm(newRequestId());
  };
  const save = () => pay.mutate({ amount, mode: f.mode, reference: f.reference, kind: f.kind, accountId: f.accountId || null, requestId: confirm }, {
    onSuccess: (r) => onDone(r.payment, r.loan),
    onError: (x) => { setErr({ ...fieldErrors(x), form: x.message }); setConfirm(null); },
  });
  const after = Math.max(loan.state.balance - (amount || 0), 0);
  const quick = [loan.instalment, loan.state.overdueAmount + loan.state.penaltyBalance, loan.state.balance].filter((v, i, a) => v > 0 && a.indexOf(v) === i && v <= loan.state.balance);

  return (
    <Modal open onClose={onClose} title={confirm ? 'Confirm this payment' : f.kind === 'Prepayment' ? 'Prepayment' : 'Collect payment'} subtitle={`${loan.borrowerName} · ${loan.number} · balance ${money(loan.state.balance)}`}
      footer={confirm ? <>
        <button className="btn btn-secondary" onClick={() => setConfirm(null)} disabled={pay.isPending}>Back</button>
        <button className="btn btn-primary" onClick={save} disabled={pay.isPending}>{pay.isPending ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Confirm and save</button>
      </> : <>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={check}>Continue</button>
      </>}>
      {confirm ? (
        <div className="lend-confirm">
          <dl>
            <div><dt>Borrower</dt><dd>{loan.borrowerName} ({loan.borrowerCode})</dd></div>
            <div><dt>Loan</dt><dd>{loan.number} · {loan.loanType}</dd></div>
            <div><dt>Amount</dt><dd className="big">{money(amount)}</dd></div>
            <div><dt>Mode</dt><dd>{f.mode}{f.reference ? ` · ${f.reference}` : ''}</dd></div>
            {loan.state.penaltyBalance > 0 && <div><dt>Late charges first</dt><dd>{money(Math.min(amount, loan.state.penaltyBalance))}</dd></div>}
            <div><dt>Balance after</dt><dd className="strong">{money(after)}{after <= 0 ? ' · loan closes' : ''}</dd></div>
          </dl>
          {err.form && <div className="error-state" style={{ marginTop: 10 }}>{err.form}</div>}
          <p className="small muted" style={{ marginTop: 10 }}><ShieldCheck size={13} /> Pressing Confirm twice, or a slow connection, will not save it twice.</p>
        </div>
      ) : (
        <div className="form-grid">
          <Field label="Type" className="span-all"><Segmented value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'Collection', label: 'Instalment' }, { value: 'Prepayment', label: 'Prepayment (extra)' }]} /></Field>
          <Field label="Amount" required error={err.amount} className="span-all">
            <div className="input-addon"><span>₹</span><input id="lend-amount" className={`input ${err.amount ? 'invalid' : ''}`} type="number" min={0} step="any" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {quick.map((v) => <button key={v} type="button" className="chip-btn" onClick={() => setF({ ...f, amount: String(v) })}>{v === loan.state.balance ? 'Full balance' : v === loan.instalment ? 'One instalment' : 'All overdue'} · {money(v)}</button>)}
            </div>
          </Field>
          <Field label="Mode"><Segmented value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={(settings?.modes ?? ['Cash', 'UPI', 'Bank Transfer']).map((m) => ({ value: m, label: m }))} /></Field>
          <Field label={f.mode === 'UPI' ? 'UPI transaction ID' : 'Reference'} required={f.mode === 'UPI'} error={err.reference}><input id="lend-ref" className={`input ${err.reference ? 'invalid' : ''}`} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={f.mode === 'Cash' ? 'Optional' : 'UTR / reference'} /></Field>
          {!!settings?.accounts.length && <Field label="Deposit to" className="span-all"><select id="lend-acc" className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Undeposited cash</option>{settings.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {loan.state.penaltyBalance > 0 && <p className="small muted span-all">{money(loan.state.penaltyBalance)} of late charges is collected first, then the instalments.</p>}
        </div>
      )}
    </Modal>
  );
}

/** Printable receipt with a WhatsApp share. */
export function ReceiptModal({ payment, loan, onClose }: { payment: LoanPayment; loan: Pick<Loan, 'number' | 'borrowerName' | 'borrowerCode' | 'mobile' | 'loanType' | 'state'>; onClose: () => void }) {
  const org = useOrg().data;
  const text = `${org?.companyName ?? ''}\nReceipt ${payment.receiptNo}\n${loan.borrowerName} · ${loan.number}\nPaid ${money(payment.amount)} (${payment.mode}) on ${fmtDate(payment.date)}\nBalance ${money(payment.balanceAfter)}\nThank you.`;
  useEffect(() => { document.body.classList.remove('print-receipt'); }, []);
  return (
    <Modal open onClose={onClose} title="Receipt" subtitle={payment.receiptNo} footer={<>
      {loan.mobile && <a className="btn btn-secondary" target="_blank" rel="noreferrer" href={waLink(loan.mobile, text)}><MessageCircle size={15} /> WhatsApp</a>}
      <button className="btn btn-secondary" onClick={() => printWithPage('size: 80mm auto; margin: 0;', 'print-receipt')}><Printer size={15} /> Print</button>
      <button className="btn btn-primary" onClick={onClose} autoFocus>Done</button>
    </>}>
      <div className="print-area">
        <div className="loan-receipt light-scope">
          <div className="lr-head"><strong>{org?.companyName}</strong>{org?.address && <div>{org.address}</div>}{org?.phone && <div>Ph: {org.phone}</div>}</div>
          <div className="lr-title">PAYMENT RECEIPT</div>
          <table><tbody>
            <tr><td>Receipt</td><td>{payment.receiptNo}</td></tr>
            <tr><td>Date</td><td>{new Date(payment.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>
            <tr><td>Borrower</td><td>{loan.borrowerName} ({loan.borrowerCode})</td></tr>
            <tr><td>Loan</td><td>{loan.number} · {loan.loanType}</td></tr>
            <tr><td>Mode</td><td>{payment.mode}{payment.reference ? ` · ${payment.reference}` : ''}</td></tr>
            {payment.penaltyPart > 0 && <tr><td>Late charges</td><td>{money(payment.penaltyPart)}</td></tr>}
            <tr className="lr-amt"><td>Amount paid</td><td>{money(payment.amount)}</td></tr>
            <tr><td>Balance</td><td>{money(payment.balanceAfter)}</td></tr>
            <tr><td>Collected by</td><td>{payment.collectorName}</td></tr>
          </tbody></table>
          {payment.balanceAfter <= 0 && <div className="lr-closed">Loan fully repaid · closed</div>}
          <div className="lr-foot">Thank you · Keep this receipt</div>
        </div>
      </div>
    </Modal>
  );
}

/** Small bar showing how much of the loan is repaid. */
export function RepaidBar({ loan }: { loan: Pick<Loan, 'principal' | 'state'> }) {
  const pct = Math.min(100, Math.round((loan.state.principalPaid / Math.max(loan.principal, 1)) * 100));
  return <span className="lend-bar" title={`${pct}% repaid`}><span style={{ width: `${pct}%` }} className={loan.state.status === 'Overdue' || loan.state.isDefaulter ? 'bad' : ''} /></span>;
}
