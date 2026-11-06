import { useQueryClient } from '@tanstack/react-query';
import { Download, History, Loader2, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { toCsv } from '../../../../shared/csv';
import { LABEL_KEYS, newKey, useLabelJobs, type JobRow } from '@/components/labels/labelsApi';

const STATUS: Record<JobRow['status'], { label: string; tone: string }> = {
  ready: { label: 'Not sent', tone: 'gray' }, sending: { label: 'Sending', tone: 'blue' }, sent: { label: 'Sent, not confirmed', tone: 'amber' },
  printed: { label: 'Printed', tone: 'green' }, partial: { label: 'Stopped part-way', tone: 'amber' }, failed: { label: 'Failed', tone: 'red' },
};

/** History (spec 2.1, BP-12, BP-13): every job with who, when, from what, template version and printer; resume and reprint. */
export default function HistoryTab({ onOpen }: { onOpen: (job: JobRow) => void }) {
  const jobs = useLabelJobs();
  const toast = useToast();
  const qc = useQueryClient();
  const open = async (id: string, resume: boolean) => {
    const j = await api.get<JobRow>(`/shop/label/jobs/${id}`);
    onOpen(resume ? { ...j, options: { ...j.options, from: Math.max(1, j.printed + 1) } } : { ...j, options: { ...j.options, from: 1 } });
  };
  const reprint = async (id: string, fresh: boolean) => {
    try {
      const j = await api.post<JobRow>(`/shop/label/jobs/${id}/reprint`, { idemKey: newKey(), fresh });
      qc.invalidateQueries({ queryKey: LABEL_KEYS.jobs });
      onOpen(j);
      toast('success', fresh ? 'Reprint with today’s names and prices' : 'Reprint exactly as before', 'Check it in the Workbench, then print.');
    } catch (e) { toast('error', 'Could not reprint', (e as Error).message); }
  };
  const exportCsv = () => {
    const rows = (jobs.data ?? []).map((j) => ({ when: j.createdAt, by: j.createdBy ?? '', source: j.source.label || j.source.type, template: j.templateName ? `${j.templateName} v${j.templateVersion}` : 'Auto layout', stock: `${j.stock.w}x${j.stock.h} ${j.stock.across}-up`, printer: j.printerName ?? j.printer.language, labels: j.total, sent: j.sent, printed: j.printed, status: STATUS[j.status].label }));
    const cols = Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k[0]!.toUpperCase() + k.slice(1) }));
    const blob = new Blob([toCsv(rows, cols)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'label-print-jobs.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="card ls-panel" aria-label="Print history">
      <div className="row between"><h3 className="row" style={{ gap: 6 }}><History size={16} /> Print jobs</h3>{!!jobs.data?.length && <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Download size={14} /> Export audit log</button>}</div>
      {jobs.isLoading ? <Loader2 className="spin" size={18} /> : !jobs.data?.length ? <p className="muted small">No print jobs yet. Jobs appear here when you print from the Workbench.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>From</th><th>Template · stock · printer</th><th className="num">Labels</th><th>Status</th><th /></tr></thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.id}>
                  <td className="small">{new Date(j.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<div className="muted">{j.createdBy}</div></td>
                  <td className="small">{j.source.label || j.source.type}</td>
                  <td className="small">{j.templateName ? `${j.templateName} v${j.templateVersion}` : 'Auto layout'}<div className="muted">{j.stock.w} × {j.stock.h} mm · {j.stock.across} across · {j.printerName ?? j.printer.language.toUpperCase()}</div></td>
                  <td className="num">{j.printed < j.total && j.printed > 0 ? `${j.printed} / ${j.total}` : j.total}</td>
                  <td><span className={`badge ${STATUS[j.status].tone}`}>{STATUS[j.status].label}</span></td>
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {(j.status === 'partial' || j.status === 'sent' || j.status === 'failed') && j.printed < j.total && <button className="btn btn-soft btn-sm" onClick={() => void open(j.id, true)} title={`Continue from label ${j.printed + 1}`}><Play size={13} /> Resume{j.printed ? ` from ${j.printed + 1}` : ''}</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => void reprint(j.id, false)} title="Same names and prices as printed"><RotateCcw size={13} /> Reprint</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => void reprint(j.id, true)} title="Today’s names and prices"><RefreshCw size={13} /> With today’s data</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
