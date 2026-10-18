import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { api } from '@/api/client';
import { fmtDate, money, num2, todayISO } from '@/lib/format';
import { toCsv } from '../../shared/csv';

export interface Statement {
  customer?: { gstin: string }; vendor?: { gstin: string };
  from: string; to: string; openingBalance: number; closingBalance: number;
  entries: Array<{ date: string; type: string; refId: string; ref: string; label: string; debit: number; credit: number; balance: number }>;
  totals: { debit: number; credit: number };
  ageing: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}
const fyStart = () => { const t = todayISO(); const y = Number(t.slice(0, 4)) - (t.slice(5, 7) < '04' ? 1 : 0); return `${y}-04-01`; };

/** Statement of account for a customer or vendor: opening balance, every document and payment, running balance, ageing. */
export function PartyStatement({ url, name, debitLabel, creditLabel, linkFor }: { url: string; name: string; debitLabel: string; creditLabel: string; linkFor: (e: Statement['entries'][number]) => string }) {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayISO());
  const q = useQuery({ queryKey: ['statement', url, from, to], queryFn: () => api.get<Statement>(`${url}?from=${from}&to=${to}`) });
  const s = q.data && { ...q.data, party: q.data.customer ?? q.data.vendor ?? { gstin: '' } };
  const csv = () => {
    if (!s) return;
    const rows = [
      { date: s.from, ref: '', label: 'Opening balance', debit: '', credit: '', balance: s.openingBalance.toFixed(2) },
      ...s.entries.map((e) => ({ date: e.date, ref: e.ref, label: e.label, debit: e.debit ? e.debit.toFixed(2) : '', credit: e.credit ? e.credit.toFixed(2) : '', balance: e.balance.toFixed(2) })),
      { date: s.to, ref: '', label: 'Closing balance', debit: s.totals.debit.toFixed(2), credit: s.totals.credit.toFixed(2), balance: s.closingBalance.toFixed(2) },
    ];
    const cols = [{ key: 'date', label: 'Date' }, { key: 'ref', label: 'Reference' }, { key: 'label', label: 'Details' }, { key: 'debit', label: debitLabel }, { key: 'credit', label: creditLabel }, { key: 'balance', label: 'Balance' }];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(rows, cols)], { type: 'text/csv' }));
    a.download = `statement-${name.replace(/\W+/g, '-')}-${s.from}-${s.to}.csv`;
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
            <div>{name}{s.party.gstin ? ` · GSTIN ${s.party.gstin}` : ''}</div>
            <div>{fmtDate(s.from)} – {fmtDate(s.to)}</div>
          </div>
          <div className="ageing" aria-label="Ageing of open invoices">
            {([['Not due', s.ageing.current], ['1–30', s.ageing.d1_30], ['31–60', s.ageing.d31_60], ['61–90', s.ageing.d61_90], ['90+', s.ageing.d90_plus]] as const).map(([k, v]) => (
              <div key={k}><div className="k">{k === 'Not due' ? k : `${k} days`}</div><div className="v">{num2(v)}</div></div>
            ))}
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Date</th><th>Details</th><th className="num">{debitLabel}</th><th className="num">{creditLabel}</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr><td className="muted">{fmtDate(s.from)}</td><td className="muted">Opening balance</td><td /><td /><td className="num strong">{num2(s.openingBalance)}</td></tr>
              {s.entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.date)}</td>
                  <td><Link to={linkFor(e)}>{e.ref}</Link><div className="small muted">{e.label}</div></td>
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

