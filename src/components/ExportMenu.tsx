import { useCallback, useState } from 'react';
import { ChevronDown, Copy, Download, FileSpreadsheet, FileText, Loader2, Mail, MessageCircle, Printer, Send, Sheet } from 'lucide-react';
import { api, type ApiError } from '@/api/client';
import { Field, Modal } from '@/components/ui';
import { waDigits } from '../../shared/support';
import { useClickOutside } from '@/components/useClickOutside';
import { useToast } from '@/context/ToastContext';
import { useOrg } from '@/api/hooks';
import { exportCsv, exportPdf, exportXlsx, type ReportTable } from '@/lib/report';

/** Export any report as PDF, Excel or CSV, or print it. `table` is built on demand from what is on screen. */
export function ExportMenu({ table, disabled, extra, size }: { table: () => ReportTable | null; disabled?: boolean; extra?: Array<{ label: string; onClick: () => void }>; size?: 'sm' }) {
  const toast = useToast();
  const business = useOrg().data?.companyName ?? '';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [send, setSend] = useState<{ via: 'email' | 'whatsapp'; table: ReportTable } | null>(null);
  const openSend = (via: 'email' | 'whatsapp') => { close(); const t = table(); if (t) setSend({ via, table: t }); };
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close, open);
  const run = async (kind: 'pdf' | 'xlsx' | 'csv') => {
    close();
    const t = table();
    if (!t) return;
    if (kind === 'csv') { exportCsv(t); return toast('success', `${t.title} saved as CSV`); }
    if (kind === 'xlsx') { exportXlsx(t); return toast('success', `${t.title} saved as Excel`); }
    setBusy(true);
    try {
      const how = await exportPdf(t, business);
      if (how === 'pdf') toast('success', `${t.title} saved as PDF`);
      else toast('info', 'Print window opened', 'Choose “Save as PDF” as the printer to keep a copy.');
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }} className="no-print">
      <button className={`btn btn-secondary ${size === 'sm' ? 'btn-sm' : ''}`} disabled={disabled || busy} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Export <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dropdown" role="menu" style={{ minWidth: 200 }}>
          <button className="dropdown-item" role="menuitem" onClick={() => run('pdf')}><FileText size={15} /> PDF</button>
          <button className="dropdown-item" role="menuitem" onClick={() => run('xlsx')}><FileSpreadsheet size={15} /> Excel (.xlsx)</button>
          <button className="dropdown-item" role="menuitem" onClick={() => run('csv')}><Sheet size={15} /> CSV</button>
          {extra?.map((x) => <button key={x.label} className="dropdown-item" role="menuitem" onClick={() => { close(); x.onClick(); }}><Sheet size={15} /> {x.label}</button>)}
          <div className="dropdown-sep" />
          <button className="dropdown-item" role="menuitem" onClick={() => openSend('email')}><Mail size={15} /> Email to someone</button>
          <button className="dropdown-item" role="menuitem" onClick={() => openSend('whatsapp')}><MessageCircle size={15} /> Share on WhatsApp</button>
          <div className="dropdown-sep" />
          <button className="dropdown-item" role="menuitem" onClick={() => { close(); window.print(); }}><Printer size={15} /> Print</button>
        </div>
      )}
      {send && <SendReport via={send.via} table={send.table} onClose={() => setSend(null)} />}
    </div>
  );
}

type Format = 'pdf' | 'xlsx' | 'csv';
const FORMATS: Array<[Format, string]> = [['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']];
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** The report's rows as the server builds the file from them (the same rows as the download). */
export const reportBody = (t: ReportTable) => ({
  filename: t.filename, title: t.title, subtitle: t.subtitle, note: t.note ?? '', landscape: !!t.landscape,
  columns: t.columns.map((c) => ({ label: c.label, align: c.align, money: c.money })),
  rows: t.rows.map((r) => ({ cells: r.cells, kind: r.kind ?? 'row' })),
});

/**
 * Email a report as a PDF, Excel or CSV attachment, or share it on WhatsApp. WhatsApp can't carry a file from a
 * link, so the file is kept for 7 days behind a private link and WhatsApp opens with that link written.
 */
export function SendReport({ via, table, onClose }: { via: 'email' | 'whatsapp'; table: ReportTable; onClose: () => void }) {
  const toast = useToast();
  const [format, setFormat] = useState<Format>('pdf');
  const [f, setF] = useState({ to: '', cc: '', message: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; text: string } | null>(null);
  const ok = via === 'email' ? isEmail(f.to) && (!f.cc || isEmail(f.cc)) : true;
  const go = async () => {
    setBusy(true);
    try {
      if (via === 'email') {
        const r = await api.post<{ status: string; detail: string }>('/shop/reports/share', { ...reportBody(table), format, via: 'email', to: f.to, cc: f.cc, message: f.message });
        toast(r.status === 'sent' ? 'success' : 'info', r.status === 'sent' ? 'Report emailed' : 'Email not sent', r.detail);
        if (r.status === 'sent') onClose();
      } else {
        setLink(await api.post<{ url: string; text: string }>('/shop/reports/share', { ...reportBody(table), format, via: 'link' }));
      }
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const digits = waDigits(f.phone);
  const wa = link ? `https://wa.me/${digits}?text=${encodeURIComponent((f.message ? `${f.message}\n\n` : '') + link.text)}` : '';
  return (
    <Modal open onClose={onClose} title={via === 'email' ? 'Email this report' : 'Share on WhatsApp'} subtitle={`${table.title}${table.subtitle ? ` · ${table.subtitle}` : ''}`}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        {link ? <a className="btn btn-whatsapp" href={wa} target="_blank" rel="noreferrer" onClick={onClose}><MessageCircle size={15} /> Open WhatsApp</a>
          : <button className="btn btn-primary" disabled={!ok || busy} onClick={go}>{busy ? <Loader2 size={15} className="spin" /> : via === 'email' ? <Send size={15} /> : <MessageCircle size={15} />} {via === 'email' ? 'Send email' : 'Make the link'}</button>}
      </>}>
      <Field label="Send as">
        <div className="segmented" role="radiogroup" aria-label="File type">
          {FORMATS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={format === k} className={format === k ? 'active' : ''} disabled={!!link} onClick={() => setFormat(k)}>{l}</button>)}
        </div>
      </Field>
      {via === 'email' ? (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="To" required className="span-all"><input className="input" type="email" autoFocus value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="accountant@example.com" /></Field>
          <Field label="Cc" className="span-all"><input className="input" type="email" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></Field>
          <Field label="Message (optional)" className="span-all"><textarea className="textarea" rows={3} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Hi, here is this month’s report." /></Field>
        </div>
      ) : (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="WhatsApp number (optional)" hint="Leave empty to pick the contact in WhatsApp" className="span-all"><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98400 12345" /></Field>
          <Field label="Message (optional)" className="span-all"><textarea className="textarea" rows={2} maxLength={1000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          {link ? (
            <div className="span-all small" role="status">
              The file is ready behind a private link that works for 7 days. <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => toast('success', 'Link copied')); }}><Copy size={14} /> Copy link</button>
            </div>
          ) : <p className="span-all small muted" style={{ margin: 0 }}>WhatsApp can’t attach a file from here, so we make a private link to the file (it works for 7 days) and WhatsApp opens with it written.</p>}
        </div>
      )}
    </Modal>
  );
}
