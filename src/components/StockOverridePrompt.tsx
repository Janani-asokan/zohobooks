import { useState } from 'react';
import { PackageX } from 'lucide-react';
import { Field, Modal } from '@/components/ui';

export interface StockBlock {
  message: string;
  details: { items?: Array<{ itemId: string; name: string; unit: string; need: number; have: number }>; branch?: string; canOverride?: boolean };
}

/**
 * Shown when a bill needs more than the branch holds. The owner can sell anyway with a reason (kept in the audit
 * trail; the branch's stock goes negative until the purchase or transfer is recorded). Others see what is short.
 */
export function StockOverridePrompt({ block, onClose, onOverride }: { block: StockBlock; onClose: () => void; onOverride: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const d = block.details ?? {};
  const ok = reason.trim().length >= 10;
  return (
    <Modal open title={`Not enough stock at ${d.branch ?? 'this branch'}`} onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Back to the bill</button>
        {d.canOverride && <button className="btn btn-danger" disabled={!ok} onClick={() => onOverride(reason.trim())}>Sell anyway</button>}
      </>}>
      <div className="stack" style={{ gap: 12 }}>
        <table className="table">
          <thead><tr><th>Item</th><th className="num">In stock here</th><th className="num">On the bill</th></tr></thead>
          <tbody>{(d.items ?? []).map((x) => <tr key={x.itemId}><td className="strong">{x.name}</td><td className="num">{x.have} {x.unit}</td><td className="num" style={{ color: 'var(--red-600)', fontWeight: 600 }}>{x.need} {x.unit}</td></tr>)}</tbody>
        </table>
        {d.canOverride ? (
          <Field label="Why can this be sold without the stock? (kept in the audit trail)" hint="At least 10 characters, e.g. “Purchase bill from Redington not entered yet”">
            <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        ) : (
          <p className="small muted" style={{ margin: 0 }}><PackageX size={14} style={{ verticalAlign: -2 }} /> Record the purchase, or transfer the stock to this branch, then bill again. Only the owner can sell beyond the stock.</p>
        )}
        {d.canOverride && <p className="small muted" style={{ margin: 0 }}>The branch’s stock will go below zero until the purchase or transfer is recorded.</p>}
      </div>
    </Modal>
  );
}
