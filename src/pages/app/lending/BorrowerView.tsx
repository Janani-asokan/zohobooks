import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Eye, HandCoins, Pencil, Phone, ShieldAlert, UserRound } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import { BORROWER_TONE, LENDING_KEYS, LOAN_TONE, RISK_TONE, type Borrower, type Loan, type LoanPayment, useLendingSettings } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader } from '@/components/ui';
import { RepaidBar } from '@/components/lending';
import { fmtDate, money } from '@/lib/format';

/** One borrower: details and verification, every loan they have had, and every payment. */
export default function BorrowerView() {
  const { id } = useParams();
  const me = useShopUser();
  const canWrite = me.can('lending.write');
  const isOwner = me.can('admin');
  const q = useQuery({ queryKey: ['lending', 'borrower', id], queryFn: () => api.get<{ borrower: Borrower; loans: Loan[]; payments: LoanPayment[] }>(`/shop/lending/borrowers/${id}`) });
  const areas = useLendingSettings().data?.areas ?? [];
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<{ reason: string; shown?: string } | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const save = useMut((b: Record<string, string>) => api.patch(`/shop/lending/borrowers/${id}`, b), [...LENDING_KEYS], { success: 'Borrower updated', silentError: true });
  const status = useMut((v: { status: string; note: string }) => api.post(`/shop/lending/borrowers/${id}/status`, v), LENDING_KEYS, { success: (_r, v) => `Marked ${v.status.toLowerCase()}` });
  const show = useMut((reason: string) => api.post<{ aadhaar: string }>(`/shop/lending/borrowers/${id}/aadhaar`, { reason }), [], { silentError: true });

  if (q.isError) return <div className="page"><div className="card"><EmptyState icon={UserRound} title="Borrower not found" text={(q.error as Error).message} action={<Link className="btn btn-primary" to="/app/lending/borrowers">Back to borrowers</Link>} /></div></div>;
  const d = q.data;
  if (!d) return <div className="page"><div className="skeleton" style={{ height: 480 }} /></div>;
  const b = d.borrower;
  const approved = b.status === 'Verified' || b.status === 'Manual Verification Approved';

  return (
    <div className="page">
      <PageHeader title={b.name} crumbs={<><Link to="/app/lending">Microfinance</Link> <span>/</span> <Link to="/app/lending/borrowers">Borrowers</Link> <span>/</span> {b.code}</>} icon={UserRound}
        subtitle={<>{b.code} · {b.areaName} · registered {fmtDate(String(b.createdAt).slice(0, 10))} by {b.createdBy}</>}
        actions={canWrite && <>
          <button className="btn btn-secondary" onClick={() => { setErr({}); setEdit({ name: b.name, fatherName: b.fatherName, mobile: b.mobile, address: b.address, areaCode: b.areaCode, guarantor: b.guarantor }); }}><Pencil size={15} /> Edit</button>
          {approved && <Link className="btn btn-primary" to={`/app/lending/loans/new?borrower=${b.id}`}><HandCoins size={15} /> Give a loan</Link>}
        </>} />

      <div className="lend-grid">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-header"><div><h3>Loans</h3><p>{d.loans.length} loan{d.loans.length === 1 ? '' : 's'} · {money(b.outstanding)} outstanding</p></div></div>
            {!d.loans.length ? <div className="card-body small muted">No loans yet.</div> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Loan</th><th>Plan</th><th className="num">Amount</th><th>Repaid</th><th className="num">Balance</th><th>Status</th></tr></thead>
                <tbody>{d.loans.map((l) => (
                  <tr key={l.id}>
                    <td><Link className="strong" to={`/app/lending/loans/${l.id}`}>{l.number}</Link><div className="muted small">{fmtDate(l.borrowDate)}{l.existingLoan ? ' · existing loan' : ''}</div></td>
                    <td>{l.loanType}<div className="muted small">{money(l.instalment)} × {l.periods}</div></td>
                    <td className="num">{money(l.principal)}</td>
                    <td><RepaidBar loan={l} /><div className="muted small">{l.state.instalmentsPaid} of {l.periods}</div></td>
                    <td className="num strong">{money(l.state.balance)}</td>
                    <td><Badge tone={LOAN_TONE[l.state.status]}>{l.state.status}</Badge>{l.state.isDefaulter && <div className="small" style={{ color: 'var(--red-600)' }}>{l.state.overdueDays} days overdue</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <section className="card">
            <div className="card-header"><div><h3>Payments</h3><p>{d.payments.filter((p) => p.status === 'Posted').length} receipts</p></div></div>
            {!d.payments.length ? <div className="card-body small muted">No payments yet.</div> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Date</th><th>Receipt</th><th>Loan</th><th>Mode</th><th className="num">Amount</th></tr></thead>
                <tbody>{d.payments.slice(0, 60).map((p) => (
                  <tr key={p.id} className={p.status === 'Reversed' ? 'muted' : ''}>
                    <td>{fmtDate(p.date)}</td><td>{p.receiptNo}{p.status === 'Reversed' && <Badge tone="gray">Reversed</Badge>}</td><td>{p.loanNumber}</td><td>{p.mode}{p.kind !== 'Collection' ? ` · ${p.kind}` : ''}</td>
                    <td className="num strong">{money(p.amount)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>

        <aside className="stack" style={{ gap: 16 }}>
          <section className="card card-body stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Badge tone={BORROWER_TONE[b.status]}>{b.status}</Badge><Badge tone={RISK_TONE(b.riskScore)}>Risk {b.riskScore} · {b.riskBand}</Badge></div>
            {b.statusNote && <p className="small muted">{b.statusNote}</p>}
            {canWrite && !approved && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => status.mutate({ status: 'Verified', note: 'Documents checked' })}><BadgeCheck size={14} /> Approve</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setManual('')}>Approve manually…</button>
              </div>
            )}
            <dl className="lend-dl">
              <div><dt>Mobile</dt><dd><a href={`tel:${b.mobile}`}><Phone size={12} /> {b.mobile}</a></dd></div>
              {b.fatherName && <div><dt>Father / husband</dt><dd>{b.fatherName}</dd></div>}
              <div><dt>Address</dt><dd>{b.address}</dd></div>
              <div><dt>Area</dt><dd>{b.areaName} ({b.areaCode})</dd></div>
              <div><dt>Guarantor</dt><dd>{b.guarantor || <span className="muted">None</span>}</dd></div>
              <div><dt>Aadhaar</dt><dd>{reveal?.shown ?? b.aadhaarMasked} {b.hasAadhaar && isOwner && !reveal?.shown && <button className="btn btn-ghost btn-sm" onClick={() => setReveal({ reason: '' })}><Eye size={13} /> Show</button>}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit borrower" size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => edit && save.mutate(edit, { onSuccess: () => { setEdit(null); q.refetch(); }, onError: (x) => setErr({ ...fieldErrors(x), form: x.message }) })}>Save</button></>}>
        {edit && <div className="form-grid">
          {err.form && <div className="span-all error-state">{err.form}</div>}
          <Field label="Name" required error={err.name}><input id="eb-name" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Father’s / husband’s name"><input id="eb-father" className="input" value={edit.fatherName} onChange={(e) => setEdit({ ...edit, fatherName: e.target.value })} /></Field>
          <Field label="Mobile" required error={err.mobile}><input id="eb-mobile" className="input" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></Field>
          <Field label="Area"><select id="eb-area" className="select" value={edit.areaCode} onChange={(e) => setEdit({ ...edit, areaCode: e.target.value })}>{areas.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}</select></Field>
          <Field label="Address" required error={err.address} className="span-all"><textarea id="eb-addr" className="textarea" rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Guarantor" className="span-all"><input id="eb-guar" className="input" value={edit.guarantor} onChange={(e) => setEdit({ ...edit, guarantor: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!reveal && !reveal.shown} onClose={() => setReveal(null)} title="Show full Aadhaar" subtitle="This is written to the audit log with your reason."
        footer={<><button className="btn btn-secondary" onClick={() => setReveal(null)}>Cancel</button><button className="btn btn-primary" disabled={show.isPending || (reveal?.reason.trim().length ?? 0) < 5} onClick={() => reveal && show.mutate(reveal.reason, { onSuccess: (r) => setReveal({ reason: reveal.reason, shown: r.aadhaar }), onError: (x) => setErr({ reveal: x.message }) })}><ShieldAlert size={15} /> Show</button></>}>
        <Field label="Reason" required error={err.reveal}><input id="rv-reason" className="input" value={reveal?.reason ?? ''} onChange={(e) => reveal && setReveal({ ...reveal, reason: e.target.value })} placeholder="For example: filling the bank KYC form" autoFocus /></Field>
      </Modal>

      <Modal open={manual !== null} onClose={() => setManual(null)} title="Approve manually" subtitle="For borrowers verified without Aadhaar, from other documents."
        footer={<><button className="btn btn-secondary" onClick={() => setManual(null)}>Cancel</button><button className="btn btn-primary" disabled={(manual?.trim().length ?? 0) < 3} onClick={() => status.mutate({ status: 'Manual Verification Approved', note: manual ?? '' }, { onSuccess: () => setManual(null) })}>Approve</button></>}>
        <Field label="How did you verify them?" required><textarea id="mv-note" className="textarea" rows={3} value={manual ?? ''} onChange={(e) => setManual(e.target.value)} placeholder="Ration card and voter ID checked at the office" autoFocus /></Field>
      </Modal>
    </div>
  );
}
