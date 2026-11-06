/**
 * What this computer's printers need, learnt from one question after the first print ("How did it come out?").
 * Kept on the device, not the shop: each counter has its own printer and driver, and the browser cannot see how a
 * driver is set up. A label printer's turn is kept per label size; a receipt printer's page width per roll size.
 */
import type { Turn } from '../../shared/labelLayout';
import type { PaperSize } from '../../shared/printSettings';

const KEY = 'c360.printer';
interface Memory {
  labels?: Record<string, { turn: Turn; ok?: boolean }>;
  receipts?: Partial<Record<PaperSize, { width: 'roll' | 'printable'; ok?: boolean; small?: number }>>;
}
const read = (): Memory => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Memory; } catch { return {}; } };
const write = (m: Memory) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode: asks again next time */ } };

export const labelKey = (w: number, h: number) => `${w}x${h}`;
export const labelMemory = (w: number, h: number) => read().labels?.[labelKey(w, h)];
export function rememberLabel(w: number, h: number, v: { turn: Turn; ok?: boolean }) {
  const m = read(); m.labels = { ...m.labels, [labelKey(w, h)]: v }; write(m);
}
export const receiptMemory = (paper: PaperSize) => read().receipts?.[paper];
export function rememberReceipt(paper: PaperSize, v: { width: 'roll' | 'printable'; ok?: boolean; small?: number }) {
  const m = read(); m.receipts = { ...m.receipts, [paper]: v }; write(m);
}
/** Receipt page width on this computer: what it learnt, else the shop's setting. */
export const receiptWidth = (paper: PaperSize, shop?: 'roll' | 'printable') => receiptMemory(paper)?.width ?? shop ?? 'roll';

/** Fired after a receipt is sent to the printer, so the one-time "How did it come out?" question can show. */
export const RECEIPT_PRINTED = 'c360:receipt-printed';
export interface ReceiptPrinted { paper: PaperSize; reprint: () => void }
export const announceReceipt = (d: ReceiptPrinted) => window.dispatchEvent(new CustomEvent<ReceiptPrinted>(RECEIPT_PRINTED, { detail: d }));
