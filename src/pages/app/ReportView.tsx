import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CheckCircle2, ChevronLeft, Clock4, Landmark, Package, Scale, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { api } from '@/api/client';
import type { Ageing, BalanceSheet, CashFlow, ProfitAndLoss, SalesBy, TrialBalance } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { DateRange, periodPresets, rangeLabel, type Range } from '@/components/DateRange';
import { ExportMenu } from '@/components/ExportMenu';
import { money, moneyShort, todayISO } from '@/lib/format';
import type { ReportTable } from '@/lib/report';
import type { Permission } from '../../../shared/permissions';

type Cell = string | number | null;
interface Row { cells: Cell[]; kind?: 'row' | 'group' | 'sub' | 'total'; link?: string; indent?: boolean }
interface Built { columns: ReportTable['columns']; rows: Row[]; note?: string; stats?: Array<{ label: string; value: string; foot?: string; tone?: string; icon?: LucideIcon }>; chart?: { labels: string[]; series: Array<{ name: string; values: number[] }> }; banner?: { ok: boolean; text: string } }

export const REPORTS: Record<string, { title: string; group: string; description: string; asOf?: boolean; perm: Permission }> = {
  'profit-loss': { title: 'Profit & Loss', group: 'Business overview', description: 'Income, cost of goods sold, expenses and net profit for a period.', perm: 'reports.read' },
  'balance-sheet': { title: 'Balance Sheet', group: 'Business overview', description: 'What the business owns and owes, and the owner’s equity, on a date.', asOf: true, perm: 'reports.read' },
  'cash-flow': { title: 'Cash Flow', group: 'Business overview', description: 'Money in and out of cash and bank accounts, by activity.', perm: 'reports.read' },
  'trial-balance': { title: 'Trial Balance', group: 'Accountant', description: 'Debit and credit balance of every account on a date.', asOf: true, perm: 'accounting.read' },
  'sales-by-customer': { title: 'Sales by Customer', group: 'Sales', description: 'Invoiced sales, tax and amount still due, per customer.', perm: 'reports.read' },
  'sales-by-item': { title: 'Sales by Item', group: 'Sales', description: 'Quantity sold, sales value and gross profit per item.', perm: 'reports.read' },
  receivables: { title: 'Receivables Ageing', group: 'Sales', description: 'What customers owe, by how many days it is overdue.', asOf: true, perm: 'reports.read' },
  payables: { title: 'Payables Ageing', group: 'Purchases', description: 'What you owe vendors, by how many days it is overdue.', asOf: true, perm: 'purchases.read' },
};

const ICONS: Record<string, LucideIcon> = { 'profit-loss': TrendingUp, 'balance-sheet': Scale, 'cash-flow': Wallet, 'trial-balance': Landmark, 'sales-by-customer': Users, 'sales-by-item': Package, receivables: Clock4, payables: Clock4 };

