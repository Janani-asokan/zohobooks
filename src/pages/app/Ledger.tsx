import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api } from '@/api/client';
import { useAccounts } from '@/api/hooks';
import type { GeneralLedger } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, PageHeader } from '@/components/ui';
import { AccountSelect } from '@/components/AccountSelect';
import { DateRange, periodPresets, rangeLabel } from '@/components/DateRange';
import { ExportMenu } from '@/components/ExportMenu';
import { fmtDate, money, todayISO } from '@/lib/format';
import { TYPE_LABEL } from '../../../shared/accounting';

const SOURCE: Record<string, { label: string; link?: (id: string) => string }> = {
  invoice: { label: 'Invoice', link: (id) => `/app/sales/invoices/${id}` },
  payment: { label: 'Payment received', link: () => '/app/sales/payments' },
  credit_note: { label: 'Credit note', link: () => '/app/sales/credit-notes' },
  bill: { label: 'Bill', link: () => '/app/purchases/bills' },
  bill_payment: { label: 'Payment made', link: () => '/app/purchases/payments' },
  expense: { label: 'Expense', link: () => '/app/purchases/expenses' },
  bank: { label: 'Bank transaction', link: () => '/app/banking' },
  journal: { label: 'Journal', link: () => '/app/accounting/journals' },
  loan: { label: 'Loan given', link: (id) => `/app/microfinance/loans/${id}` },
  loan_receipt: { label: 'Loan receipt', link: () => '/app/microfinance/collections' },
  loan_charge: { label: 'Late charge', link: () => '/app/microfinance/loans' },
  stock: { label: 'Stock' },
  opening: { label: 'Opening balance' },
};

/** Every posting to one account over a period, with the running balance. */
export default function Ledger() {
  const me = useShopUser();
  const accounts = useAccounts().data ?? [];
  const [params, setParams] = useSearchParams();
  const fy = useMemo(() => periodPresets(me.platform.fyStartMonth).find((p) => p.id === 'this_fy')!, [me.platform.fyStartMonth]);
  const account = params.get('account') ?? '';
  const range = { from: params.get('from') ?? fy.from, to: params.get('to') ?? todayISO() };
  const set = (p: Record<string, string>) => setParams({ account, from: range.from, to: range.to, ...p }, { replace: true });
  const gl = useQuery({
    queryKey: ['report', 'ledger', account, range.from, range.to],
    queryFn: () => api.get<GeneralLedger>(`/shop/accounting/ledger?account=${encodeURIComponent(account)}&from=${range.from}&to=${range.to}`),
    enabled: !!account,
  });
  const d = gl.data;

  return (
    <div className="page">
      <PageHeader title="General Ledger" crumbs={<>Accounting <span>/</span> <Link to="/app/accounting/accounts">Chart of Accounts</Link></>}
        subtitle={d ? `${d.account.name} · ${TYPE_LABEL[d.account.type]} · ${rangeLabel(range)}` : 'Pick an account to see every entry posted to it.'}
        actions={<ExportMenu disabled={!d} table={() => !d ? null : ({
          title: `Ledger · ${d.account.name}`, subtitle: rangeLabel(range), filename: `ledger-${d.account.name.replace(/\W+/g, '-').toLowerCase()}-${range.from}-${range.to}`,
          columns: [{ label: 'Date' }, { label: 'Type' }, { label: 'Number' }, { label: 'Description' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }, { label: 'Balance', money: true }],
          rows: [
            { cells: ['', '', '', 'Opening balance', null, null, d.opening], kind: 'sub' },
            ...d.rows.map((r) => ({ cells: [fmtDate(r.date), SOURCE[r.source]?.label ?? r.source, r.number, r.description, r.debit || null, r.credit || null, r.balance] })),
            { cells: ['', '', '', 'Closing balance', d.totalDebit, d.totalCredit, d.closing], kind: 'total' },
          ],
          landscape: true,
        })} />} />
      <div className="report-filters no-print">
        <div style={{ minWidth: 280 }}><AccountSelect accounts={accounts} value={account} onChange={(v) => set({ account: v })} /></div>
      </div>
      <DateRange value={range} onChange={(r) => set({ from: r.from, to: r.to })} fyStartMonth={me.platform.fyStartMonth} />
      <div className="card table-wrap print-area">
        {!account ? <EmptyState icon={BookOpen} title="Choose an account" text="Pick an account above, or open one from the chart of accounts." action={<Link className="btn btn-secondary" to="/app/accounting/accounts">Chart of accounts</Link>} />
          : gl.isLoading ? <div className="skeleton" style={{ height: 320, margin: 16 }} />
          : gl.isError || !d ? <div className="error-state" style={{ margin: 16 }}>Couldn’t load this ledger. <button className="btn btn-ghost btn-sm" onClick={() => gl.refetch()}>Try again</button></div>
          : (
            <table className="table report-table">
              <thead><tr><th>Date</th><th>Type</th><th>Number</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <tr className="rk-sub"><td colSpan={6}>Opening balance on {fmtDate(range.from)}</td><td className="num">{money(d.opening)}</td></tr>
                {d.rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No entries in this period.</td></tr>}
                {d.rows.map((r, i) => {
                  const src = SOURCE[r.source];
                  const href = src?.link && r.sourceId ? src.link(r.sourceId) : undefined;
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                      <td className="muted">{src?.label ?? r.source}</td>
                      <td className="strong">{href && r.number ? <Link to={href}>{r.number}</Link> : r.number || '—'}</td>
                      <td>{r.description}</td>
                      <td className="num">{r.debit ? money(r.debit) : ''}</td>
                      <td className="num">{r.credit ? money(r.credit) : ''}</td>
                      <td className="num strong" style={r.balance < 0 ? { color: 'var(--red-600)' } : undefined}>{money(r.balance)}</td>
                    </tr>
                  );
                })}
                <tr className="rk-total"><td colSpan={4}>Closing balance on {fmtDate(range.to)}</td><td className="num">{money(d.totalDebit)}</td><td className="num">{money(d.totalCredit)}</td><td className="num">{money(d.closing)}</td></tr>
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
