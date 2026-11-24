import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BellRing, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { playChime } from '@/lib/chime';

export interface LeadSummary {
  new: number; overdue: number; recipients: string[]; emailIssue: string;
  latest: Array<{ id: string; name: string; business: string; phone: string; createdAt: string }>;
}
const SEEN = 'c360.sa.leadSeen';
const seenAt = () => { try { return localStorage.getItem(SEEN) ?? ''; } catch { return ''; } };
const markSeen = (t: string) => { try { localStorage.setItem(SEEN, t); } catch { /* private mode */ } };

export const useLeadSummary = () => useQuery({ queryKey: ['platform', 'support', 'leads', 'summary'], queryFn: () => api.get<LeadSummary>('/platform/support/leads/summary'), refetchInterval: 30_000, refetchIntervalInBackground: true });

/**
 * Super admin top bar: new sales leads can't go unnoticed. A pill with the count (red when someone has waited over
 * 2 hours), and when a new one arrives a chime, a toast and, if allowed, a browser notification, even in another tab.
 */
export function LeadAlert() {
  const q = useLeadSummary();
  const toast = useToast();
  const first = useRef(true);
  const d = q.data;
  useEffect(() => {
    if (!d) return;
    const newest = d.latest[0]?.createdAt ?? '';
    const prev = seenAt();
    if (first.current) { first.current = false; if (!prev && newest) { markSeen(newest); return; } }
    if (!newest || newest <= prev) return;
    const fresh = d.latest.filter((l) => l.createdAt > prev);
    markSeen(newest);
    const l = fresh[0]!;
    const title = fresh.length > 1 ? `${fresh.length} new sales leads` : `New sales lead: ${l.business || l.name}`;
    const body = fresh.length > 1 ? fresh.map((x) => x.business || x.name).join(', ') : `${l.name}${l.phone ? ` · ${l.phone}` : ''} asked us to call`;
    playChime();
    toast('info', title, body);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification(title, { body, tag: 'c360-lead' }); n.onclick = () => { window.focus(); window.location.assign('/super-admin/support?view=leads'); }; } catch { /* */ }
    }
  }, [d, toast]);
  if (!d) return null;
  const askPermission = 'Notification' in window && Notification.permission === 'default';
  return (
    <>
      {askPermission && (
        <button type="button" className="btn btn-ghost btn-sm desktop-only" onClick={() => void Notification.requestPermission()} title="Get a pop-up on this computer when a new sales lead comes in">
          <BellRing size={15} /> Turn on lead alerts
        </button>
      )}
      {d.new > 0 && (
        <Link to="/super-admin/support?view=leads" className={`lead-pill ${d.overdue ? 'late' : ''}`}
          title={`${d.new} lead${d.new === 1 ? '' : 's'} waiting for a call${d.overdue ? ` · ${d.overdue} for over 2 hours` : ''}${d.emailIssue ? `\n${d.emailIssue}` : ''}`}>
          <Sparkles size={14} /> {d.new} new lead{d.new === 1 ? '' : 's'}
        </Link>
      )}
    </>
  );
}
