/**
 * Counter helpers for fast keyboard + scanner billing (POS).
 *
 * What a cashier types into the scan box:
 *   8901234567890      scan or type a barcode / SKU / IMEI, Enter
 *   5*8901234567890    five of it (also 5x… or 5 X …; the number pad's * works)
 *   *5                 make the last item five
 *   2.5*TOMATO         weighed or loose items take decimals
 * Everything is kept on this device, so it works with no internet: the bill being made survives a refresh or a power
 * cut, and held bills wait on this counter until recalled.
 */

export type ScanInput =
  | { kind: 'empty' }
  | { kind: 'setQty'; qty: number } // "*5"
  | { kind: 'code'; code: string; qty: number }; // "5*code" or "code"

const QTY = '(\\d{1,5}(?:\\.\\d{1,3})?)';
export function parseScan(raw: string): ScanInput {
  const s = raw.trim();
  if (!s) return { kind: 'empty' };
  let m = new RegExp(`^[*xX]\\s*${QTY}$`).exec(s);
  if (m) return { kind: 'setQty', qty: Number(m[1]) };
  m = new RegExp(`^${QTY}\\s*[*xX]\\s*(\\S.*)$`).exec(s);
  if (m && Number(m[1]) > 0) return { kind: 'code', code: m[2]!.trim(), qty: Number(m[1]) };
  return { kind: 'code', code: s, qty: 1 };
}

/* ---------- Scan beep: a short high tone when an item goes on the bill, a low one when it doesn't ---------- */
let ctx: AudioContext | null = null;
export function beep(ok: boolean) {
  try {
    if (localStorage.getItem('c360.pos.beep') === '0') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? 'sine' : 'square';
    o.frequency.value = ok ? 1750 : 220;
    g.gain.value = ok ? 0.06 : 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.07 : 0.22));
  } catch { /* no audio on this device */ }
}
export const beepOn = () => { try { return localStorage.getItem('c360.pos.beep') !== '0'; } catch { return true; } };
export const setBeepOn = (on: boolean) => { try { localStorage.setItem('c360.pos.beep', on ? '1' : '0'); } catch { /* private mode */ } };

/* ---------- The bill being made, and held bills (this counter only) ---------- */
export interface CounterLine { itemId: string; qty: number; serials?: string[] }
export interface CounterBill {
  cart: CounterLine[];
  customerId: string;
  disc: { kind: 'percent' | 'amount'; value: number };
  mode: 'Cash' | 'UPI' | 'Card' | 'Split';
}
export interface HeldBill extends CounterBill { id: string; heldAt: string; label: string; total: number }

const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (key: string, v: unknown) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

const draftKey = (shopId: string, userId: string) => `c360.pos.draft.${shopId}.${userId}`;
export const loadDraft = (shopId: string, userId: string) => read<CounterBill | null>(draftKey(shopId, userId), null);
export const saveDraft = (shopId: string, userId: string, b: CounterBill | null) => write(draftKey(shopId, userId), b && b.cart.length ? b : null);

const heldKey = (shopId: string) => `c360.pos.held.${shopId}`;
export const heldBills = (shopId: string) => read<HeldBill[]>(heldKey(shopId), []);
export function holdBill(shopId: string, b: CounterBill, label: string, total: number): HeldBill {
  const h: HeldBill = { ...b, id: `h${Date.now().toString(36)}`, heldAt: new Date().toISOString(), label, total };
  write(heldKey(shopId), [...heldBills(shopId), h].slice(-20));
  return h;
}
export function takeHeld(shopId: string, id: string): HeldBill | null {
  const all = heldBills(shopId);
  const h = all.find((x) => x.id === id) ?? null;
  write(heldKey(shopId), all.filter((x) => x.id !== id));
  return h;
}

/** Notes a customer is likely to hand over for a total: exact, then the next round amounts. */
export function cashSuggestions(total: number): number[] {
  if (!(total > 0)) return [];
  const out = new Set<number>([Math.ceil(total)]);
  for (const step of [10, 50, 100, 500, 2000]) { const v = Math.ceil(total / step) * step; if (v > total) out.add(v); }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
