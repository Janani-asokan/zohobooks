import { useMemo, useState } from 'react';
import { AttachButton } from '@/components/AttachButton';
import { ExportMenu } from '@/components/ExportMenu';
import { Link } from 'react-router-dom';
import { Wallet, Smartphone, Banknote, CreditCard, Landmark, Trash2, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useBillPayments, useMut } from '@/api/hooks';
import type { BillPayment } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { ConfirmModal, EmptyState, PageHeader, Pagination, SearchInput, StatCard, usePagination } from '@/components/ui';
import { fmtDate, money, num2 } from '@/lib/format';

const MODE_ICON: Record<string, typeof Wallet> = { UPI: Smartphone, Cash: Banknote, Card: CreditCard, 'Bank Transfer': Landmark, Cheque: Landmark };
interface Ageing { asOf: string; vendors: Array<{ vendorId: string; name: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number }>; totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number } }
const BUCKETS = [['current', 'Not due'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', '90+']] as const;

/** Money out: payments against vendor bills, and what is still owed by age. */
export default function PaymentsMade() {
  const me = useShopUser();
  const { data = [], isLoading, isError, refetch } = useBillPayments();
  const ageing = useQuery({ queryKey: ['payablesAgeing'], queryFn: () => api.get<Ageing>('/shop/payables-ageing') });
  const [tab, setTab] = useState<'payments' | 'ageing'>('payments');
  const [q, setQ] = useState('');
  const [del, setDel] = useState<BillPayment | null>(null);
  const remove = useMut((id: string) => api.del(`/shop/bill-payments/${id}`), [['billPayments'], ['bills'], ['vendors'], ['bankAccounts'], ['bankTxns'], ['payablesAgeing'], ['dashboard']], { success: 'Payment removed · the bill is open again' });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((p) => !s || [p.number, p.billNumber, p.vendorName, p.reference, p.vendorBillNo].some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [data, q]);
  const pg = usePagination(rows, 15);
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const thisMonth = data.filter((p) => p.date >= monthStart);
  const a = ageing.data;

  return (
    <div className="page">
      <PageHeader title="Payments Made" crumbs={<>Purchases <span>/</span> Payments Made</>} subtitle="What you have paid vendors, and what is still owed by age."
        actions={<ExportMenu disabled={!rows.length} table={() => ({
          title: 'Payments made', subtitle: `${rows.length} payments`, filename: 'payments-made',
          columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'Bill' }, { label: 'Vendor' }, { label: 'Mode' }, { label: 'Paid from' }, { label: 'TDS', money: true }, { label: 'Amount', money: true }],
          rows: [...rows.map((p) => ({ cells: [fmtDate(p.date), p.number, p.billNumber, p.vendorName, p.mode, p.accountName ?? '', p.tdsAmount, p.amount] as Array<string | number | null> })), { cells: ['Total', '', '', '', '', '', rows.reduce((a, p) => a + p.tdsAmount, 0), rows.reduce((a, p) => a + p.amount, 0)], kind: 'total' as const }],
        })} />} />
      <div className="stat-grid">
        <StatCard label="Paid this month" value={money(thisMonth.reduce((s, p) => s + p.amount, 0))} icon={Wallet} tone="blue" foot={<>{thisMonth.length} payments</>} />
        <StatCard label="Still owed" value={money(a?.totals.total ?? 0)} icon={Landmark} tone="amber" foot={<>{a?.vendors.length ?? 0} vendors</>} />
        <StatCard label="Overdue" value={money(a ? a.totals.total - a.totals.current : 0)} icon={Clock} tone="red" foot="Past the bill due date" />
        <StatCard label="TDS deducted" value={money(thisMonth.reduce((s, p) => s + p.tdsAmount, 0))} icon={Banknote} tone="green" foot="This month" />
      </div>
      <div className="card mt-16">
        <div className="tabs" style={{ padding: '0 16px', marginBottom: 0 }}>
          <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>Payments <span className="count">{data.length}</span></button>
          <button className={tab === 'ageing' ? 'active' : ''} onClick={() => setTab('ageing')}>Payables ageing</button>
        </div>
        {tab === 'payments' ? (
          <>
            <div className="toolbar"><div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search payment, bill, vendor, reference…" /></div></div>
            <div className="table-wrap">
              {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
                <div style={{ padding: 16 }}><div className="error-state">Couldn’t load payments. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
              ) : rows.length === 0 ? <EmptyState icon={Wallet} title={data.length ? 'No payments match' : 'No payments yet'} text="Pay a bill from the Bills page; part payments are fine." action={<Link to="/app/purchases/bills" className="btn btn-secondary">Go to bills</Link>} /> : (
                <table className="table">
                  <thead><tr><th>Date</th><th>Payment #</th><th>Vendor</th><th>Bill</th><th>Mode</th><th>Paid from</th><th className="num">TDS</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>
                    {pg.slice.map((p) => {
                      const I = MODE_ICON[p.mode] ?? Wallet;
                      return (
                        <tr key={p.id}>
                          <td>{fmtDate(p.date)}</td>
                          <td className="strong">{p.number}{p.reference && <div className="muted">{p.reference}</div>}</td>
                          <td>{p.vendorName}</td>
                          <td><Link to="/app/purchases/bills">{p.billNumber}</Link>{p.vendorBillNo && <div className="muted">Vendor # {p.vendorBillNo}</div>}</td>
                          <td><span className="row" style={{ gap: 6 }}><I size={14} className="muted" /> {p.mode}</span></td>
                          <td className="muted">{p.accountName ?? '—'}</td>
                          <td className="num muted">{p.tdsAmount ? money(p.tdsAmount) : '—'}</td>
                          <td className="num strong">{money(p.amount)}</td>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}><AttachButton entity="bill_payment" entityId={p.id} title={p.number} canWrite={me.can('purchases.write')} />{me.can('purchases.write') && <button className="icon-btn danger" title="Remove payment" onClick={() => setDel(p)}><Trash2 size={15} /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <Pagination {...pg} />
          </>
        ) : (
          <div className="table-wrap">
            {ageing.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : !a || a.vendors.length === 0 ? <EmptyState icon={Landmark} title="Nothing owed" text="Every vendor bill is paid." /> : (
              <table className="table">
                <thead><tr><th>Vendor</th>{BUCKETS.map(([, l]) => <th key={l} className="num">{l === 'Not due' ? l : `${l} days`}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {a.vendors.map((v) => (
                    <tr key={v.vendorId}>
                      <td><Link to={`/app/purchases/vendors?v=${v.vendorId}`} className="strong">{v.name}</Link></td>
                      {BUCKETS.map(([k]) => <td key={k} className="num" style={k !== 'current' && v[k] > 0 ? { color: 'var(--red-600)' } : undefined}>{v[k] ? num2(v[k]) : '—'}</td>)}
                      <td className="num strong">{money(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td className="strong">Total</td>{BUCKETS.map(([k]) => <td key={k} className="num strong">{num2(a.totals[k])}</td>)}<td className="num strong">{money(a.totals.total)}</td></tr></tfoot>
              </table>
            )}
          </div>
        )}
      </div>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Remove payment?" confirmLabel="Remove" text={`${del?.number} for ${money(del?.amount ?? 0)} will be deleted, the bank withdrawal reversed and ${del?.billNumber} reopened.`} onConfirm={() => remove.mutate(del!.id)} />
    </div>
  );
}
