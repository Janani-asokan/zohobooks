import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Camera, Loader2, Sparkles, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui';
import { ACCEPT_UPLOADS, fileToDataUrl } from '@/lib/files';
import type { ExtractKind, ExtractResult } from '../../shared/extract';

/** One value read from the document that can be applied to the form. */
export interface FillRow { key: string; label: string; value: string | number | null | undefined; display?: string; current?: string | number | null }
export interface PendingFile { file: File; dataUrl: string }

interface Props {
  kind: ExtractKind;
  /** Turn the extraction into form rows; rows without a value are hidden. */
  toRows: (r: ExtractResult) => FillRow[];
  /** Apply the rows the user kept. `file` is the upload, for attaching to the record or using as a picture. */
  onApply: (keys: Set<string>, r: ExtractResult, file: PendingFile) => void;
  title?: string;
  hint?: string;
  /** Extra content under the field list in the review step (e.g. matched line items). */
  extra?: (r: ExtractResult) => React.ReactNode;
}

const METHOD_LABEL: Record<ExtractResult['method'], string> = { ai: 'Read by the smart reader', 'pdf-text': 'Read from the PDF text', ocr: 'Read from the photo (OCR)' };

/** "Fill from a PDF or photo": drop, pick, paste or photograph a document, review what was read, apply it to the form. */
export function SmartUpload({ kind, toRows, onApply, title = 'Fill from a PDF or photo', hint = 'Drop a file here, paste a screenshot, or pick one. We read the details and fill the form; you check them first.', extra }: Props) {
  const toast = useToast();
  const status = useQuery({ queryKey: ['extractStatus'], queryFn: () => api.get<{ ai: boolean }>('/shop/extract/status'), staleTime: 10 * 60_000 });
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [review, setReview] = useState<{ r: ExtractResult; file: PendingFile; rows: FillRow[]; keep: Set<string>; preview: string | null } | null>(null);

  const run = async (file: File) => {
    setBusy(file.name);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await api.post<ExtractResult>('/shop/extract', { kind, file: dataUrl, filename: file.name });
      const rows = toRows(r).filter((x) => x.value !== null && x.value !== undefined && x.value !== '');
      setReview({ r, file: { file, dataUrl }, rows, keep: new Set(rows.filter((x) => String(x.current ?? '') !== String(x.value)).map((x) => x.key)), preview: file.type.startsWith('image/') ? dataUrl : null });
    } catch (e) {
      toast('error', 'Couldn’t read that file', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const take = (files: FileList | null | undefined) => { const f = files?.[0]; if (f) void run(f); };

  // Paste a screenshot anywhere on the page while this control is mounted (and no other dialog is open).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy || review || document.querySelector('.modal')) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => ACCEPT_UPLOADS.split(',').includes(x.type));
      if (f) { e.preventDefault(); void run(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const apply = () => {
    if (!review) return;
    onApply(review.keep, review.r, review.file);
    if (review.keep.size) toast('success', `${review.keep.size} field${review.keep.size === 1 ? '' : 's'} filled`, 'Check them before saving.');
    setReview(null);
  };
  const toggle = (k: string) => setReview((v) => v && { ...v, keep: new Set(v.keep.has(k) ? [...v.keep].filter((x) => x !== k) : [...v.keep, k]) });

  return (
    <>
      <div
        className={`smart-upload ${drag ? 'drag' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
      >
        <span className="su-icon">{busy ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}</span>
        <div className="su-text">
          <strong>{busy ? `Reading ${busy}…` : title}</strong>
          <span>{busy ? 'This takes a few seconds.' : hint}</span>
        </div>
        <div className="su-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => pickRef.current?.click()}><FileUp size={14} /> Upload</button>
          <button type="button" className="btn btn-ghost btn-sm su-camera" disabled={!!busy} onClick={() => camRef.current?.click()}><Camera size={14} /> Photo</button>
        </div>
        <input ref={pickRef} type="file" accept={ACCEPT_UPLOADS} hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      </div>
      {status.data && !status.data.ai && <div className="su-note">Basic reader: works best on PDFs with selectable text and clear photos. Add an Anthropic API key on the server for the smart reader.</div>}

      <Modal open={!!review} onClose={() => setReview(null)} size="lg" title="Check what we read" subtitle={review ? `${review.file.file.name} · ${METHOD_LABEL[review.r.method]}` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setReview(null)}>Cancel</button><button className="btn btn-primary" disabled={!review?.keep.size && !review?.r.data.lines.length} onClick={apply}><CheckCircle2 size={15} /> Fill the form</button></>}>
        {review && (
          <div className="su-review">
            {review.preview ? <img className="su-preview" src={review.preview} alt="Uploaded file" /> : <div className="su-preview su-pdf"><FileText size={28} /><span>{review.file.file.name}</span></div>}
            <div className="stack" style={{ gap: 12, minWidth: 0 }}>
              {review.r.warnings.map((w) => <div key={w} className="hint-inline"><AlertTriangle size={14} /> {w}</div>)}
              {review.r.method !== 'ai' && <div className="small muted">Confidence: {Math.round(review.r.confidence * 100)}%. Untick anything that looks wrong.</div>}
              {review.rows.length === 0 ? (review.r.data.lines.length && extra ? null : <p className="muted">We couldn’t find form details in this file.{review.preview && kind === 'item' ? ' You can still use it as the product picture.' : ''}</p>) : (
                <table className="table su-table">
                  <thead><tr><th style={{ width: 32 }} /><th>Field</th><th>Found</th><th>Now in the form</th></tr></thead>
                  <tbody>
                    {review.rows.map((x) => (
                      <tr key={x.key} className="row-click" onClick={() => toggle(x.key)}>
                        <td><input type="checkbox" className="checkbox" checked={review.keep.has(x.key)} onChange={() => toggle(x.key)} onClick={(e) => e.stopPropagation()} aria-label={`Use ${x.label}`} /></td>
                        <td className="muted">{x.label}</td>
                        <td className="strong" style={{ whiteSpace: 'pre-line' }}>{x.display ?? String(x.value)}</td>
                        <td className="muted">{x.current === null || x.current === undefined || x.current === '' ? '—' : String(x.current)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {extra?.(review.r)}
              {review.r.textPreview && (
                <details className="small"><summary className="muted">Text we read</summary><pre className="su-raw">{review.r.textPreview}</pre></details>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
