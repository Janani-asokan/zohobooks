import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, FileText, Trash2, Download, Loader2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { ACCEPT_UPLOADS, fileToDataUrl, fmtBytes } from '@/lib/files';

export type AttachEntity = 'invoice' | 'bill' | 'item' | 'customer' | 'vendor' | 'expense' | 'purchase_order' | 'sales_order' | 'credit_note';
export interface Attachment { id: string; filename: string; mime: string; size: number; uploadedBy: string; createdAt: string }

const fileUrl = (id: string, download = false) => `/api/shop/attachments/${id}${download ? '?download=1' : ''}`;

/** Upload a file onto a record that already exists (used after a form saves a new record). */
export async function attachFile(entity: AttachEntity, entityId: string, filename: string, dataUrl: string) {
  return api.post<Attachment>('/shop/attachments', { entity, entityId, filename, file: dataUrl });
}

/** PDFs and photos kept on a record: drop or pick files, open, download, remove. */
export function Attachments({ entity, entityId, canWrite = true, title = 'Attachments' }: { entity: AttachEntity; entityId: string; canWrite?: boolean; title?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['attachments', entity, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Attachment[]>(`/shop/attachments?entity=${entity}&entityId=${entityId}`) });
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);

  const upload = async (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setBusy((n) => n + list.length);
    for (const f of list) {
      try { await attachFile(entity, entityId, f.name, await fileToDataUrl(f)); }
      catch (e) { toast('error', `Couldn’t attach ${f.name}`, (e as Error).message); }
      finally { setBusy((n) => n - 1); }
    }
    qc.invalidateQueries({ queryKey: key });
  };
  const remove = async (a: Attachment) => {
    try { await api.del(`/shop/attachments/${a.id}`); qc.invalidateQueries({ queryKey: key }); toast('success', 'File removed', a.filename); }
    catch (e) { toast('error', (e as Error).message); }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between"><div className="strong row" style={{ gap: 6 }}><Paperclip size={14} /> {title}</div>{q.data && q.data.length > 0 && <span className="small muted">{q.data.length}</span>}</div>
      {q.isLoading ? <div className="skeleton" style={{ height: 48 }} /> : q.isError ? (
        <div className="error-state">Couldn’t load files. <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div>
      ) : (
        <div className="attach-list">
          {q.data!.map((a) => (
            <div key={a.id} className="attach-row">
              <a href={fileUrl(a.id)} target="_blank" rel="noreferrer" aria-label={`Open ${a.filename}`}>
                {a.mime.startsWith('image/') ? <img className="attach-thumb" src={fileUrl(a.id)} alt="" loading="lazy" /> : <span className="attach-thumb"><FileText size={18} /></span>}
              </a>
              <a href={fileUrl(a.id)} target="_blank" rel="noreferrer" style={{ minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
                <div className="attach-name">{a.filename}</div>
                <div className="attach-meta">{fmtBytes(a.size)} · {new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{a.uploadedBy ? ` · ${a.uploadedBy}` : ''}</div>
              </a>
              <div className="row" style={{ gap: 2 }}>
                <a className="icon-btn sm" href={fileUrl(a.id, true)} aria-label={`Download ${a.filename}`}><Download size={14} /></a>
                {canWrite && <button className="icon-btn sm danger" onClick={() => remove(a)} aria-label={`Remove ${a.filename}`}><Trash2 size={14} /></button>}
              </div>
            </div>
          ))}
          {canWrite && (
            <button type="button" className={`attach-drop ${drag ? 'drag' : ''}`} onClick={() => pick.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}>
              {busy ? <><Loader2 size={14} className="spin" /> Uploading…</> : <><Upload size={14} /> {q.data!.length ? 'Add more files' : 'Attach a PDF or photo'}</>}
            </button>
          )}
          {!canWrite && q.data!.length === 0 && <p className="small muted">No files attached.</p>}
          <input ref={pick} type="file" accept={ACCEPT_UPLOADS} multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}
