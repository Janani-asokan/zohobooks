import { useCallback, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Printer, Sheet } from 'lucide-react';
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
          <button className="dropdown-item" role="menuitem" onClick={() => { close(); window.print(); }}><Printer size={15} /> Print</button>
        </div>
      )}
    </div>
  );
}
