import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Plus, Loader2, Lock, Archive } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useAccounts, useMut } from '@/api/hooks';
import type { LedgerAccount } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, SearchInput } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { money, todayISO } from '@/lib/format';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, TYPE_LABEL, type AccountType } from '../../../shared/accounting';

const subtypeLabel = (a: LedgerAccount) => ACCOUNT_SUBTYPES[a.type].find((s) => s.id === a.subtype)?.label ?? '';

/** Chart of accounts with live balances; every account opens its ledger. */
export default function Accounts() {
  const me = useShopUser();
  const canWrite = me.can('accounting.write');
  const navigate = useNavigate();
  const { data = [], isLoading, isError, refetch } = useAccounts();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | AccountType>('all');
  const [hideZero, setHideZero] = useState(false);
  const [form, setForm] = useState<{ code: string; name: string; type: AccountType; subtype: string; description: string } | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const create = useMut((b: Record<string, unknown>) => api.post<{ key: string }>('/shop/accounting/accounts', b), [['accounts']], { success: 'Account added', silentError: true });
  const archive = useMut((id: string) => api.patch(`/shop/accounting/accounts/${id}`, { archived: true }), [['accounts']], { success: 'Account archived' });

  const start = () => { setErr({}); setForm({ code: '', name: '', type: 'expense', subtype: 'operating', description: '' }); };
  useEffect(() => { if (params.get('new') && canWrite) { start(); setParams({}, { replace: true }); } }, [params]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((a) => !a.archived && (type === 'all' || a.type === type) && (!hideZero || Math.abs(a.balance) >= 0.005) && (!s || [a.name, a.code, a.description].some((v) => v.toLowerCase().includes(s))));
  }, [data, q, type, hideZero]);
  const groups = ACCOUNT_TYPES.map((t) => ({ type: t, rows: rows.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)) })).filter((g) => g.rows.length);

  const submit = () => {
    if (!form) return;
    if (!form.name.trim()) return setErr({ name: 'Give the account a name' });
    create.mutate(form, { onSuccess: () => setForm(null), onError: (e) => setErr({ ...fieldErrors(e), form: e.message }) });
  };

  return (
    <div className="page">
      <PageHeader title="Chart of Accounts" crumbs={<>Accounting <span>/</span> Chart of Accounts</>}
        subtitle="Every account your books post to, with today’s balance. Sales, purchases, payments, expenses and stock post here automatically."
        actions={<>
          <ExportMenu disabled={!rows.length} table={() => ({
            title: 'Chart of accounts', subtitle: `Balances as of ${todayISO()}`, filename: `chart-of-accounts-${todayISO()}`,
            columns: [{ label: 'Code' }, { label: 'Account' }, { label: 'Type' }, { label: 'Detail type' }, { label: 'Balance', money: true }],
            rows: groups.flatMap((g) => [
              { cells: ['', TYPE_LABEL[g.type], '', '', null], kind: 'group' as const },
              ...g.rows.map((a) => ({ cells: [a.code, a.name, TYPE_LABEL[a.type], subtypeLabel(a), a.balance] })),
            ]),
          })} />
          {canWrite && <button className="btn btn-primary" onClick={start}><Plus size={16} /> New account</button>}
        </>} />
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search accounts…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {(['all', ...ACCOUNT_TYPES] as const).map((t) => <button key={t} className={`filter-chip ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{t === 'all' ? 'All' : TYPE_LABEL[t]}</button>)}
            </div>
          </div>
          <div className="toolbar-right"><label className="row small" style={{ gap: 6 }}><input type="checkbox" className="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide zero balances</label></div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 360 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load the chart of accounts. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : !groups.length ? <EmptyState icon={BookOpen} title="No accounts match" text="Clear the search or show all account types." /> : (
            <table className="table">
              <thead><tr><th style={{ width: 80 }}>Code</th><th>Account</th><th>Detail type</th><th className="num">Balance</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.type}>
                    <tr className="group-row"><td colSpan={3}>{TYPE_LABEL[g.type]}</td><td className="num">{money(g.rows.reduce((s, a) => s + a.balance, 0))}</td><td /></tr>
                    {g.rows.map((a) => (
                      <tr key={a.key} className="clickable" onClick={() => navigate(`/app/accounting/ledger?account=${encodeURIComponent(a.key)}`)}>
                        <td className="mono muted">{a.code || '—'}</td>
                        <td><span className="strong">{a.name}</span>{a.system && <Lock size={11} className="muted" style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Built-in account" />}<div className="muted small">{a.description}</div></td>
                        <td className="muted">{subtypeLabel(a)}</td>
                        <td className="num strong" style={a.balance < 0 ? { color: 'var(--red-600)' } : undefined}>{money(a.balance)}</td>
                        <td onClick={(e) => e.stopPropagation()}>{canWrite && !a.system && a.id && Math.abs(a.balance) < 0.005 && <button className="icon-btn" title="Archive account" onClick={() => archive.mutate(a.id!)}><Archive size={15} /></button>}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
          <Lock size={11} style={{ verticalAlign: -1 }} /> Built-in accounts come from your sales, purchases, banking and stock. Add your own for fixed assets, loans or other income, then post to them with a <Link to="/app/accounting/journals">manual journal</Link>.
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="New account" subtitle="Use it in manual journals and as a banking category."
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={submit}>{create.isPending && <Loader2 size={15} className="spin" />} Save account</button></>}>
        {form && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="form-grid">
              <Field label="Account type" required>
                <select className="select" value={form.type} onChange={(e) => { const t = e.target.value as AccountType; setForm({ ...form, type: t, subtype: ACCOUNT_SUBTYPES[t][0]!.id }); }}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
              </Field>
              <Field label="Detail type">
                <select className="select" value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>{ACCOUNT_SUBTYPES[form.type].map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              </Field>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
              <Field label="Code"><input className="input mono" value={form.code} maxLength={10} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1500" /></Field>
              <Field label="Account name" required error={err.name}><input className={`input ${err.name ? 'invalid' : ''}`} value={form.name} maxLength={80} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Furniture & fixtures" /></Field>
            </div>
            <Field label="Description"><input className="input" value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            {err.form && <div className="field-error">{err.form}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
