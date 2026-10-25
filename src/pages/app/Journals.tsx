import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NotebookPen, Plus, Trash2, Loader2, X } from 'lucide-react';
import { api } from '@/api/client';
import { useAccounts, useJournals, useMut } from '@/api/hooks';
import type { Journal } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput } from '@/components/ui';
import { AccountSelect } from '@/components/AccountSelect';
import { ExportMenu } from '@/components/ExportMenu';
import { fmtDate, money, todayISO, uid } from '@/lib/format';

interface Line { key: string; account: string; debit: string; credit: string; description: string }
const blankLine = (): Line => ({ key: uid('jl_'), account: '', debit: '', credit: '', description: '' });
const n = (s: string) => (s.trim() === '' ? 0 : Math.round(Number(s) * 100) / 100);
const KEYS = [['journals'], ['accounts'], ['report'], ['dashboard']];

/** Manual journals: opening balances, depreciation, owner's capital, loans — anything documents don't cover. */
export default function Journals() {
  const me = useShopUser();
  const canWrite = me.can('accounting.write');
  const { data = [], isLoading, isError, refetch } = useJournals();
  const accounts = useAccounts().data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [view, setView] = useState<Journal | null>(null);
  const [del, setDel] = useState<Journal | null>(null);
  const [form, setForm] = useState<{ date: string; reference: string; notes: string; lines: Line[] } | null>(null);
  const [err, setErr] = useState('');
  const create = useMut((b: Record<string, unknown>) => api.post<Journal>('/shop/accounting/journals', b), KEYS, { success: (j) => `${j.number} posted · ${money(j.total)}`, silentError: true });
  const remove = useMut((id: string) => api.del(`/shop/accounting/journals/${id}`), KEYS, { success: 'Journal deleted' });

  const start = () => { setErr(''); setForm({ date: todayISO(), reference: '', notes: '', lines: [blankLine(), blankLine()] }); };
  useEffect(() => { if (params.get('new') && canWrite) { start(); setParams({}, { replace: true }); } }, [params]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((j) => !s || [j.number, j.reference, j.notes, ...j.lines.map((l) => l.accountName)].some((v) => v.toLowerCase().includes(s)));
  }, [data, q]);

  const dr = form ? form.lines.reduce((s, l) => s + n(l.debit), 0) : 0;
  const cr = form ? form.lines.reduce((s, l) => s + n(l.credit), 0) : 0;
  const diff = Math.round((dr - cr) * 100) / 100;
  const upd = (key: string, p: Partial<Line>) => form && setForm({ ...form, lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });

  const submit = () => {
    if (!form) return;
    const lines = form.lines.filter((l) => l.account && (n(l.debit) || n(l.credit)));
    if (form.lines.some((l) => !l.account && (n(l.debit) || n(l.credit)))) return setErr('Choose an account for every line with an amount');
    if (lines.length < 2) return setErr('Add at least two lines: one debit and one credit');
    if (diff !== 0) return setErr(`Debits and credits differ by ${money(Math.abs(diff))}`);
    setErr('');
    create.mutate({ date: form.date, reference: form.reference, notes: form.notes, lines: lines.map((l) => ({ account: l.account, debit: n(l.debit), credit: n(l.credit), description: l.description })) }, {
      onSuccess: () => setForm(null), onError: (e) => setErr(e.message),
    });
  };

  return (
    <div className="page">
      <PageHeader title="Manual Journals" crumbs={<>Accounting <span>/</span> Journals</>} subtitle="Record what invoices, bills and banking don’t: opening balances, depreciation, owner’s capital, loans and corrections."
        actions={<>
          <ExportMenu disabled={!rows.length} table={() => ({
            title: 'Manual journals', subtitle: `${rows.length} journals`, filename: 'journals',
            columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'Account' }, { label: 'Description' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }],
            rows: rows.flatMap((j) => j.lines.map((l, i) => ({ cells: [i ? '' : fmtDate(j.date), i ? '' : j.number, l.accountName, l.description || (i ? '' : j.notes), l.debit || null, l.credit || null] }))),
          })} />
          {canWrite && <button className="btn btn-primary" onClick={start}><Plus size={16} /> New journal</button>}
        </>} />
      <div className="card">
        <div className="toolbar"><div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search number, account, notes…" /></div></div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load journals. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={NotebookPen} title={data.length ? 'No journals match' : 'No manual journals yet'} text="Most entries post automatically. Use a journal for opening balances, depreciation or money the owner brings in." action={canWrite && <button className="btn btn-primary" onClick={start}><Plus size={15} /> New journal</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Number</th><th>Accounts</th><th>Notes</th><th className="num">Amount</th><th>By</th></tr></thead>
              <tbody>{rows.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => setView(j)}>
                  <td>{fmtDate(j.date)}</td>
                  <td className="strong">{j.number}{j.reference && <div className="muted small">{j.reference}</div>}</td>
                  <td className="muted">{[...new Set(j.lines.map((l) => l.accountName))].slice(0, 3).join(', ')}{j.lines.length > 3 ? '…' : ''}</td>
                  <td className="muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.notes || '—'}</td>
                  <td className="num strong">{money(j.total)}</td>
                  <td className="muted">{j.createdBy || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title="New manual journal" subtitle="Total debits must equal total credits."
        footer={<>
          <span className={`small strong ${diff ? '' : 'muted'}`} style={{ marginRight: 'auto', color: diff ? 'var(--red-600)' : undefined }}>{diff ? `Out of balance by ${money(Math.abs(diff))}` : dr ? 'Balanced' : ''}</span>
          <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={create.isPending} onClick={submit}>{create.isPending && <Loader2 size={15} className="spin" />} Post journal</button>
        </>}>
        {form && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="form-grid cols-3">
              <Field label="Date" required><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Reference"><input className="input" value={form.reference} maxLength={60} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. FY opening" /></Field>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ minWidth: 240 }}>Account</th><th>Description</th><th className="num" style={{ width: 140 }}>Debit</th><th className="num" style={{ width: 140 }}>Credit</th><th style={{ width: 44 }} /></tr></thead>
                <tbody>
                  {form.lines.map((l) => (
                    <tr key={l.key}>
                      <td><AccountSelect accounts={accounts} value={l.account} onChange={(v) => upd(l.key, { account: v })} invalid={!!err && !l.account && !!(n(l.debit) || n(l.credit))} /></td>
                      <td><input className="input" value={l.description} maxLength={200} onChange={(e) => upd(l.key, { description: e.target.value })} aria-label="Line description" /></td>
                      <td><input className="input num" type="number" min={0} step="0.01" value={l.debit} onChange={(e) => upd(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} aria-label="Debit" /></td>
                      <td><input className="input num" type="number" min={0} step="0.01" value={l.credit} onChange={(e) => upd(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} aria-label="Credit" /></td>
                      <td><button type="button" className="icon-btn danger" aria-label="Remove line" disabled={form.lines.length <= 2} onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })}><Trash2 size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2} className="strong">Total</td><td className="num strong">{money(dr)}</td><td className="num strong">{money(cr)}</td><td /></tr></tfoot>
              </table>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}><Plus size={14} /> Add line</button>
              {diff !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const last = form.lines[form.lines.length - 1]!; const fill = { ...blankLine(), account: '', [diff > 0 ? 'credit' : 'debit']: String(Math.abs(diff)) }; setForm({ ...form, lines: last.account || n(last.debit) || n(last.credit) ? [...form.lines, fill] : [...form.lines.slice(0, -1), { ...fill, key: last.key }] }); }}>Balance with a new line</button>}
            </div>
            {err && <div className="field-error">{err}</div>}
            <Field label="Notes"><textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this entry is needed" /></Field>
            <p className="small muted">Need an account that isn’t listed? <Link to="/app/accounting/accounts?new=1">Add it to the chart of accounts</Link>.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} size="lg" title={view?.number ?? ''} subtitle={view ? `${fmtDate(view.date)}${view.reference ? ` · ${view.reference}` : ''}${view.createdBy ? ` · by ${view.createdBy}` : ''}` : ''}
        footer={<>
          {canWrite && view && <button className="btn btn-ghost danger" style={{ marginRight: 'auto' }} onClick={() => { setDel(view); setView(null); }}><Trash2 size={15} /> Delete</button>}
          <button className="btn btn-secondary" onClick={() => setView(null)}><X size={15} /> Close</button>
        </>}>
        {view && (
          <>
            <table className="table">
              <thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>{view.lines.map((l, i) => <tr key={i}><td><Link to={`/app/accounting/ledger?account=${encodeURIComponent(l.account)}`} className="strong">{l.accountName}</Link></td><td className="muted">{l.description || '—'}</td><td className="num">{l.debit ? money(l.debit) : ''}</td><td className="num">{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2} className="strong">Total</td><td className="num strong">{money(view.total)}</td><td className="num strong">{money(view.total)}</td></tr></tfoot>
            </table>
            {view.notes && <p className="small muted" style={{ marginTop: 12, whiteSpace: 'pre-line' }}>{view.notes}</p>}
          </>
        )}
      </Modal>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Delete journal?" confirmLabel="Delete journal" text={`${del?.number} will be removed from the ledger. The audit log keeps a record of it.`} onConfirm={() => remove.mutate(del!.id)} />
    </div>
  );
}
