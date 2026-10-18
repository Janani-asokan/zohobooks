import { useRef, useState } from 'react';
import { FileUp, Loader2, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { Modal } from './ui';

interface Result { created: number; updated: number; errors: Array<{ row: number; error: string }> }

/** CSV import dialog (Excel → "Save as CSV"). Shows per-row errors without losing the good rows. */
export function CsvImport({ open, onClose, endpoint, title, template, invalidate }: { open: boolean; onClose: () => void; endpoint: string; title: string; template: string; invalidate: string[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => { setFile(null); setResult(null); setError(''); };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const csv = await file.text();
      const r = await api.post<Result>(endpoint, { csv });
      setResult(r);
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(template)}`;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={title} subtitle="Upload a CSV file. From Excel or Google Sheets use File → Save as / Download → CSV."
      footer={result ? <button className="btn btn-primary" onClick={() => { reset(); onClose(); }}>Done</button> : (
        <><button className="btn btn-secondary" onClick={() => { reset(); onClose(); }}>Cancel</button><button className="btn btn-primary" disabled={!file || busy} onClick={run}>{busy && <Loader2 size={15} className="spin" />} Import</button></>
      )}>
      {result ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, color: 'var(--green-700)', fontWeight: 600 }}><CheckCircle2 size={18} /> {result.created} created{result.updated ? `, ${result.updated} updated` : ''}</div>
          {result.errors.length > 0 && (
            <div>
              <div className="row small" style={{ gap: 6, color: 'var(--amber-700)', fontWeight: 600, marginBottom: 6 }}><AlertTriangle size={15} /> {result.errors.length} row{result.errors.length > 1 ? 's' : ''} skipped</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {result.errors.map((e) => <div key={e.row} className="small" style={{ padding: '6px 10px', borderBottom: '1px solid var(--ink-150)' }}>Row {e.row}: {e.error}</div>)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ border: '2px dashed var(--border-strong)', borderRadius: 8, padding: 28, background: 'var(--ink-50)', cursor: 'pointer', color: 'var(--ink-700)' }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null); }}>
            <FileUp size={26} style={{ color: 'var(--brand-600)' }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>{file ? file.name : 'Choose a CSV file or drop it here'}</div>
            {file && <div className="small muted">{Math.round(file.size / 1024)} KB</div>}
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <a href={templateHref} download="template.csv" className="row small" style={{ gap: 6 }}><Download size={14} /> Download a sample template</a>
          {error && <div className="field-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
