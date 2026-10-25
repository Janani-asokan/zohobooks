import { useMemo, useState } from 'react';
import { AttachButton } from '@/components/AttachButton';
import { ExportMenu } from '@/components/ExportMenu';
import { Link } from 'react-router-dom';
import { Wallet, Smartphone, Banknote, CreditCard, Landmark } from 'lucide-react';
import { usePayments } from '@/api/hooks';
import { usePrefs } from '@/context/PrefsContext';
import { EmptyState, PageHeader, Pagination, SearchInput, StatCard, usePagination } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { Hint } from '@/components/kit';

const MODE_ICON: Record<string, typeof Wallet> = { UPI: Smartphone, Cash: Banknote, Card: CreditCard, 'Bank Transfer': Landmark, Cheque: Landmark };

export default function PaymentsReceived() {
  const { t } = usePrefs();
  const { data = [], isLoading } = usePayments();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('all');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((p) => (mode === 'all' || p.mode === mode) && (!s || [p.invoiceNumber, p.customer, p.reference].some((v) => (v ?? '').toLowerCase().includes(s))));
  }, [data, q, mode]);
  const pg = usePagination(rows, 15);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const thisMonth = data.filter((p) => p.date >= monthStart);
  const byMode = (m: string) => thisMonth.filter((p) => p.mode === m).reduce((s, p) => s + p.amount, 0);

  return (
    <div className="page">
      <PageHeader title={t('nav.payments')} crumbs={<>{t('nav.sales')} <span>/</span> {t('nav.payments')}</>} subtitle="Every payment recorded against your invoices, including POS sales."
        actions={<ExportMenu disabled={!rows.length} table={() => ({
          title: 'Payments received', subtitle: `${rows.length} payments`, filename: 'payments-received',
          columns: [{ label: 'Date' }, { label: 'Invoice' }, { label: 'Customer' }, { label: 'Mode' }, { label: 'Reference' }, { label: 'Deposited to' }, { label: 'TDS', money: true }, { label: 'Amount', money: true }],
          rows: [...rows.map((p) => ({ cells: [fmtDate(p.date), p.invoiceNumber, p.customer, p.mode, p.reference, p.account ?? '', p.tdsAmount, p.amount] as Array<string | number | null> })), { cells: ['Total', '', '', '', '', '', rows.reduce((a, p) => a + p.tdsAmount, 0), rows.reduce((a, p) => a + p.amount, 0)], kind: 'total' as const }],
        })} />} />
      <Hint id="payments" title="Money in">
        <p>Record a payment from any invoice’s <strong>Record payment</strong> button — part-payments and TDS deductions are supported. Each payment is posted to the bank or cash account you choose, so Banking always matches.</p>
      </Hint>
      <div className="stat-grid">
        <StatCard label="Received this month" value={money(thisMonth.reduce((s, p) => s + p.amount, 0))} icon={Wallet} tone="green" foot={<>{thisMonth.length} payments</>} />
        <StatCard label="UPI" value={money(byMode('UPI'))} icon={Smartphone} tone="violet" foot="This month" />
        <StatCard label="Cash" value={money(byMode('Cash'))} icon={Banknote} tone="amber" foot="This month" />
        <StatCard label="Bank & card" value={money(byMode('Bank Transfer') + byMode('Card') + byMode('Cheque'))} icon={Landmark} tone="blue" foot="This month" />
      </div>
      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search invoice, customer, reference…" />
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode"><option value="all">All modes</option>{['UPI', 'Cash', 'Card', 'Bank Transfer', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : rows.length === 0 ? <EmptyState icon={Wallet} title="No payments yet" text="Record a payment from any issued invoice." /> : (
            <table className="table">
              <thead><tr><th>{t('common.date')}</th><th>Invoice</th><th>{t('common.customer')}</th><th>Mode</th><th>Reference</th><th>Deposited to</th><th className="num">TDS</th><th className="num">{t('common.amount')}</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>
                {pg.slice.map((p) => {
                  const I = MODE_ICON[p.mode] ?? Wallet;
                  return (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td>
                      <td><Link to={`/app/sales/invoices/${p.invoiceId}`} className="strong">{p.invoiceNumber}</Link></td>
                      <td>{p.customer}</td>
                      <td><span className="row" style={{ gap: 6 }}><I size={14} className="muted" /> {p.mode}</span></td>
                      <td className="muted">{p.reference || '—'}</td>
                      <td className="muted">{p.account ?? '—'}</td>
                      <td className="num muted">{p.tdsAmount ? money(p.tdsAmount) : '—'}</td>
                      <td className="num strong" style={{ color: 'var(--green-700)' }}>{money(p.amount)}</td>
                      <td><AttachButton entity="payment" entityId={p.id} title={`Payment · ${p.invoiceNumber}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination {...pg} />
      </div>
    </div>
  );
}
