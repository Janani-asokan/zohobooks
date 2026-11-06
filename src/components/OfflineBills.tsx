import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, CloudUpload, AlertTriangle, CheckCircle2, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SALES_KEYS } from '@/api/hooks';
import { api } from '@/api/client';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useOnline } from '@/components/useOnline';
import { IS_APP } from '@/lib/platform';
import { registerDevice } from '@/lib/deviceSeries';
import { ConfirmModal, Modal } from '@/components/ui';
import { money } from '@/lib/format';
import { allBills, offlineRef, onQueueChange, removeBill, syncBills, type OfflineBill } from '@/lib/offlineQueue';

/** This business's offline bills on this device, kept up to date. */
export function useOfflineBills() {
  const me = useShopUser();
  const [bills, setBills] = useState<OfflineBill[]>([]);
  const load = useCallback(() => { allBills().then((all) => setBills(all.filter((b) => b.shopId === me.shop.id))).catch(() => setBills([])); }, [me.shop.id]);
  useEffect(() => { load(); return onQueueChange(load); }, [load]);
  const waiting = bills.filter((b) => b.status === 'waiting' || b.status === 'sending');
  const failed = bills.filter((b) => b.status === 'failed');
  const saved = bills.filter((b) => b.status === 'saved');
  return { bills, waiting, failed, saved };
}

/**
 * Sends waiting offline bills: when the app opens, the moment the connection returns, and every 20 seconds while
 * some are waiting. Mounted once in the app shell, so bills go out whatever page the counter is on.
 */
