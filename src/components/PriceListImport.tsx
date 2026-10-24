import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useItems, useTaxSlabs } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui';
import { SmartUpload } from '@/components/SmartUpload';
import { createItemFrom } from '@/lib/autoCreate';
import { matchItem } from '@/lib/match';
import { money } from '@/lib/format';
import type { ExtractResult } from '../../shared/extract';

/** Turn a supplier price list or catalogue (PDF or photo) into catalogue items in one go. */
export function PriceListImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useItems().data ?? [];
  const slabs = useTaxSlabs().data ?? [];
  const toast = useToast();
  const qc = useQueryClient();
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const lines = (r: ExtractResult) => r.data.lines.filter((l) => l.name).map((l, i) => ({ i, l, existing: matchItem(items, l) }));
  const extra = (r: ExtractResult) => {
    const rows = lines(r);
    if (!rows.length) return <p className="muted">No product lines found. A price list with one product per row works best.</p>;
    return (
      <table className="table">
        <thead><tr><th style={{ width: 32 }} /><th>Product</th><th>HSN</th><th className="num">Price</th><th className="num">GST</th><th>Status</th></tr></thead>
        <tbody>{rows.map(({ i, l, existing }) => (
          <tr key={i}>
            <td><input type="checkbox" className="checkbox" disabled={!!existing} checked={!existing && !skip.has(i)} onChange={() => setSkip((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} aria-label={`Import ${l.name}`} /></td>
            <td>{l.name}{(l.brand || l.sku) && <div className="muted">{[l.brand, l.sku].filter(Boolean).join(' · ')}</div>}</td>
            <td>{l.hsn ?? '—'}</td>
            <td className="num">{l.sellingPrice ?? l.rate ?? l.mrp ? money((l.sellingPrice ?? l.rate ?? l.mrp)!) : '—'}</td>
            <td className="num">{l.taxRate != null ? `${l.taxRate}%` : '—'}</td>
            <td>{existing ? <span className="muted">Already in catalogue</span> : 'New'}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  };
  const apply = async (_k: Set<string>, r: ExtractResult) => {
    const todo = lines(r).filter((x) => !x.existing && !skip.has(x.i));
    setBusy(true);
    let ok = 0;
    for (const { l } of todo) {
      try { await createItemFrom({ ...l, sellingPrice: l.sellingPrice ?? l.rate ?? l.mrp }, slabs, false); ok++; } catch { /* counted below */ }
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ['items'] });
    toast(ok === todo.length ? 'success' : 'info', `${ok} item${ok === 1 ? '' : 's'} added`, ok < todo.length ? `${todo.length - ok} couldn’t be added (missing name or price). Add them by hand.` : 'Open each one to add cost price and stock.');
    setSkip(new Set());
    if (ok) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Import from a price list" subtitle="Upload a supplier price list, catalogue or rate card as a PDF or photo. You pick which products to add.">
      {busy ? <div className="row muted" style={{ gap: 8, padding: 24 }}><Loader2 size={16} className="spin" /> Adding items…</div> : (
        <SmartUpload kind="items" toRows={() => []} onApply={(k, r) => void apply(k, r)} extra={extra} title="Upload the price list" hint="One product per row works best. Products already in your catalogue are skipped." />
      )}
    </Modal>
  );
}
