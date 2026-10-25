import { Fragment, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import type { AuditPage } from '@/api/types';
import { EmptyState, PageHeader, SearchInput } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';

const humanAction = (a: string) => a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const humanEntity = (e: string) => e.replace(/_/g, ' ');
const when = (at: string) => new Date(at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const detailText = (d: Record<string, unknown>) =>
  Object.entries(d).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');

/** Every change in the organisation: who did what, to which record, when and from where. */
export default function AuditLog() {
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const params = useMemo(() => new URLSearchParams(Object.entries({ q, entity, actor, from, to }).filter(([, v]) => v)).toString(), [q, entity, actor, from, to]);
  const log = useInfiniteQuery({
    queryKey: ['audit', params],
    queryFn: ({ pageParam }) => api.get<AuditPage>(`/shop/audit?limit=50&${params}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];
  const facets = log.data?.pages[0]?.facets;
  const filtered = !!(q || entity || actor || from || to);

  return (
    <div className="page">
      <PageHeader title="Audit log" crumbs={<>Settings <span>/</span> Audit log</>} subtitle="Every change in this organisation: who made it, what changed and when. Entries can’t be edited or deleted."
        actions={<ExportMenu disabled={!rows.length} table={() => ({
          title: 'Audit log', subtitle: `${rows.length} entries${filtered ? ' (filtered)' : ''}`, filename: 'audit-log', landscape: true,
          columns: [{ label: 'When' }, { label: 'Who' }, { label: 'Action' }, { label: 'Record' }, { label: 'Details' }, { label: 'IP' }],
          rows: rows.map((r) => ({ cells: [when(r.at), r.actor, humanAction(r.action), `${humanEntity(r.entity)}${r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}`, detailText(r.details), r.ip] })),
        })} />} />
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left" style={{ flexWrap: 'wrap' }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search actions, records, details…" />
            <select className="select" style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Record type">
              <option value="">All records</option>{facets?.entities.map((f) => <option key={f.value} value={f.value}>{humanEntity(f.value)} ({f.count})</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="User">
              <option value="">Everyone</option>{facets?.actors.map((f) => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}
            </select>
            <input className="input" style={{ width: 'auto' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input className="input" style={{ width: 'auto' }} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            {filtered && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setEntity(''); setActor(''); setFrom(''); setTo(''); }}>Clear</button>}
          </div>
        </div>
        <div className="table-wrap">
          {log.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 320 }} /></div> : log.isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load the audit log. <button className="btn btn-ghost btn-sm" onClick={() => log.refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={History} title={filtered ? 'Nothing matches these filters' : 'No activity yet'} text={filtered ? 'Try a wider date range or clear the filters.' : 'Every change in your organisation is recorded here.'} />
          ) : (
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="muted">{open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                      <td className="strong">{r.actor}</td>
                      <td>{humanAction(r.action)}</td>
                      <td className="muted">{humanEntity(r.entity)}{r.entityId && <span className="mono small"> · {r.entityId.length > 12 ? r.entityId.slice(0, 8) : r.entityId}</span>}</td>
                      <td className="muted small" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailText(r.details) || '—'}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="audit-detail">
                        <td />
                        <td colSpan={5}>
                          <dl className="audit-dl">
                            <dt>Record ID</dt><dd className="mono">{r.entityId || '—'}</dd>
                            <dt>IP address</dt><dd className="mono">{r.ip || '—'}</dd>
                            {Object.entries(r.details).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></Fragment>)}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {log.hasNextPage && (
          <div style={{ padding: 12, textAlign: 'center', borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-secondary btn-sm" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>{log.isFetchingNextPage && <Loader2 size={14} className="spin" />} Load older entries</button>
          </div>
        )}
      </div>
    </div>
  );
}
