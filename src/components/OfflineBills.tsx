import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, CloudUpload, AlertTriangle, CheckCircle2, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SALES_KEYS } from '@/api/hooks';
import { api } from '@/api/client';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { IS_APP, IS_DESKTOP } from '@/lib/platform';
import { useNet } from '@/lib/net';
import { registerDevice } from '@/lib/deviceSeries';
import { ConfirmModal, Modal } from '@/components/ui';
import { money } from '@/lib/format';
import { allChanges, dropChange, onOutboxChange, setOutboxUser, type OutboxEntry } from '@/lib/outbox';
import { syncOutbox } from '@/lib/outboxSync';
import { allBills, unsentBills, offlineRef, onQueueChange, removeBill, syncBills, type OfflineBill } from '@/lib/offlineQueue';

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

/** This business's other saves kept on this device (invoices, payments, customers…), kept up to date. */
export function useOutbox() {
  const me = useShopUser();
  const [list, setList] = useState<OutboxEntry[]>([]);
  const load = useCallback(() => { allChanges().then((all) => setList(all.filter((e) => e.shopId === me.shop.id))).catch(() => setList([])); }, [me.shop.id]);
  useEffect(() => { load(); return onOutboxChange(load); }, [load]);
  return { list, waiting: list.filter((e) => e.status === 'waiting' || e.status === 'sending'), failed: list.filter((e) => e.status === 'failed'), done: list.filter((e) => e.status === 'done') };
}

/**
 * Sends waiting offline bills: when the app opens, the moment the connection returns, and every 20 seconds while
 * some are waiting. Mounted once in the app shell, so bills go out whatever page the counter is on.
 */
