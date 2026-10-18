import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, FileText, Pencil, Phone, Mail, MapPin, Printer, Download, StickyNote, PhoneCall, MessageCircle, Users as Meeting, Receipt, IndianRupee, Bell, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { TIER_LABEL, type Customer } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState } from '@/components/ui';
import { fmtDate, money, num2, todayISO } from '@/lib/format';
import { toCsv } from '../../shared/csv';

export interface Statement {
  customer: { id: string; name: string; companyName: string; gstin: string; address: string; state: string; phone: string; email: string; creditLimit: number };
  from: string; to: string; openingBalance: number; closingBalance: number;
  entries: Array<{ date: string; type: 'invoice' | 'payment' | 'credit_note'; refId: string; ref: string; label: string; debit: number; credit: number; balance: number }>;
  totals: { debit: number; credit: number };
  ageing: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}
interface Activity { id: string; at: string; kind: string; body: string; by: string; refId: string | null; manual: boolean }

const KIND_ICON: Record<string, typeof StickyNote> = { note: StickyNote, call: PhoneCall, email: Mail, meeting: Meeting, whatsapp: MessageCircle, invoice: Receipt, payment: IndianRupee, reminder: Bell };
const fyStart = () => { const t = todayISO(); const y = Number(t.slice(0, 4)) - (t.slice(5, 7) < '04' ? 1 : 0); return `${y}-04-01`; };

