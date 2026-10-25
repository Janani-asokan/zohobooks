import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Attachments, type AttachEntity } from '@/components/Attachments';
import { Modal } from '@/components/ui';

/** A paperclip on a table row that opens the record's files: upload a PDF or photo, view, download or remove. */
export function AttachButton({ entity, entityId, title, canWrite = true }: { entity: AttachEntity; entityId: string; title: string; canWrite?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn" title="Files & photos" aria-label={`Files for ${title}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><Paperclip size={15} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Files · ${title}`} subtitle="Attach receipts, photos, challans or signed copies. PDF or image, up to 10 MB each."
        footer={<button className="btn btn-secondary" onClick={() => setOpen(false)}>Done</button>}>
        <Attachments entity={entity} entityId={entityId} canWrite={canWrite} title="Files" />
      </Modal>
    </>
  );
}