export function OfflineSync() {
  const me = useShopUser();
  const net = useNet();
  // "Online" means it really answers: a weak connection waits until the check says it is back.
  const online = net === 'online';
  const qc = useQueryClient();
  const toast = useToast();
  const { waiting: waitingBills } = useOfflineBills();
  const outbox = useOutbox();
  const waiting = [...waitingBills, ...outbox.waiting];
  useEffect(() => { setOutboxUser({ shopId: me.shop.id, userId: me.user.id }); return () => setOutboxUser(null); }, [me.shop.id, me.user.id]);
  // Something was kept offline: lists show it at once (they include what is waiting to be sent).
  useEffect(() => {
    const f = (e: Event) => {
      const k = (e as CustomEvent<OutboxEntry>).detail.kind.replace('-edit', '');
      qc.invalidateQueries({ queryKey: [k === 'vendor' ? 'vendors' : k === 'item' ? 'items' : k === 'customer' ? 'customers' : k === 'payment' || k === 'invoice' ? 'invoices' : k === 'bill' ? 'bills' : 'expenses'] });
    };
    window.addEventListener('c360:queued', f);
    return () => window.removeEventListener('c360:queued', f);
  }, [qc]);
  const run = useCallback(async () => {
    // Other saves kept offline (invoices, payments, customers, items…), in the order they were made.
    const o = await syncOutbox(me.shop.id).catch(() => ({ sent: [], failed: [] }));
    if (o.sent.length) {
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      ['vendors', 'bills', 'expenses', 'billPayments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const nums = o.sent.map((e) => e.result?.number).filter(Boolean).slice(0, 4).join(', ');
      toast('success', `${o.sent.length} change${o.sent.length === 1 ? '' : 's'} made offline ${o.sent.length === 1 ? 'is' : 'are'} now saved`, nums ? `Invoice numbers: ${nums}` : undefined);
    }
    if (o.failed.length) toast('error', `${o.failed.length} change${o.failed.length === 1 ? '' : 's'} made offline couldn’t be saved`, `${o.failed[0]!.label}: ${o.failed[0]!.error ?? ''}. Open Offline changes to fix it.`);
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
  // "Send now" in the Offline bills list: try at once, even if the connection looked weak a moment ago.
  useEffect(() => { const f = () => void run(); window.addEventListener('c360:sync-now', f); return () => window.removeEventListener('c360:sync-now', f); }, [run]);
  // Printing, saving or opening a link through the phone failed: say why.
  useEffect(() => {
    if (!IS_APP) return;
    const on = (e: Event) => toast('error', 'Couldn’t finish on this phone', String((e as CustomEvent).detail ?? ''));
    window.addEventListener('c360:native-error', on);
    return () => window.removeEventListener('c360:native-error', on);
  }, [toast]);
  // Get ready for an outage while the internet is up: every screen's code and the data billing needs, so invoices,
  // payments and counter bills can be made offline even on screens not opened yet today.
  useEffect(() => {
    if (!online) return;
    const t = window.setTimeout(() => {
      void navigator.serviceWorker?.ready.then((r) => r.active?.postMessage('precache')).catch(() => undefined);
      const pos = me.can('sales.write') && me.has('pos');
      if (pos) {
        void import('@/pages/app/Pos').catch(() => undefined);
        // The camera barcode reader too, so camera billing works offline on browsers without a built-in reader.
        void import('@zxing/browser').catch(() => undefined);
      }
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      for (const u of ['/shop/items', '/shop/customers', '/shop/organization', '/shop/branches', '/shop/print-settings', '/shop/tax-slabs', '/shop/invoices', '/shop/bank-accounts',
        ...(me.has('offers_loyalty') ? [`/shop/offers/running?date=${date}`, '/shop/loyalty/settings'] : []),
        ...(IS_APP ? ['/shop/label/setup'] : []),
        ...(me.can('purchases.read') ? ['/shop/vendors', '/shop/bills', '/shop/purchase-orders'] : [])])
        void api.get(u).catch(() => undefined);
      // Phones and the Windows app: register for this device's own counter invoice series (and refresh the next number).
      if (pos && (IS_APP || IS_DESKTOP)) void registerDevice(me.shop.id);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [online, me]);
  // Ask the browser to keep this site's storage, so bills kept offline are never cleared to free up space.
  useEffect(() => { void navigator.storage?.persist?.().catch(() => undefined); }, []);
  // The Windows app asks before closing while bills are still waiting to be sent.
  const unsent = waiting.length;
  useEffect(() => {
    const d = (window as unknown as { corpusDesktop?: { setPending?: (n: number) => void } }).corpusDesktop;
    d?.setPending?.(unsent);
  }, [unsent]);
  useEffect(() => {
    if (!online || !waiting.length) return;
    const t = setInterval(() => void run(), 20_000);
    return () => clearInterval(t);
  }, [online, waiting.length, run]);
  return null;
}

/** Top-bar pill: shown only while bills are waiting or need attention. Opens the list. */
export function OfflineBillsBadge() {
  const b = useOfflineBills();
  const o = useOutbox();
  const waiting = [...b.waiting, ...o.waiting]; const failed = [...b.failed, ...o.failed];
  const online = useNet() === 'online';
  const [open, setOpen] = useState(false);
  if (!waiting.length && !failed.length) return null;
  const what = (n: number) => (o.waiting.length || o.failed.length ? `change${n === 1 ? '' : 's'}` : `bill${n === 1 ? '' : 's'}`);
  const label = failed.length
    ? `${failed.length} offline ${what(failed.length)} need${failed.length === 1 ? 's' : ''} attention`
    : `${waiting.length} ${what(waiting.length)} ${online ? 'sending…' : 'saved on this device'}`;
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
  const online = useNet() === 'online';
  const { bills } = useOfflineBills();
  const outbox = useOutbox();
  const [busy, setBusy] = useState('');
  const [discard, setDiscard] = useState<OfflineBill | null>(null);
  const [drop, setDrop] = useState<OutboxEntry | null>(null);
  const retryChange = async (e: OutboxEntry) => { setBusy(e.key); try { await syncOutbox(me.shop.id, { retry: e.key }); } finally { setBusy(''); } };
  const retry = async (b: OfflineBill) => { setBusy(b.clientRef); try { await syncBills(me.shop.id, { retryFailed: b.clientRef }); } finally { setBusy(''); } };
  const shown = [...bills].reverse();
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Offline changes"
      subtitle={online ? 'Bills, invoices, payments and other changes made without internet. They are sent automatically.' : 'You are offline. Changes are kept safely on this device and sent when the internet is back.'}
      footer={<>
        {(bills.some((b) => b.status === 'waiting') || outbox.waiting.length > 0) && <button className="btn btn-secondary" disabled={busy === 'all' || navigator.onLine === false} onClick={() => { setBusy('all'); window.dispatchEvent(new Event('c360:sync-now')); window.setTimeout(() => setBusy(''), 3000); }}>{busy === 'all' ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Send now</button>}
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </>}>
      {outbox.list.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table className="table">
            <thead><tr><th>Made</th><th>Change</th><th>Status</th><th /></tr></thead>
            <tbody>
              {[...outbox.list].reverse().map((e) => (
                <tr key={e.key}>
                  <td className="muted">{new Date(e.madeAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="strong">{e.status === 'done' && e.result?.id && e.kind === 'invoice' ? <Link to={`/app/sales/invoices/${e.result.id}`} onClick={onClose}>{e.label}{e.result.number ? ` ${e.result.number}` : ''}</Link> : e.label}</td>
                  <td>
                    {e.status === 'done' ? <span className="row small" style={{ gap: 4, color: 'var(--green-700)' }}><CheckCircle2 size={14} /> Saved</span>
                      : e.status === 'failed' ? <span className="small" style={{ color: 'var(--red-600)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Not saved: {e.error}</span>
                        : <span className="row small muted" style={{ gap: 4 }}>{e.status === 'sending' ? <Loader2 size={13} className="spin" /> : <CloudOff size={13} />} {e.status === 'sending' ? 'Sending' : online ? 'Waiting to send' : 'On this device'}{e.error ? ` · ${e.error}` : ''}</span>}
                  </td>
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {e.status === 'failed' && <button className="btn btn-soft btn-sm" disabled={!online || busy === e.key} onClick={() => void retryChange(e)}>{busy === e.key ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Try again</button>}
                    {e.status === 'failed' && <button className="icon-btn danger" aria-label="Discard change" onClick={() => setDrop(e)}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!shown.length ? (!outbox.list.length && <p className="muted">Nothing made offline on this device.</p>) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Made</th><th>Bill</th><th>Customer</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((b) => {
                const differ = b.savedTotal !== undefined && Math.abs(b.savedTotal - b.expectedTotal) > 0.5;
                return (
                  <tr key={b.clientRef}>
                    <td className="muted">{new Date(b.madeAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="strong">{b.invoiceNumber && b.invoiceId ? <Link to={`/app/sales/invoices/${b.invoiceId}`} onClick={onClose}>{b.invoiceNumber}</Link> : (b.ref ?? offlineRef(b.clientRef))}<div className="muted small">{b.summary.items} item{b.summary.items === 1 ? '' : 's'} · {b.summary.mode}</div></td>
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
        text={discard ? `${discard.ref ?? offlineRef(discard.clientRef)} for ${money(discard.expectedTotal)} will be removed from this device and never saved. Do this only if you have entered it another way.` : ''}
        onConfirm={() => { if (discard) void removeBill(discard.clientRef); setDiscard(null); }} />
      <ConfirmModal open={!!drop} onClose={() => setDrop(null)} title="Discard this change?" confirmLabel="Discard"
        text={drop ? `“${drop.label}” will be removed from this device and never saved. Do this only if you have entered it again another way.` : ''}
        onConfirm={() => { if (drop) void dropChange(drop.key); setDrop(null); }} />
    </Modal>
  );
}

/**
 * Before signing out: bills made offline that haven't reached the server yet stay on this device and are sent the
 * next time someone from this business signs in here. Say so, so nobody signs out thinking they were sent.
 */
export async function okToSignOut(shopId: string): Promise<boolean> {
  const changes = (await allChanges().catch(() => [] as OutboxEntry[])).filter((e) => e.shopId === shopId && e.status !== 'done').length;
  const n = (await unsentBills(shopId)).length + changes;
  if (!n) return true;
  return window.confirm(`${n} ${changes ? 'change' : 'bill'}${n === 1 ? '' : 's'} made offline ${n === 1 ? 'hasn’t' : 'haven’t'} reached the server yet.\n\nThey stay safe on this device and are sent the next time someone from this business signs in here with the internet on. Don’t clear this browser’s data or uninstall the app before then.\n\nSign out anyway?`);
}