export function OfflineSync() {
  const me = useShopUser();
  const online = useOnline();
  const qc = useQueryClient();
  const toast = useToast();
  const { waiting } = useOfflineBills();
  const run = useCallback(async () => {
    if (!me.can('sales.write')) return;
    const r = await syncBills(me.shop.id).catch(() => ({ saved: [], failed: [] }));
    if (r.saved.length) {
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['items'] });
      const differ = r.saved.filter((b) => b.savedTotal !== undefined && Math.abs(b.savedTotal - b.expectedTotal) > 0.5);
      toast(differ.length ? 'info' : 'success', `${r.saved.length} offline bill${r.saved.length === 1 ? '' : 's'} saved`,
        `${r.saved.map((b) => b.invoiceNumber).filter(Boolean).slice(0, 4).join(', ')}${differ.length ? ` · ${differ.length} came to a different total, see Offline bills` : ''}`);
    }
    if (r.failed.length) toast('error', `${r.failed.length} offline bill${r.failed.length === 1 ? '' : 's'} need${r.failed.length === 1 ? 's' : ''} attention`, r.failed[0]!.lastError ?? '');
  }, [me, qc, toast]);
  useEffect(() => { if (online) void run(); }, [online, run]);
  // Get the counter ready for an outage while the internet is up: load the billing screen's code and the data it
  // needs once, so the service worker has them even if the counter has not opened POS yet today.
  useEffect(() => {
    if (!online || !me.can('sales.write') || !me.has('pos')) return;
    const t = window.setTimeout(() => {
      void import('@/pages/app/Pos').catch(() => undefined);
      // The camera barcode reader too, so camera billing works offline on browsers without a built-in reader.
      void import('@zxing/browser').catch(() => undefined);
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      for (const u of ['/shop/items', '/shop/customers', '/shop/organization', '/shop/branches', '/shop/print-settings', ...(me.has('offers_loyalty') ? [`/shop/offers/running?date=${date}`, '/shop/loyalty/settings'] : []),
        // The phone app keeps the rest of the essentials too, so every screen opens offline.
        ...(IS_APP ? ['/shop/tax-slabs', '/shop/invoices', '/shop/label/setup', ...(me.can('purchases.read') ? ['/shop/vendors', '/shop/bills', '/shop/purchase-orders'] : [])] : [])])
        void api.get(u).catch(() => undefined);
      // CorpusLite: register this phone for its own invoice series (and refresh the next number).
      if (IS_APP) void registerDevice(me.shop.id);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [online, me]);
  useEffect(() => {
    if (!online || !waiting.length) return;
    const t = setInterval(() => void run(), 20_000);
    return () => clearInterval(t);
  }, [online, waiting.length, run]);
  return null;
}

/** Top-bar pill: shown only while bills are waiting or need attention. Opens the list. */
export function OfflineBillsBadge() {
  const { waiting, failed } = useOfflineBills();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  if (!waiting.length && !failed.length) return null;
  const label = failed.length
    ? `${failed.length} offline bill${failed.length === 1 ? '' : 's'} need${failed.length === 1 ? 's' : ''} attention`
    : `${waiting.length} bill${waiting.length === 1 ? '' : 's'} ${online ? 'sending…' : 'saved on this device'}`;
  return (
    <>
      <button type="button" className={`offline-pill ${failed.length ? 'bad' : ''}`} onClick={() => setOpen(true)} aria-label={label} title={label}>
        {failed.length ? <AlertTriangle size={14} /> : online ? <CloudUpload size={14} /> : <CloudOff size={14} />}
        <span>{label}</span>
      </button>
      <OfflineBillsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Every offline bill on this device for this business: waiting, refused (with why), and saved in the last day. */
export function OfflineBillsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useShopUser();
  const online = useOnline();
  const { bills } = useOfflineBills();
  const [busy, setBusy] = useState('');
  const [discard, setDiscard] = useState<OfflineBill | null>(null);
  const retry = async (b: OfflineBill) => { setBusy(b.clientRef); try { await syncBills(me.shop.id, { retryFailed: b.clientRef }); } finally { setBusy(''); } };
  const shown = [...bills].reverse();
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Offline bills"
      subtitle={online ? 'Bills made at the counter without internet. They are sent automatically.' : 'You are offline. Bills are kept safely on this device and sent when the internet is back.'}
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      {!shown.length ? <p className="muted">No offline bills on this device.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Made</th><th>Bill</th><th>Customer</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((b) => {
                const differ = b.savedTotal !== undefined && Math.abs(b.savedTotal - b.expectedTotal) > 0.5;
                return (
                  <tr key={b.clientRef}>
                    <td className="muted">{new Date(b.madeAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="strong">{b.invoiceNumber && b.invoiceId ? <Link to={`/app/sales/invoices/${b.invoiceId}`} onClick={onClose}>{b.invoiceNumber}</Link> : offlineRef(b.clientRef)}<div className="muted small">{b.summary.items} item{b.summary.items === 1 ? '' : 's'} · {b.summary.mode}</div></td>
                    <td>{b.summary.customer}</td>
                    <td className="num">{money(b.savedTotal ?? b.expectedTotal)}{differ && <div className="small" style={{ color: 'var(--amber-700)' }}>{money(b.expectedTotal)} at the counter</div>}</td>
                    <td>
                      {b.status === 'saved' ? <span className="row small" style={{ gap: 4, color: 'var(--green-700)' }}><CheckCircle2 size={14} /> Saved</span>
                        : b.status === 'failed' ? <span className="small" style={{ color: 'var(--red-600)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Not saved: {b.lastError}</span>
                          : <span className="row small muted" style={{ gap: 4 }}>{b.status === 'sending' ? <Loader2 size={13} className="spin" /> : <CloudOff size={13} />} {b.status === 'sending' ? 'Sending' : online ? 'Waiting to send' : 'On this device'}{b.lastError ? ` · ${b.lastError}` : ''}</span>}
                      {differ && <div className="small" style={{ color: 'var(--amber-700)' }}>Total changed when saved (prices or offers were updated). Check with the customer.</div>}
                    </td>
                    <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {b.status === 'failed' && <button className="btn btn-soft btn-sm" disabled={!online || busy === b.clientRef} onClick={() => void retry(b)}>{busy === b.clientRef ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Try again</button>}
                      {b.status === 'failed' && <button className="icon-btn danger" aria-label="Discard bill" onClick={() => setDiscard(b)}><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal open={!!discard} onClose={() => setDiscard(null)} title="Discard this offline bill?" confirmLabel="Discard bill"
        text={discard ? `${offlineRef(discard.clientRef)} for ${money(discard.expectedTotal)} will be removed from this device and never saved. Do this only if you have entered it another way.` : ''}
        onConfirm={() => { if (discard) void removeBill(discard.clientRef); setDiscard(null); }} />
    </Modal>
  );
}
