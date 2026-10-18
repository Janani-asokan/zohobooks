import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, FileText, Pencil, Phone, Mail, MapPin, StickyNote, PhoneCall, MessageCircle, Users as Meeting, Receipt, IndianRupee, Bell, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { TIER_LABEL, type Customer } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState } from '@/components/ui';
import { PartyStatement } from '@/components/PartyStatement';
import { money } from '@/lib/format';

interface Activity { id: string; at: string; kind: string; body: string; by: string; refId: string | null; manual: boolean }

const KIND_ICON: Record<string, typeof StickyNote> = { note: StickyNote, call: PhoneCall, email: Mail, meeting: Meeting, whatsapp: MessageCircle, invoice: Receipt, payment: IndianRupee, reminder: Bell };

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
        {tab === 'statement' && <PartyStatement url={`/shop/customers/${c.id}/statement`} name={c.companyName || c.name} debitLabel="Invoiced" creditLabel="Received" linkFor={(e) => `/app/sales/invoices/${e.refId}`} />}
        {tab === 'activity' && <ActivityView customerId={c.id} canWrite={me.can('customers.write')} />}
      </div>
    </aside>
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
