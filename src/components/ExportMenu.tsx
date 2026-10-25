import { useCallback, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Printer, Sheet } from 'lucide-react';
import { useClickOutside } from '@/components/useClickOutside';
import { useToast } from '@/context/ToastContext';
import { exportCsv, exportPdf, exportXlsx, type ReportTable } from '@/lib/report';

/** Export any report as PDF, Excel or CSV, or print it. `table` is built on demand from what is on screen. */
export function ExportMenu({ table, disabled }: { table: () => ReportTable | null; disabled?: boolean }) {
  const toast = useToast();
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
    try { await exportPdf(t); toast('success', `${t.title} saved as PDF`); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }} className="no-print">
      <button className="btn btn-secondary" disabled={disabled || busy} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Export <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dropdown" role="menu" style={{ minWidth: 200 }}>
          <button className="dropdown-item" role="menuitem" onClick={() => run('pdf')}><FileText size={15} /> PDF</button>
          <button className="dropdown-item" role="menuitem" onClick={() => run('xlsx')}><FileSpreadsheet size={15} /> Excel (.xlsx)</button>
          <button className="dropdown-item" role="menuitem" onClick={() => run('csv')}><Sheet size={15} /> CSV</button>
          <div className="dropdown-sep" />
          <button className="dropdown-item" role="menuitem" onClick={() => { close(); window.print(); }}><Printer size={15} /> Print</button>
        </div>
      )}
    </div>
  );
}