/** Right-hand detail panel for a customer: balance and credit, statement of account, contact history. */
export function CustomerPanel({ customer: c, onClose, onEdit }: { customer: Customer; onClose: () => void; onEdit?: () => void }) {
  const me = useShopUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'statement' | 'activity'>('overview');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const used = c.creditLimit > 0 ? c.due / c.creditLimit : 0;
  return (
    <aside className="split-panel" aria-label={`${c.companyName || c.name} details`}>
      <div className="split-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{c.companyName || c.name}</h2>
          <div className="small muted">{c.customId} · {c.type}{c.gstin ? ` · GSTIN ${c.gstin}` : ''}</div>
        </div>
        {me.can('sales.write') && <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/app/sales/invoices/new?customer=${c.id}`)}><FileText size={14} /> Invoice</button>}
        {onEdit && <button className="icon-btn" onClick={onEdit} aria-label="Edit customer"><Pencil size={16} /></button>}
        <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Esc"><X size={18} /></button>
      </div>
      <div className="tabs" role="tablist">
        {(['overview', 'statement', 'activity'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'overview' ? 'Overview' : t === 'statement' ? 'Statement' : 'Activity'}</button>
        ))}
      </div>
      <div className="split-panel-body">
        {tab === 'overview' && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="kpi-row">
              <div><div className="k">Outstanding</div><div className="v">{money(c.due)}</div></div>
              <div>
                <div className="k">Credit limit</div>
                <div className="v">{c.creditLimit > 0 ? money(c.creditLimit) : 'No limit'}</div>
                {c.creditLimit > 0 && <div className={`meter ${used > 1 ? 'over' : used > 0.8 ? 'warn' : ''}`} title={`${Math.round(used * 100)}% used`}><span style={{ width: `${Math.min(100, used * 100)}%` }} /></div>}
              </div>
              <div><div className="k">Billed to date</div><div className="v">{money(c.billed)}</div></div>
              <div><div className="k">Invoices</div><div className="v">{c.invoiceCount}</div></div>
            </div>
            {c.creditLimit > 0 && used > 1 && <div className="field-error">Over the credit limit by {money(c.due - c.creditLimit)}. New invoices need confirmation.</div>}
            <dl className="kv-list">
              <dt><Phone size={14} /></dt><dd>{c.phone || '—'}</dd>
              <dt><Mail size={14} /></dt><dd>{c.email || '—'}</dd>
              <dt><MapPin size={14} /></dt><dd style={{ whiteSpace: 'pre-line' }}>{[c.address, c.state].filter(Boolean).join('\n') || '—'}</dd>
            </dl>
            <div className="small muted">Price level {c.tier} · {TIER_LABEL[c.tier]}</div>
            <Link className="small" to={`/app/sales/invoices?q=${encodeURIComponent(c.companyName || c.name)}`}>See all invoices →</Link>
          </div>
        )}
        {tab === 'statement' && <StatementView customerId={c.id} />}
        {tab === 'activity' && <ActivityView customerId={c.id} canWrite={me.can('customers.write')} />}
      </div>
    </aside>
  );
}

function StatementView({ customerId }: { customerId: string }) {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayISO());
  const q = useQuery({ queryKey: ['statement', customerId, from, to], queryFn: () => api.get<Statement>(`/shop/customers/${customerId}/statement?from=${from}&to=${to}`) });
  const s = q.data;
  const csv = () => {
    if (!s) return;
    const rows = [
      { date: s.from, ref: '', label: 'Opening balance', debit: '', credit: '', balance: s.openingBalance.toFixed(2) },
      ...s.entries.map((e) => ({ date: e.date, ref: e.ref, label: e.label, debit: e.debit ? e.debit.toFixed(2) : '', credit: e.credit ? e.credit.toFixed(2) : '', balance: e.balance.toFixed(2) })),
      { date: s.to, ref: '', label: 'Closing balance', debit: s.totals.debit.toFixed(2), credit: s.totals.credit.toFixed(2), balance: s.closingBalance.toFixed(2) },
    ];
    const cols = [{ key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'label', label: 'Details' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'balance', label: 'Balance' }];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(rows, cols)], { type: 'text/csv' }));
    a.download = `statement-${(s.customer.companyName || s.customer.name).replace(/\W+/g, '-')}-${s.from}-${s.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 150 }} />
        <span className="muted">to</span>
        <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 150 }} />
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Download CSV" onClick={csv} disabled={!s}><Download size={16} /></button>
        <button className="icon-btn" title="Print statement" onClick={() => window.print()} disabled={!s}><Printer size={16} /></button>
      </div>
      {q.isLoading ? <div className="skeleton" style={{ height: 220 }} /> : q.isError ? (
        <div className="error-state">Couldn’t load the statement. <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div>
      ) : s && (
        <div className="print-area statement">
          <div className="only-print" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>Statement of account</h2>
            <div>{s.customer.companyName || s.customer.name}{s.customer.gstin ? ` · GSTIN ${s.customer.gstin}` : ''}</div>
            <div>{fmtDate(s.from)} – {fmtDate(s.to)}</div>
          </div>
          <div className="ageing" aria-label="Ageing of open invoices">
            {([['Current', s.ageing.current], ['1–30', s.ageing.d1_30], ['31–60', s.ageing.d31_60], ['61–90', s.ageing.d61_90], ['90+', s.ageing.d90_plus]] as const).map(([k, v]) => (
              <div key={k}><div className="k">{k} days</div><div className="v">{num2(v)}</div></div>
            ))}
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Date</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr><td className="muted">{fmtDate(s.from)}</td><td className="muted">Opening balance</td><td /><td /><td className="num strong">{num2(s.openingBalance)}</td></tr>
              {s.entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.date)}</td>
                  <td><Link to={`/app/sales/invoices/${e.refId}`}>{e.ref}</Link><div className="small muted">{e.label}</div></td>
                  <td className="num">{e.debit ? num2(e.debit) : ''}</td>
                  <td className="num">{e.credit ? num2(e.credit) : ''}</td>
                  <td className="num">{num2(e.balance)}</td>
                </tr>
              ))}
              {s.entries.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>No transactions in this period.</td></tr>}
            </tbody>
            <tfoot>
              <tr><td /><td className="strong">Closing balance</td><td className="num">{num2(s.totals.debit)}</td><td className="num">{num2(s.totals.credit)}</td><td className="num strong">{money(s.closingBalance)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function ActivityView({ customerId, canWrite }: { customerId: string; canWrite: boolean }) {
  const q = useQuery({ queryKey: ['customerActivity', customerId], queryFn: () => api.get<Activity[]>(`/shop/customers/${customerId}/activity`) });
  const [kind, setKind] = useState<'note' | 'call' | 'email' | 'meeting' | 'whatsapp'>('call');
  const [body, setBody] = useState('');
  const add = useMut((b: { kind: string; body: string }) => api.post(`/shop/customers/${customerId}/activity`, b), [['customerActivity', customerId]], { success: 'Added to history' });
  const del = useMut((id: string) => api.del(`/shop/customers/${customerId}/activity/${id}`), [['customerActivity', customerId]], {});
  return (
    <div className="stack" style={{ gap: 12 }}>
      {canWrite && (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate({ kind, body }, { onSuccess: () => setBody('') }); }}>
          <div className="segmented" role="radiogroup" aria-label="Type">
            {(['call', 'whatsapp', 'email', 'meeting', 'note'] as const).map((k) => <button type="button" key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'whatsapp' ? 'WhatsApp' : k[0]!.toUpperCase() + k.slice(1)}</button>)}
          </div>
          <textarea className="textarea" rows={2} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="Spoke to accounts, payment promised by Friday." aria-label="Note" />
          <div><button className="btn btn-primary btn-sm" disabled={!body.trim() || add.isPending}>{add.isPending && <Loader2 size={14} className="spin" />} Add to history</button></div>
        </form>
      )}
      {q.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : q.isError ? (
        <div className="error-state">Couldn’t load history. <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div>
      ) : !q.data?.length ? (
        <EmptyState icon={StickyNote} title="No history yet" text="Calls, notes, invoices and payments for this customer show up here." />
      ) : (
        <ul className="activity">
          {q.data.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? StickyNote;
            return (
              <li key={a.id}>
                <span className={`ic ${a.manual ? 'manual' : ''}`}><Icon size={14} /></span>
                <div>
                  <div style={{ whiteSpace: 'pre-line' }}>{a.refId ? <Link to={`/app/sales/invoices/${a.refId}`}>{a.body}</Link> : a.body}</div>
                  <div className="small muted">{new Date(a.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{a.by ? ` · ${a.by}` : ''}</div>
                </div>
                {a.manual && canWrite ? <button className="icon-btn sm" aria-label="Delete note" onClick={() => del.mutate(a.id)}><Trash2 size={13} /></button> : <span />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
