import { useState } from 'react';
import { History, Database, IndianRupee, Loader2, HardDriveDownload } from 'lucide-react';
import { api } from '@/api/client';
import { useBackups, useMut, usePlatformAudit, usePlatformPayments } from '@/api/hooks';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const kb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
export const humanAction = (a: string) => a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function Activity() {
  const [tab, setTab] = useState<'audit' | 'payments' | 'backups'>('audit');
  const audit = usePlatformAudit();
  const payments = usePlatformPayments();
  const backups = useBackups();
  const backupNow = useMut(() => api.post<{ file: string }>('/platform/backups'), [['platform', 'backups']], { success: (r) => `Backup created: ${r.file}` });

  return (
    <div className="page">
      <PageHeader title="Activity & backups" subtitle="Platform audit trail, subscription payments and database backups. Shop-level activity stays private to each shop." />
      <div className="tabs">
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}><History size={15} /> Audit log</button>
        <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}><IndianRupee size={15} /> Subscription payments</button>
        <button className={tab === 'backups' ? 'active' : ''} onClick={() => setTab('backups')}><Database size={15} /> Backups</button>
      </div>

      {tab === 'audit' && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>
              {(audit.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                  <td className="strong">{a.actor}</td>
                  <td>{humanAction(a.action)} <span className="muted">· {a.entity}</span></td>
                  <td className="muted small" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{Object.entries(a.details).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}</td>
                  <td className="muted small">{a.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.data?.length === 0 && <EmptyState icon={History} title="No activity yet" text="Platform changes will be recorded here." />}
        </div>
      )}

      {tab === 'payments' && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Shop</th><th>Plan</th><th>Method</th><th>Reference</th><th>Status</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {(payments.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paidAt ?? p.createdAt)}</td>
                  <td className="strong">{p.shopName}</td>
                  <td>{p.planName} · {p.years}y</td>
                  <td><span className="chip">{p.method === 'razorpay' ? 'Razorpay' : 'Manual'}</span></td>
                  <td className="muted">{p.reference || '—'}</td>
                  <td><Badge tone={p.status === 'paid' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>{p.status}</Badge></td>
                  <td className="num strong">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'backups' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Database backups</h3>
              <p>{backups.data?.enabled ? `Automatic daily backups on · keeping the newest ${backups.data.keep}` : 'Automatic daily backups are off on this server (set BACKUPS_ENABLED=1).'} Files stay on the server — they contain every shop’s data, so they can’t be downloaded from this console.</p>
            </div>
            <button className="btn btn-primary" disabled={backupNow.isPending} onClick={() => backupNow.mutate(undefined)}>{backupNow.isPending ? <Loader2 size={15} className="spin" /> : <HardDriveDownload size={15} />} Back up now</button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Created</th><th className="num">Size</th></tr></thead>
              <tbody>{(backups.data?.files ?? []).map((f) => <tr key={f.name}><td className="strong" style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{f.name}</td><td>{when(f.createdAt)}</td><td className="num">{kb(f.bytes)}</td></tr>)}</tbody>
            </table>
            {backups.data?.files.length === 0 && <EmptyState icon={Database} title="No backups yet" text="Run your first backup now." />}
          </div>
        </div>
      )}
    </div>
  );
}
