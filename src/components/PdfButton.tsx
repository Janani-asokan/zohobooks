import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { useOrg } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { exportPdf, type ReportTable } from '@/lib/report';

/** Downloads one document as a PDF; falls back to the print window when the PDF service is unavailable. */
export function PdfButton({ table, label = 'PDF', className = 'btn btn-secondary btn-sm', iconOnly }: { table: () => ReportTable; label?: string; className?: string; iconOnly?: boolean }) {
  const toast = useToast();
  const business = useOrg().data?.companyName ?? '';
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const t = table();
      const how = await exportPdf(t, business);
      if (how === 'pdf') toast('success', `${t.title} downloaded`);
      else toast('info', 'Print window opened', 'Choose “Save as PDF” as the printer to keep a copy.');
    } catch (err) { toast('error', (err as Error).message); } finally { setBusy(false); }
  };
  return (
    <button type="button" className={iconOnly ? 'icon-btn' : className} disabled={busy} onClick={run} title="Download PDF" aria-label={iconOnly ? 'Download PDF' : undefined}>
      {busy ? <Loader2 size={iconOnly ? 15 : 14} className="spin" /> : <FileDown size={iconOnly ? 15 : 14} />}{!iconOnly && ` ${label}`}
    </button>
  );
}