const ledgerLink = (key: string, r: Range) => (key === 'current_profit' ? `/app/reports/profit-loss?to=${r.to}` : `/app/accounting/ledger?account=${encodeURIComponent(key)}&from=${r.from}&to=${r.to}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

function build(id: string, data: unknown, r: Range, canCost: boolean): Built {
  switch (id) {
    case 'profit-loss': {
      const d = data as ProfitAndLoss;
      const sec = (s: ProfitAndLoss['income'], totalLabel: string): Row[] => [
        { cells: [s.label, null], kind: 'group' },
        ...(s.rows.length ? s.rows.map((x) => ({ cells: [x.name, x.amount] as Cell[], link: ledgerLink(x.key, r), indent: true })) : [{ cells: ['Nothing in this period', null] as Cell[], indent: true }]),
        { cells: [totalLabel, s.total], kind: 'sub' },
      ];
      return {
        columns: [{ label: 'Account' }, { label: 'Amount', money: true }],
        rows: [
          ...sec(d.income, 'Total operating income'),
          ...sec(d.cogs, 'Total cost of goods sold'),
          { cells: ['Gross profit', d.grossProfit], kind: 'total' },
          ...sec(d.expenses, 'Total operating expenses'),
          ...(d.otherIncome.rows.length ? sec(d.otherIncome, 'Total other income') : []),
          ...(d.otherExpenses.rows.length ? sec(d.otherExpenses, 'Total other expenses') : []),
          { cells: [d.netProfit < 0 ? 'Net loss' : 'Net profit', d.netProfit], kind: 'total' },
        ],
        note: 'Amounts exclude GST. Cost of goods sold is valued at item cost.',
        stats: [
          { label: 'Operating income', value: moneyShort(d.income.total), tone: 'blue' },
          { label: 'Gross profit', value: moneyShort(d.grossProfit), foot: `${pct(d.grossProfit, d.income.total)} gross margin`, tone: 'violet' },
          { label: 'Operating expenses', value: moneyShort(d.expenses.total), foot: `${d.expenses.rows.length} accounts`, tone: 'amber' },
          { label: d.netProfit < 0 ? 'Net loss' : 'Net profit', value: moneyShort(d.netProfit), foot: `${pct(d.netProfit, d.income.total)} of income`, tone: d.netProfit < 0 ? 'red' : 'green' },
        ],
        chart: d.monthly.length > 1 ? { labels: d.monthly.map((m) => new Date(m.month + '-01').toLocaleString('en-IN', { month: 'short' })), series: [{ name: 'Income', values: d.monthly.map((m) => m.income) }, { name: 'Expenses', values: d.monthly.map((m) => m.expenses) }] } : undefined,
      };
    }
    case 'balance-sheet': {
      const d = data as BalanceSheet;
      const sec = (s: BalanceSheet['equity']): Row[] => s.rows.length ? [
        { cells: [s.label, null], kind: 'group' },
        ...s.rows.map((x) => ({ cells: [x.name, x.amount] as Cell[], link: ledgerLink(x.key, { from: '2000-01-01', to: r.to }), indent: true })),
        { cells: [`Total ${s.label.toLowerCase()}`, s.total], kind: 'sub' },
      ] : [];
      return {
        columns: [{ label: 'Account' }, { label: 'Amount', money: true }],
        rows: [
          ...d.assets.flatMap(sec), { cells: ['Total assets', d.totalAssets], kind: 'total' },
          ...d.liabilities.flatMap(sec), { cells: ['Total liabilities', d.totalLiabilities], kind: 'total' },
          ...sec(d.equity), { cells: ['Total liabilities and equity', d.totalLiabilities + d.totalEquity], kind: 'total' },
        ],
        banner: { ok: d.balanced, text: d.balanced ? 'Assets equal liabilities plus equity.' : `Out of balance by ${money(d.totalAssets - d.totalLiabilities - d.totalEquity)}. Check recent manual journals.` },
        stats: [
          { label: 'Total assets', value: moneyShort(d.totalAssets), tone: 'blue' },
          { label: 'Total liabilities', value: moneyShort(d.totalLiabilities), tone: 'amber' },
          { label: 'Equity', value: moneyShort(d.totalEquity), tone: 'green' },
          { label: 'Cash & bank', value: moneyShort(d.assets[0]?.total ?? 0), tone: 'violet' },
        ],
      };
    }
    case 'cash-flow': {
      const d = data as CashFlow;
      const net = d.sections.reduce((s, x) => s + x.total, 0);
      return {
        columns: [{ label: 'Activity' }, { label: 'Amount', money: true }],
        rows: [
          { cells: ['Cash at the start of the period', d.opening], kind: 'sub' },
          ...d.sections.flatMap((s) => [
            { cells: [s.label, null], kind: 'group' as const },
            ...(s.rows.length ? s.rows.map((x) => ({ cells: [x.label, x.amount] as Cell[], indent: true })) : [{ cells: ['No movement', null] as Cell[], indent: true }]),
            { cells: [`Net cash from ${s.label.toLowerCase()}`, s.total], kind: 'sub' as const },
          ]),
          { cells: ['Net change in cash', net], kind: 'sub' },
          { cells: ['Cash at the end of the period', d.closing], kind: 'total' },
          ...(d.byAccount.length ? [{ cells: ['By account', null], kind: 'group' as const }, ...d.byAccount.map((a) => ({ cells: [`${a.name} · closing balance`, a.closing] as Cell[], link: ledgerLink(a.key, r), indent: true }))] : []),
        ],
        stats: [
          { label: 'Opening cash', value: moneyShort(d.opening), tone: 'blue' },
          { label: 'Money in', value: moneyShort(d.sections.flatMap((s) => s.rows).filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0)), tone: 'green' },
          { label: 'Money out', value: moneyShort(-d.sections.flatMap((s) => s.rows).filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0)), tone: 'red' },
          { label: 'Closing cash', value: moneyShort(d.closing), tone: 'violet' },
        ],
      };
    }
    case 'trial-balance': {
      const d = data as TrialBalance;
      return {
        columns: [{ label: 'Code' }, { label: 'Account' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }],
        rows: [
          ...d.rows.map((x) => ({ cells: [x.code, x.name, x.debit || null, x.credit || null] as Cell[], link: ledgerLink(x.key, { from: '2000-01-01', to: r.to }) })),
          { cells: ['', 'Total', d.totalDebit, d.totalCredit], kind: 'total' },
        ],
        banner: { ok: Math.abs(d.totalDebit - d.totalCredit) < 0.01, text: Math.abs(d.totalDebit - d.totalCredit) < 0.01 ? 'Debits equal credits.' : `Debits and credits differ by ${money(d.totalDebit - d.totalCredit)}.` },
      };
    }
    case 'sales-by-customer': {
      const d = data as SalesBy;
      const t = d.byCustomer.reduce((a, x) => ({ count: a.count + x.count, net: a.net + x.net, tax: a.tax + x.tax, total: a.total + x.total, due: a.due + x.due }), { count: 0, net: 0, tax: 0, total: 0, due: 0 });
      return {
        columns: [{ label: 'Customer' }, { label: 'GSTIN' }, { label: 'Invoices', align: 'right', money: false }, { label: 'Net sales', money: true }, { label: 'GST', money: true }, { label: 'Total', money: true }, { label: 'Outstanding', money: true }],
        rows: [...d.byCustomer.map((x) => ({ cells: [x.name, x.gstin || '—', x.count, x.net, x.tax, x.total, x.due] as Cell[], link: x.id !== 'walk-in' ? `/app/sales/customers?open=${x.id}` : undefined })), { cells: ['Total', '', t.count, t.net, t.tax, t.total, t.due], kind: 'total' }],
        stats: [
          { label: 'Customers', value: String(d.byCustomer.length), tone: 'blue' },
          { label: 'Invoiced (incl. GST)', value: moneyShort(t.total), foot: `${t.count} invoices`, tone: 'green' },
          { label: 'Top customer', value: d.byCustomer[0] ? moneyShort(d.byCustomer[0].total) : '—', foot: d.byCustomer[0]?.name, tone: 'violet' },
          { label: 'Still to collect', value: moneyShort(t.due), tone: 'amber' },
        ],
      };
    }
    case 'sales-by-item': {
      const d = data as SalesBy;
      const amount = d.byItem.reduce((s, x) => s + x.amount, 0);
      const cost = d.byItem.reduce((s, x) => s + (x.cost ?? 0), 0);
      return {
        columns: [{ label: 'Item' }, { label: 'HSN/SAC' }, { label: 'Qty sold', align: 'right', money: false }, { label: 'Invoices', align: 'right', money: false }, { label: 'Sales (net)', money: true },
          ...(canCost ? [{ label: 'Cost', money: true }, { label: 'Gross profit', money: true }, { label: 'Margin', align: 'right' as const }] : [])],
        rows: [
          ...d.byItem.map((x) => ({ cells: [x.name, x.hsn || '—', `${x.qty} ${x.unit}`.trim(), x.invoices, x.amount, ...(canCost ? [x.cost, x.profit, pct(x.profit ?? 0, x.amount)] : [])] as Cell[], link: x.itemId ? `/app/items?open=${x.itemId}` : undefined })),
          { cells: ['Total', '', '', '', amount, ...(canCost ? [cost, amount - cost, pct(amount - cost, amount)] : [])], kind: 'total' },
        ],
        stats: [
          { label: 'Items sold', value: String(d.byItem.length), tone: 'blue' },
          { label: 'Sales (net)', value: moneyShort(amount), tone: 'green' },
          ...(canCost ? [{ label: 'Gross profit', value: moneyShort(amount - cost), foot: `${pct(amount - cost, amount)} margin`, tone: 'violet' }] : []),
          { label: 'Best seller', value: d.byItem[0] ? moneyShort(d.byItem[0].amount) : '—', foot: d.byItem[0]?.name, tone: 'amber' },
        ],
      };
    }
    case 'receivables':
    case 'payables': {
      const d = data as Ageing;
      const party = id === 'receivables' ? 'Customer' : 'Vendor';
      return {
        columns: [{ label: party }, ...d.buckets.map((b) => ({ label: b, money: true })), { label: 'Total', money: true }],
        rows: [...d.parties.map((p) => ({ cells: [p.name, ...p.buckets.map((v) => v || null), p.total] as Cell[], link: id === 'receivables' ? (p.id !== 'walk-in' ? `/app/sales/customers?open=${p.id}` : undefined) : `/app/purchases/vendors?open=${p.id}` })), { cells: ['Total', ...d.totals, d.total], kind: 'total' }],
        chart: { labels: d.buckets, series: [{ name: 'Outstanding', values: d.totals }] },
        stats: [
          { label: 'Total outstanding', value: moneyShort(d.total), foot: `${d.documents.length} ${id === 'receivables' ? 'invoices' : 'bills'}`, tone: 'blue' },
          { label: 'Not yet due', value: moneyShort(d.totals[0] ?? 0), tone: 'green' },
          { label: 'Overdue', value: moneyShort(d.total - (d.totals[0] ?? 0)), foot: `${d.documents.filter((x) => x.daysOverdue > 0).length} overdue`, tone: 'amber' },
          { label: 'Over 90 days', value: moneyShort(d.totals[4] ?? 0), tone: 'red' },
        ],
      };
    }
  }
  return { columns: [], rows: [] };
}

const urlFor = (id: string, r: Range) => {
  switch (id) {
    case 'profit-loss': return `/shop/reports/profit-loss?from=${r.from}&to=${r.to}`;
    case 'balance-sheet': return `/shop/reports/balance-sheet?asOf=${r.to}`;
    case 'cash-flow': return `/shop/reports/cash-flow?from=${r.from}&to=${r.to}`;
    case 'trial-balance': return `/shop/accounting/trial-balance?asOf=${r.to}`;
    case 'sales-by-customer': case 'sales-by-item': return `/shop/reports/sales-by?from=${r.from}&to=${r.to}`;
    case 'receivables': return `/shop/reports/ageing?kind=receivable&asOf=${r.to}`;
    case 'payables': return `/shop/reports/ageing?kind=payable&asOf=${r.to}`;
  }
  return '';
};

/** One financial report: period filter, summary, the statement itself, and PDF / Excel / CSV export of exactly what is shown. */
export default function ReportView() {
  const { id = '' } = useParams();
  const me = useShopUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = REPORTS[id];
  const fy = useMemo(() => periodPresets(me.platform.fyStartMonth).find((p) => p.id === 'this_fy')!, [me.platform.fyStartMonth]);
  const range: Range = { from: params.get('from') ?? fy.from, to: params.get('to') ?? todayISO() };
  const setRange = (r: Range) => setParams({ from: r.from, to: r.to }, { replace: true });
  const [view, setView] = useState<'summary' | 'documents'>('summary');
  const q = useQuery({ queryKey: ['report', id, meta?.asOf ? range.to : `${range.from}:${range.to}`], queryFn: () => api.get<unknown>(urlFor(id, range)), enabled: !!meta && me.can(meta.perm) });

  if (!meta) return <Navigate to="/app/reports" replace />;
  if (!me.can(meta.perm)) return <div className="page"><PageHeader title={meta.title} /><div className="card"><EmptyState icon={BarChart3} title="You don’t have access to this report" text="Ask the owner to give your role access to it under Settings → Roles." /></div></div>;

  const canCost = me.can('items.cost');
  const built = q.data ? build(id, q.data, range, canCost) : null;
  const ageing = (id === 'receivables' || id === 'payables') && q.data ? (q.data as Ageing) : null;
  const period = meta.asOf ? `As of ${rangeLabel({ from: range.to, to: range.to })}` : rangeLabel(range);
  const exportTable = (): ReportTable | null => {
    if (!built) return null;
    if (ageing && view === 'documents')
      return {
        title: `${meta.title} – documents`, subtitle: period, filename: `${id}-documents-${range.to}`,
        columns: [{ label: 'Number' }, { label: id === 'receivables' ? 'Customer' : 'Vendor' }, { label: 'Date' }, { label: 'Due' }, { label: 'Days overdue', align: 'right' }, { label: 'Balance', money: true }],
        rows: ageing.documents.map((x) => ({ cells: [x.number, x.party, x.date, x.dueDate ?? '', String(x.daysOverdue), x.balance] })),
      };
    return { title: meta.title, subtitle: period, filename: `${id}-${meta.asOf ? range.to : `${range.from}-to-${range.to}`}`, columns: built.columns, rows: built.rows.map((r) => ({ cells: r.cells, kind: r.kind })), note: built.note, landscape: built.columns.length > 6 };
  };

  return (
    <div className="page">
      <PageHeader title={meta.title} crumbs={<><Link to="/app/reports">Reports</Link> <span>/</span> {meta.group}</>} subtitle={`${meta.description} ${period}.`}
        actions={<><button className="btn btn-ghost" onClick={() => navigate('/app/reports')}><ChevronLeft size={15} /> All reports</button><ExportMenu disabled={!built} table={exportTable} /></>} />
      <DateRange value={range} onChange={setRange} fyStartMonth={me.platform.fyStartMonth} asOf={meta.asOf} />
      {q.isLoading ? <div className="card"><div className="skeleton" style={{ height: 420, margin: 16 }} /></div> : q.isError || !built ? (
        <div className="card"><div className="error-state" style={{ margin: 16 }}>Couldn’t load this report. {(q.error as Error)?.message} <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div></div>
      ) : (
        <div className="stack print-area">
          <div className="only-print report-print-head"><h2>{meta.title}</h2><div>{period}</div></div>
          {built.stats && <div className="stat-grid no-print">{built.stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} foot={s.foot} tone={s.tone} icon={s.icon ?? ICONS[id] ?? BarChart3} />)}</div>}
          {built.banner && <div className={`report-banner ${built.banner.ok ? 'ok' : 'bad'}`}>{built.banner.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {built.banner.text}</div>}
          {built.chart && <div className="card no-print"><div className="card-body"><BarChart labels={built.chart.labels} series={built.chart.series} format={moneyShort} height={200} /></div></div>}
          {ageing && (
            <div className="segmented no-print" style={{ alignSelf: 'flex-start' }}>
              <button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>By {id === 'receivables' ? 'customer' : 'vendor'}</button>
              <button className={view === 'documents' ? 'active' : ''} onClick={() => setView('documents')}>By {id === 'receivables' ? 'invoice' : 'bill'}</button>
            </div>
          )}
          <div className="card table-wrap">
            {ageing && view === 'documents' ? (
              ageing.documents.length === 0 ? <EmptyState icon={CheckCircle2} title="Nothing outstanding" text="Every document is settled as of this date." /> : (
                <table className="table">
                  <thead><tr><th>Number</th><th>{id === 'receivables' ? 'Customer' : 'Vendor'}</th><th>Date</th><th>Due</th><th className="num">Days overdue</th><th className="num">Balance</th></tr></thead>
                  <tbody>{ageing.documents.map((x) => (
                    <tr key={x.id}>
                      <td className="strong">{id === 'receivables' ? <Link to={`/app/sales/invoices/${x.id}`}>{x.number}</Link> : x.number}</td><td>{x.party}</td><td className="muted">{x.date}</td><td className="muted">{x.dueDate ?? '—'}</td>
                      <td className="num" style={x.daysOverdue > 30 ? { color: 'var(--red-600)' } : x.daysOverdue > 0 ? { color: 'var(--amber-700)' } : undefined}>{x.daysOverdue || '—'}</td><td className="num strong">{money(x.balance)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )
            ) : built.rows.length <= 1 && built.rows[0]?.kind === 'total' ? <EmptyState icon={BarChart3} title="Nothing in this period" text="Try a wider date range." /> : (
              <table className={`table report-table ${built.columns.length <= 2 ? 'statement' : ''}`}>
                <thead><tr>{built.columns.map((c, i) => <th key={i} className={c.money || c.align === 'right' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {built.rows.map((r, i) => (
                    <tr key={i} className={`${r.kind && r.kind !== 'row' ? `rk-${r.kind}` : ''} ${r.link ? 'clickable' : ''}`} onClick={r.link ? () => navigate(r.link!) : undefined}>
                      {r.cells.map((v, j) => {
                        const c = built.columns[j]!;
                        const right = c.money || c.align === 'right';
                        return <td key={j} className={right ? 'num' : ''} style={j === 0 && r.indent ? { paddingLeft: 28 } : undefined}>{v === null ? '' : typeof v === 'number' && c.money ? <span style={v < 0 ? { color: 'var(--red-600)' } : undefined}>{money(v)}</span> : String(v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {built.note && <p className="small muted">{built.note}</p>}
        </div>
      )}
    </div>
  );
}
