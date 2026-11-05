import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, ScanBarcode, Search, Trash2, Banknote, Smartphone, CreditCard, Loader2, Printer, MessageCircle, Plus, CheckCircle2, Package, Wrench, UserRound, Split, Tag, Scale, AlertTriangle, CloudOff } from 'lucide-react';
import { api } from '@/api/client';
import { SALES_KEYS, useBranches, useCustomers, useItems, useMut, useOrg, usePrintSettings, pickable } from '@/api/hooks';
import { ThermalReceipt, printReceipt, receiptFromInvoice, type ReceiptData } from '@/components/printing';
import { isNetworkError, newClientRef, offlineRef, saveBill } from '@/lib/offlineQueue';
import { useOnline } from '@/components/useOnline';
import { OfflineBillsModal, useOfflineBills } from '@/components/OfflineBills';
import { withPrintDefaults, type PaperSize } from '../../../shared/printSettings';
import type { Invoice, Item, PriceTier } from '@/api/types';
import { TIER_LABEL } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field, Modal, Segmented, Toggle } from '@/components/ui';
import { upiLink, useQr } from '@/components/qr';
import { useShortcuts } from '@/components/useShortcuts';
import { applyBillAdjustments, computeTotals, lineAmount, type BillDiscount } from '@/lib/calc';
import { priceFor } from '@/components/LineItems';
import { QuickBill, type ParsedBill } from '@/components/QuickBill';
import { useAiEnabled } from '@/components/Assistant';
import { useScale } from '@/lib/scale';
import { isWeighed, qtyFromReading } from '../../../shared/scale';
import { Thumb } from '@/components/kit';
import { money } from '@/lib/format';
import { isInterState } from '../../../shared/gst';
import { waLink } from './InvoiceView';
import { findByCode } from '../../../shared/barcode';
import { beep, beepOn, cashSuggestions, heldBills, holdBill, loadDraft, parseScan, saveDraft, setBeepOn, takeHeld, type CounterLine, type HeldBill } from '@/lib/posCounter';
import { CustomerByPhone, OffersSummary, PointsBox, usePromo } from '@/components/OffersLoyalty';
import { payable, pointsEarned, priceBill } from '../../../shared/offers';

type CartLine = CounterLine;

/** Fast counter billing: scan → cart → charge. Each sale is an issued invoice with its payment. */
export default function Pos() {
  const me = useShopUser();
  const toast = useToast();
  const items = (useItems().data ?? []).filter((i) => !i.isGroup);
  const { data: customers = [] } = useCustomers();
  const branches = useBranches().data ?? [];
  const org = useOrg().data;
  const printCfg = withPrintDefaults(usePrintSettings().data);
  // Roll width for this counter: starts from Print settings, can be switched per sale (58 mm or 80 mm printers).
  const [rollPick, setRoll] = useState<PaperSize | null>(null);
  const receiptCfg = { ...printCfg.thermal, paper: rollPick ?? printCfg.thermal.paper };
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'Goods' | 'Services'>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState(me.user.branchId ?? '');
  const [withGst, setWithGst] = useState(true);
  const [mode, setMode] = useState<'Cash' | 'UPI' | 'Card' | 'Split'>('Cash');
  const [split, setSplit] = useState({ Cash: '', UPI: '', Card: '' });
  // MRP billing is a per-counter habit, so remember it on this device.
  const [mrp, setMrpState] = useState(() => { try { return localStorage.getItem('c360.pos.mrp') === '1'; } catch { return false; } });
  const setMrp = (v: boolean) => { setMrpState(v); try { localStorage.setItem('c360.pos.mrp', v ? '1' : '0'); } catch { /* private mode */ } };
  const [disc, setDisc] = useState<BillDiscount>({ kind: 'percent', value: 0 });
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [done, setDone] = useState<{ invoice: Invoice; change: number } | null>(null);
  // A bill saved on this device because the internet was down: its receipt is printed from what the counter worked out.
  const [offDone, setOffDone] = useState<{ ref: string; receipt: ReceiptData; change: number; phone?: string } | null>(null);
  const online = useOnline();
  const offBills = useOfflineBills();
  const [showOff, setShowOff] = useState(false);
  const [skip, setSkip] = useState<string[]>([]);
  const [usePoints, setUsePoints] = useState<{ on: boolean; points: number }>({ on: false, points: 0 });
  const scanRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);
  const chargeRef = useRef<HTMLButtonElement>(null);
  const discRef = useRef<HTMLInputElement>(null);
  // Keyboard counter: the highlighted search result, the last item put on the bill, and the small dialogs.
  const [hl, setHl] = useState(0);
  const [lastId, setLastId] = useState('');
  const [help, setHelp] = useState(false);
  const [held, setHeld] = useState<HeldBill[]>(() => heldBills(me.shop.id));
  const [heldOpen, setHeldOpen] = useState(false);
  const [imeiFor, setImeiFor] = useState<Item | null>(null);
  const [sound, setSound] = useState(beepOn);
  const [restored, setRestored] = useState(false);
  const [unknown, setUnknown] = useState('');

  useEffect(() => { if (!branchId && branches.length) setBranchId(branches.find((b) => b.isPrimary)?.id ?? branches[0]!.id); }, [branches, branchId]);
  useEffect(() => { if (org && (org.compositionScheme || !org.gstin)) setWithGst(false); }, [org]);
  useEffect(() => { scanRef.current?.focus(); }, []);
  useEffect(() => { setUsePoints({ on: false, points: 0 }); }, [customerId]);

  const customer = customers.find((c) => c.id === customerId);
  const tier: PriceTier = customer?.tier ?? 'SP1';
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = cart.map((l) => ({ ...l, it: byId.get(l.itemId)! })).filter((l) => l.it);
  const inclusive = withGst && mrp;
  const unit = (it: Item) => priceFor(it, tier, inclusive);
  const calc = lines.map((l) => ({ itemId: l.itemId, category: l.it.category ?? '', qty: l.qty, rate: unit(l.it), taxRate: l.it.taxRate, discount: 0 }));
  const inter = !!org && !!customer && isInterState(org.state, customer.state || org.state);
  const billDiscount = disc.value > 0 ? disc : null;
  // Festival offers and points (shop add-on): the same rules the server uses, so the total shown is the total charged.
  const promo = usePromo(customerId);
  const pricedBase = priceBill({ lines: calc, withGst, pricesIncludeTax: inclusive, billDiscount, offers: promo.offers, skip });
  const redeem = promo.loyaltyOn && customer && usePoints.on && usePoints.points > 0 ? { points: usePoints.points, pointValue: promo.settings.pointValue } : null;
  const priced = redeem ? priceBill({ lines: calc, withGst, pricesIncludeTax: inclusive, billDiscount, offers: promo.offers, skip, redeem }) : pricedBase;
  const totals = computeTotals(promo.on ? priced.lines : applyBillAdjustments(calc, { withGst, pricesIncludeTax: inclusive, billDiscount }), withGst, inter);
  const willEarn = promo.loyaltyOn && customer ? pointsEarned(promo.settings, totals.total) : 0;
  const change = mode === 'Cash' && tendered ? Number(tendered) - totals.total : 0;
  const splitPaid = (['Cash', 'UPI', 'Card'] as const).reduce((a, m) => a + (Number(split[m]) || 0), 0);
  const splitLeft = Math.round((totals.total - splitPaid) * 100) / 100;
  /** Fill the remaining amount into one part with a tap. */
  const fillRest = (m: 'Cash' | 'UPI' | 'Card') => setSplit((sp) => ({ ...sp, [m]: String(Math.max(0, Math.round((totals.total - (['Cash', 'UPI', 'Card'] as const).filter((x) => x !== m).reduce((a, x) => a + (Number(sp[x]) || 0), 0)) * 100) / 100)) }));
  const upiDue = mode === 'Split' ? Number(split.UPI) || 0 : totals.total;
  const qr = useQr((mode === 'UPI' || (mode === 'Split' && upiDue > 0)) && org?.upiId && upiDue > 0 ? upiLink(org, upiDue, 'POS sale') : null);

  const scale = useScale();
  useEffect(() => { if (scale.error) toast('error', 'Scale', scale.error); }, [scale.error]);
  /** Items sold by weight take the scale reading when a scale is connected; everything else adds one. */
  const add = (it: Item, qty = 1) => {
    setLastId(it.id); setUnknown('');
    // Phones and other IMEI / serial items: each unit needs its number, scanned next.
    if (it.trackSerials) { setImeiFor(it); return; }
    beep(true);
    const w = qty === 1 && scale.connected && scale.reading && scale.reading.kg > 0 && isWeighed(it.unit) ? qtyFromReading(scale.reading.kg, it.unit) : null;
    if (w !== null) return setCart((c) => (c.some((l) => l.itemId === it.id) ? c.map((l) => (l.itemId === it.id ? { ...l, qty: w } : l)) : [...c, { itemId: it.id, qty: w }]));
    setCart((c) => (c.some((l) => l.itemId === it.id) ? c.map((l) => (l.itemId === it.id ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l)) : [...c, { itemId: it.id, qty }]));
  };
  /** Puts one IMEI / serial unit on the bill (its line's quantity is the count of numbers). */
  const addSerial = (it: Item, serial: string) => {
    setLastId(it.id); setUnknown('');
    beep(true);
    onBill.current.add(serial.toLowerCase());
    // Checked again inside the update: a scanner's double read can never put the same unit on the bill twice.
    setCart((c) => (c.some((l) => l.serials?.includes(serial)) ? c : c.some((l) => l.itemId === it.id)
      ? c.map((l) => (l.itemId === it.id ? { ...l, serials: [...(l.serials ?? []), serial], qty: (l.serials?.length ?? 0) + 1 } : l))
      : [...c, { itemId: it.id, qty: 1, serials: [serial] }]));
  };
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.itemId !== id) : c.map((l) => (l.itemId === id ? (l.serials ? { ...l, serials: l.serials.slice(0, Math.max(0, qty)), qty: Math.min(qty, l.serials.length) } : { ...l, qty }) : l))));
  const lastLine = () => cart.find((l) => l.itemId === lastId) ?? cart[cart.length - 1];
  /** + / − on the last item (serial items: + scans another unit, − drops the last number). */
  const bumpLast = (d: number) => {
    const l = lastLine(); if (!l) return;
    const it = byId.get(l.itemId);
    if (it?.trackSerials && d > 0) { setImeiFor(it); return; }
    setQty(l.itemId, Math.round((l.qty + d) * 1000) / 1000);
  };

  // The item just scanned stays in view on a long bill, so the cashier can check its name, quantity and price.
  useEffect(() => { if (lastId) document.querySelector(`[data-line="${lastId}"]`)?.scrollIntoView({ block: 'nearest' }); }, [lastId, cart]);

  // The bill being made is kept on this device: a refresh, a closed tab or a power cut doesn't lose it.
  useEffect(() => {
    if (restored || !items.length) return;
    setRestored(true);
    const d = loadDraft(me.shop.id, me.user.id);
    if (!d?.cart?.length) return;
    const known = d.cart.filter((l) => byId.has(l.itemId));
    if (!known.length) return;
    setCart(known); setCustomerId(d.customerId ?? ''); setDisc(d.disc ?? { kind: 'percent', value: 0 }); setMode(d.mode ?? 'Cash');
    toast('info', 'Unfinished bill restored', `${known.length} item${known.length === 1 ? '' : 's'} from before. Press Ctrl+Delete to clear it.`);
  }, [items.length, restored]);
  useEffect(() => { if (restored) saveDraft(me.shop.id, me.user.id, { cart, customerId, disc, mode }); }, [cart, customerId, disc, mode, restored]);

  const aiOn = useAiEnabled();
  const applyQuick = (b: ParsedBill) => {
    setCart((c) => {
      const next = [...c];
      for (const l of b.lines) {
        const i = next.findIndex((x) => x.itemId === l.itemId);
        if (i >= 0) next[i] = { ...next[i]!, qty: next[i]!.qty + l.qty }; else next.push({ itemId: l.itemId, qty: l.qty });
      }
      return next;
    });
    if (b.customer) setCustomerId(b.customer.id);
    if (b.paymentMode) setMode(b.paymentMode);
    if (b.billDiscount) setDisc(b.billDiscount);
    if (b.pricesIncludeTax !== null && withGst) setMrp(b.pricesIncludeTax);
  };
  // "5*rice" searches for rice; "*5" searches nothing (it changes the last item).
  const parsed = parseScan(q);
  const searchText = parsed.kind === 'code' ? parsed.code : '';
  const shown = useMemo(() => {
    const s = searchText.toLowerCase();
    return items.filter((i) => (kind === 'all' || i.type === kind) && (!s || [i.name, i.sku, i.barcode, String(i.extra?.localName ?? '')].some((v) => v.toLowerCase().includes(s)))).slice(0, 60);
  }, [items, searchText, kind]);

  useEffect(() => { setHl(0); }, [searchText, kind]);
  const onScanEnter = async () => {
    const p = parseScan(q);
    // Enter on an empty box: the bill is done, go to payment.
    if (p.kind === 'empty') { if (lines.length) goPay(); return; }
    if (p.kind === 'setQty') {
      const l = lastLine();
      setQ('');
      if (!l) return void beep(false);
      if (byId.get(l.itemId)?.trackSerials) { beep(false); return toast('error', 'Scan each phone’s IMEI', 'Items with IMEI / serial numbers are added one scan at a time.'); }
      setQty(l.itemId, p.qty); beep(true);
      return;
    }
    const exact = findByCode(items, p.code);
    // Typed a name: Enter takes the highlighted match (arrow keys move it), or the only one.
    const target = exact ?? (shown.length && searchText.length >= 2 ? shown[Math.min(hl, shown.length - 1)] : undefined);
    if (target) {
      if (target.trackSerials && p.qty !== 1) { setQ(''); beep(false); return toast('error', 'Scan each phone’s IMEI', 'Items with IMEI / serial numbers are added one scan at a time.'); }
      add(target, p.qty); setQ(''); return;
    }
    // Not an item code: maybe the IMEI / serial number of a phone in stock. Scanning it puts that exact phone on the bill.
    setQ('');
    if (/^[A-Za-z0-9/-]{6,60}$/.test(p.code) && navigator.onLine && (await addByImei(p.code)) !== 'none') return;
    beep(false);
    // The box is cleared anyway, so the next scan never runs into this one; the code stays visible in the banner.
    setUnknown(p.code);
  };
  /** Keys in the scan box. With the box empty: + / − change the last item, Delete removes it. */
  const onScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void onScanEnter(); return; }
    if (e.key === 'Escape') { if (q) { e.preventDefault(); setQ(''); setUnknown(''); } return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && searchText) {
      e.preventDefault();
      const cols = Math.max(1, Math.round((document.querySelector('.pos-grid')?.clientWidth ?? 600) / 200));
      setHl((h) => Math.max(0, Math.min(shown.length - 1, h + (e.key === 'ArrowDown' ? cols : -cols))));
      return;
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && searchText && e.currentTarget.selectionStart === q.length && !e.shiftKey) {
      if (e.key === 'ArrowLeft' && hl === 0) return;
      e.preventDefault();
      setHl((h) => Math.max(0, Math.min(shown.length - 1, h + (e.key === 'ArrowRight' ? 1 : -1))));
      return;
    }
    if (q) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); bumpLast(1); }
    else if (e.key === '-') { e.preventDefault(); bumpLast(-1); }
    else if (e.key === 'Delete') { e.preventDefault(); const l = lastLine(); if (l) setQty(l.itemId, 0); }
  };
  /**
   * Puts the phone with this IMEI / serial on the bill after checking it online (in stock, this branch, not on the bill).
   * expect: the item whose box was just scanned. Returns 'none' when no unit has this number.
   */
  const addByImei = async (raw: string, expect?: Item): Promise<'added' | 'refused' | 'none'> => {
    const code = raw.replace(/\s+/g, '');
    const key = code.toLowerCase();
    const no = (title: string, msg?: string) => { beep(false); toast('error', title, msg); return 'refused' as const; };
    // The same IMEI read twice in a row (scanners do that): the second read is refused at once, not checked again.
    if (checking.current.has(key) || onBill.current.has(key)) return no(`${code} is already on this bill`);
    if (!navigator.onLine) return no('No internet: IMEI numbers are checked online', 'Bill this phone when the connection is back.');
    checking.current.add(key);
    try {
      const hits = await api.get<Array<{ itemId: string; serial: string; status: string; branchId: string | null; invoiceNumber: string | null }>>(`/shop/serials/lookup?q=${encodeURIComponent(code)}`);
      const hit = hits.find((h) => h.serial.toLowerCase() === key);
      const it = hit && byId.get(hit.itemId);
      if (!hit || !it) return expect ? no(`${code} isn’t in your stock records`, `Not an IMEI of ${expect.name}.`) : 'none';
      if (expect && hit.itemId !== expect.id) return no(`${code} belongs to ${it.name}`, `Not ${expect.name}.`);
      if (hit.status !== 'In stock') return no(`${hit.serial} is ${hit.status.toLowerCase()}`, hit.invoiceNumber ? `Already sold on ${hit.invoiceNumber}.` : it.name);
      if (branchId && hit.branchId && hit.branchId !== branchId) return no(`${hit.serial} is at another branch`, 'Transfer it to this branch first.');
      if (onBill.current.has(key)) return no(`${hit.serial} is already on this bill`);
      addSerial(it, hit.serial);
      return 'added';
    } catch {
      return expect ? no('Could not check this IMEI', 'Scan it again.') : 'none';
    } finally {
      checking.current.delete(key);
    }
  };
  /** After the last scan: Cash goes to the amount given, other modes straight to Charge. */
  const goPay = () => {
    if (mode === 'Cash') { tenderRef.current?.focus(); tenderRef.current?.select(); }
    else chargeRef.current?.focus();
  };

  const sale = useMut((b: Record<string, unknown>) => api.post<{ invoice: Invoice; change: number }>('/shop/pos/sale', b), SALES_KEYS, { silentError: true });
  // A second Enter while the receipt opens must never charge the same bill again.
  const charging = useRef(false);
  const checking = useRef(new Set<string>());
  // IMEIs on this bill, updated the moment one is added (the screen catches up a moment later).
  const onBill = useRef(new Set<string>());
  useEffect(() => { onBill.current = new Set(cart.flatMap((l) => l.serials ?? []).map((x) => x.toLowerCase())); }, [cart]);
  const charge = () => {
    if (!lines.length || sale.isPending || charging.current || done || offDone) return;
    if (mode === 'Cash' && tendered && Number(tendered) < totals.total) return toast('error', 'Cash tendered is less than the bill total');
    const parts = (['Cash', 'UPI', 'Card'] as const).filter((m) => Number(split[m]) > 0).map((m) => ({ mode: m, amount: Number(split[m]), reference: m === 'Cash' ? '' : reference }));
    if (mode === 'Split' && (parts.length < 2 || Math.abs(splitLeft) > 0.5)) return toast('error', parts.length < 2 ? 'Enter at least two payment parts' : splitLeft > 0 ? `₹${splitLeft} still to collect` : `Parts are ₹${-splitLeft} more than the bill`);
    const body = { customerId: customerId || null, branchId: branchId || null, withGst, mode: mode === 'Split' ? 'Cash' : mode, reference, tendered: mode === 'Cash' && tendered ? Number(tendered) : undefined,
      ...(mode === 'Split' ? { split: parts } : {}), pricesIncludeTax: inclusive, billDiscount,
      ...(promo.on ? { skipOffers: skip, redeemPoints: redeem ? redeem.points : 0 } : {}),
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, tier, discount: 0, rate: unit(l.it), ...(l.serials?.length ? { serials: l.serials } : {}) })) };
    // Every bill has its own ID, sent with it: a retry after a dropped reply can never save it twice.
    const clientRef = newClientRef();
    charging.current = true;
    if (!navigator.onLine) return void saveOffline(clientRef, body).then((saved) => { if (!saved) charging.current = false; });
    sale.mutate({ ...body, clientRef }, {
      onSuccess: (r) => setDone(r),
      onSettled: (_r, e) => { if (e && !isNetworkError(e)) charging.current = false; },
      // The internet dropped while charging: keep the bill on this device and carry on.
      onError: (e) => { if (isNetworkError(e)) void saveOffline(clientRef, body).then((saved) => { if (!saved) charging.current = false; }); else toast('error', (e as Error).message); },
    });
  };
  /** Keeps the bill on this device, prints its receipt, and lets the counter carry on. Sent automatically later. */
  const saveOffline = async (clientRef: string, body: Record<string, unknown>): Promise<boolean> => {
    if (redeem) { toast('error', 'Points can’t be used offline', 'Loyalty points need the internet to check the balance. Turn points off to bill offline.'); return false; }
    if (lines.some((l) => l.it.trackSerials)) { toast('error', 'This bill needs the internet', 'Items with IMEI / serial numbers are checked online. Bill them when the connection is back.'); return false; }
    const madeAt = new Date().toISOString();
    const fl = promo.on ? priced.lines : applyBillAdjustments(calc, { withGst, pricesIncludeTax: inclusive, billDiscount });
    const receipt: ReceiptData = {
      number: offlineRef(clientRef), date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()), time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      customer: { name: customer ? customer.companyName || customer.name : 'Walk-in customer', phone: customer?.phone, gstin: customer?.gstin },
      lines: lines.map((l, i) => ({ name: l.it.name, description: l.it.description, hsn: l.it.hsn, qty: l.qty, unit: l.it.unit, rate: unit(l.it), mrp: l.it.mrp ?? null, taxRate: l.it.taxRate, amount: lineAmount(fl[i] ?? calc[i]!) })),
      withGst, interState: inter, subTotal: totals.subTotal, discount: totals.discount, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, roundOff: totals.roundOff,
      total: totals.total, amountPaid: totals.total, paymentMode: mode, offers: promo.on ? priced.applied : [],
      note: 'Saved offline. The GST invoice number is given when this bill is sent.',
    };
    try {
      await saveBill({ clientRef, shopId: me.shop.id, userId: me.user.id, madeAt, body, expectedTotal: totals.total, status: 'waiting', attempts: 0,
        summary: { customer: receipt.customer.name, items: lines.length, mode } });
    } catch {
      toast('error', 'Could not save the bill on this device', 'This browser is blocking storage (private window?). Use a normal window to bill offline.');
      return false;
    }
    setOffDone({ ref: receipt.number, receipt, change: mode === 'Cash' && tendered ? Math.max(0, Number(tendered) - totals.total) : 0, phone: customer?.phone });
    return true;
  };
  const reset = () => { charging.current = false; setCart([]); setTendered(''); setReference(''); setCustomerId(''); setDone(null); setOffDone(null); setSplit({ Cash: '', UPI: '', Card: '' }); setDisc({ kind: 'percent', value: 0 }); setSkip([]); setUsePoints({ on: false, points: 0 }); setLastId(''); setUnknown(''); setQ(''); saveDraft(me.shop.id, me.user.id, null); setTimeout(() => scanRef.current?.focus(), 50); };
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  /* Hold a bill (the customer went to fetch something) and serve the next one; recall it later. Kept on this counter. */
  const holdCurrent = () => {
    if (!cart.length) return;
    const who = customer ? customer.companyName || customer.name : 'Walk-in';
    holdBill(me.shop.id, { cart, customerId, disc, mode }, `${who} · ${lines.reduce((n, l) => n + l.qty, 0)} items`, totals.total);
    setHeld(heldBills(me.shop.id));
    reset();
    toast('success', 'Bill held', 'Serve the next customer. F6 on an empty bill brings it back.');
  };
  const recall = (id: string) => {
    if (cart.length) holdCurrent(); // swap: the bill on screen is held first, nothing is lost
    const h = takeHeld(me.shop.id, id);
    setHeld(heldBills(me.shop.id));
    setHeldOpen(false);
    if (!h) return;
    setCart(h.cart.filter((l) => byId.has(l.itemId))); setCustomerId(h.customerId); setDisc(h.disc); setMode(h.mode);
    setLastId(h.cart[h.cart.length - 1]?.itemId ?? '');
    scanRef.current?.focus();
  };
  const [voidAsk, setVoidAsk] = useState(false);
  // Focus moves at once (not after the redraw) so F8 followed instantly by Enter still charges.
  const pickMode = (m: 'Cash' | 'UPI' | 'Card') => {
    setMode(m);
    const go = () => (m === 'Cash' ? (tenderRef.current?.focus(), tenderRef.current?.select()) : chargeRef.current?.focus());
    if (m !== 'Cash' || tenderRef.current) go(); else setTimeout(go, 0);
  };
  const busyDialog = !!(done || offDone || imeiFor || help || heldOpen || voidAsk || showOff);
  useShortcuts({
    'mod+enter': charge,
    end: () => { if (!busyDialog) charge(); },
    f1: () => setHelp(true),
    f2: () => scanRef.current?.focus(),
    f3: () => { const l = lastLine(); if (!l) return; const el = document.querySelector<HTMLInputElement>(`[data-line="${l.itemId}"] input[aria-label="Quantity"]`); el?.focus(); el?.select(); },
    f4: () => { (document.querySelector<HTMLInputElement>('.pos-phone-find input') ?? document.querySelector<HTMLSelectElement>('select[aria-label="Customer"]'))?.focus(); },
    f6: () => { if (busyDialog) return; if (cart.length) holdCurrent(); else if (held.length) setHeldOpen(true); else toast('info', 'No held bills', 'F6 with items on the bill holds it.'); },
    f7: () => { discRef.current?.focus(); discRef.current?.select(); },
    f8: () => pickMode('Cash'),
    f9: () => pickMode('UPI'),
    f10: () => pickMode('Card'),
    'mod+delete': () => { if (cart.length && !busyDialog) setVoidAsk(true); },
  });
  // A USB scanner types into whatever has focus. After the cashier taps a tile or a button nothing is focused, so
  // send stray keys to the scan box instead of losing the scan. Fields, menus and the sale dialog are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The sale's receipt is open: Enter (anywhere but its own buttons) starts the next customer.
      if ((done || offDone) && e.key === 'Enter' && !(e.target as HTMLElement | null)?.closest('button, a, select')) { e.preventDefault(); reset(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key.length !== 1 && e.key !== 'Delete') || done || offDone || document.querySelector('[role=dialog]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
      e.preventDefault();
      scanRef.current?.focus();
      if (e.key === '+' || e.key === '-' || e.key === 'Delete') { onScanKey({ key: e.key, preventDefault: () => {}, currentTarget: scanRef.current } as unknown as React.KeyboardEvent<HTMLInputElement>); return; }
      setQ((v) => v + e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, offDone, q, cart, lastId]);

  return (
    <div className="pos">
      <section className="pos-panel card" style={{ padding: 14 }}>
        {(!online || offBills.waiting.length > 0 || offBills.failed.length > 0) && (
          <div className="pos-offline" role="status">
            <CloudOff size={16} />
            <span style={{ flex: 1 }}>
              {!online ? 'No internet. Keep billing: bills are saved on this device and sent when the connection is back.' : 'Internet is back. Sending bills made offline…'}
              {offBills.waiting.length > 0 && <strong> {offBills.waiting.length} waiting.</strong>}
              {offBills.failed.length > 0 && <strong style={{ color: 'var(--red-700)' }}> {offBills.failed.length} need{offBills.failed.length === 1 ? 's' : ''} attention.</strong>}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowOff(true)}>Offline bills</button>
          </div>
        )}
        <OfflineBillsModal open={showOff} onClose={() => setShowOff(false)} />
        <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
            <span className="lead" style={{ color: 'var(--brand-600)' }}>{q ? <Search size={17} /> : <ScanBarcode size={17} />}</span>
            <input ref={scanRef} className="input" style={{ height: 46, fontSize: 14 }} placeholder="Scan barcode or type to search (F2)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScanKey} aria-label="Scan or search items" autoComplete="off" spellCheck={false} />
          </div>
          <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'Goods', label: 'Goods', icon: Package }, { value: 'Services', label: 'Services', icon: Wrench }]} />
          {scale.supported && (
            <button type="button" className={`btn ${scale.connected ? 'btn-soft' : 'btn-secondary'} scale-btn`} onClick={() => (scale.connected ? void scale.disconnect() : void scale.connect())} title={scale.connected ? 'Disconnect scale' : 'Connect a USB / serial weighing scale'}>
              <Scale size={16} /> {scale.connected ? (scale.reading ? <><strong>{scale.reading.kg.toFixed(3)} kg</strong><span className={`scale-dot ${scale.reading.stable ? 'ok' : ''}`} /></> : 'Waiting for weight…') : 'Scale'}
            </button>
          )}
        </div>
        {unknown && (
          <div className="pos-unknown" role="alert">
            <AlertTriangle size={15} /> <span>Not found: <strong className="mono">{unknown}</strong></span>
            {me.can('items.write') && <Link className="link-btn" to={`/app/items/new?type=Goods${/^[0-9A-Za-z-]{4,}$/.test(unknown) ? `&barcode=${encodeURIComponent(unknown)}` : ''}`}><Plus size={12} /> Add as a new item</Link>}
            <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => { setUnknown(''); focusScan(); }}>×</button>
          </div>
        )}
        <div className="pos-keys no-print" aria-label="Keyboard shortcuts">
          <span><kbd>5*</kbd> qty</span><span><kbd>+</kbd><kbd>−</kbd> last item</span><span><kbd>Del</kbd> remove</span><span><kbd>↵</kbd> pay</span>
          <span><kbd>F4</kbd> customer</span><span><kbd>F6</kbd> hold{held.length ? ` (${held.length})` : ''}</span><span><kbd>F7</kbd> discount</span><span><kbd>F8</kbd> cash <kbd>F9</kbd> UPI <kbd>F10</kbd> card</span>
          <button type="button" className="link-btn small" onClick={() => setHelp(true)}><kbd>F1</kbd> all keys</button>
          <button type="button" className="link-btn small" onClick={() => { setSound(!sound); setBeepOn(!sound); }} title="Beep on every scan">{sound ? 'Beep on' : 'Beep off'}</button>
        </div>
        {aiOn && <div style={{ marginBottom: 12 }}><QuickBill context="pos" onApply={applyQuick} compact /></div>}
        <div className="pos-grid">
          {shown.map((it, i) => {
            const st = branchId ? it.stockByBranch[branchId] ?? 0 : it.stock;
            return (
              <button key={it.id} className={`pos-tile ${searchText && i === hl ? 'hl' : ''}`} onClick={() => { add(it); setQ(''); focusScan(); }} tabIndex={-1}>
                <Thumb name={it.name} image={it.image} size={40} />
                <div className="n">{it.name}</div>
                <div className="small muted">{it.type === 'Goods' ? `${st} ${it.unit} in stock` : 'Service'}</div>
                <div className="p">{money(unit(it))}</div>
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="muted small" style={{ padding: 20 }}>
              No items match “{q}”.
              {me.can('items.write') && q.trim() && <> <Link className="link-btn" to={`/app/items/new?type=Goods${/^[0-9A-Za-z-]{4,}$/.test(q.trim()) ? `&barcode=${encodeURIComponent(q.trim())}` : ''}`}><Plus size={12} /> Add as a new item</Link></>}
            </div>
          )}
        </div>
      </section>

      {lines.length > 0 && (
        <button type="button" className="pos-jump" onClick={() => document.getElementById('pos-bill')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span>{lines.reduce((n, l) => n + l.qty, 0)} item{lines.reduce((n, l) => n + l.qty, 0) === 1 ? '' : 's'} · View bill</span><strong>{money(totals.total)}</strong>
        </button>
      )}
      <section className="pos-panel card" id="pos-bill">
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }} className="stack">
          <div className="row" style={{ gap: 8 }}>
            <UserRound size={16} className="muted" />
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
              <option value="">Walk-in customer</option>
              {pickable(customers, customerId).map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.phone}</option>)}
            </select>
            {promo.loyaltyOn && !customerId && <div className="pos-phone-find"><CustomerByPhone customers={customers} onPick={setCustomerId} /></div>}
            {branches.length > 1 && <select className="select" style={{ width: 160 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          </div>
          <div className="row between small muted">
            <span>Price tier: <strong style={{ color: 'var(--ink-800)' }}>{tier} · {TIER_LABEL[tier]}</strong></span>
            <span className="row" style={{ gap: 14 }}>
              {withGst && <Toggle size="sm" checked={mrp} onChange={setMrp} label={<span className="small">MRP (incl. GST)</span>} />}
              <Toggle size="sm" checked={withGst} disabled={!!org && (org.compositionScheme || !org.gstin)} onChange={setWithGst} label={<span className="small">{withGst ? 'GST applied' : 'Net price (no tax)'}</span>} />
            </span>
          </div>
        </div>
        <div className="pos-cart">
          {lines.length === 0 && <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>Scan an item or tap a tile to start a bill.</div>}
          {lines.map((l, i) => {
            const lo = priced.lineOffers[i];
            // Selling more than the shelf holds is allowed (stock can be entered later), but the cashier should know.
            const have = l.it.type === 'Goods' ? (branchId ? l.it.stockByBranch[branchId] ?? 0 : l.it.stock) : Infinity;
            return (
            <div key={l.itemId} className={`pos-line ${l.itemId === (lastId || lines[lines.length - 1]?.itemId) ? 'last' : ''}`} data-line={l.itemId}>
              <div style={{ minWidth: 0 }}>
                <div className="strong pos-line-name" title={l.it.name}>{l.it.name}</div>
                {l.serials?.length ? (
                  <div className="serial-chips">{l.serials.map((sn) => (
                    <span key={sn} className="serial-chip mono">{sn}<button type="button" aria-label={`Remove ${sn}`} tabIndex={-1} onClick={() => { setCart((c) => c.map((x) => (x.itemId === l.itemId ? { ...x, serials: x.serials!.filter((y) => y !== sn), qty: x.serials!.length - 1 } : x)).filter((x) => x.qty > 0)); focusScan(); }}>×</button></span>
                  ))}</div>
                ) : null}
                <div className="small muted">{money(unit(l.it))}{withGst ? ` · GST ${l.it.taxRate}%${inclusive ? ' incl.' : ''}` : ''}</div>
                {lo && <div className="offer-tags"><span className="offer-tag"><Gift size={11} /> {lo.name} −{lo.value}%</span></div>}
                {l.qty > have && <div className="small" style={{ color: 'var(--amber-700, #a15c07)' }} role="status"><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Only {Math.max(have, 0)} {l.it.unit} in stock</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="qty-btn" tabIndex={-1} onClick={() => { setQty(l.itemId, l.qty - 1); focusScan(); }} aria-label="Decrease">−</button>
                {/* Typed quantity is applied on Enter or when leaving the box, so clearing it to retype never removes the item. */}
                <input key={`${l.itemId}-${l.qty}`} className="input" style={{ width: 56, height: 30, textAlign: 'center', padding: 0 }} type="number" min={0} step="any" defaultValue={l.qty} aria-label="Quantity" readOnly={!!l.serials}
                  title={l.serials ? 'One per IMEI / serial number: scan another to add one' : 'Type the quantity, Enter'}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else { (e.target as HTMLInputElement).value = String(l.qty); focusScan(); } } }}
                  onBlur={(e) => { const n = Number(e.target.value); if (!l.serials && n > 0 && n !== l.qty) setQty(l.itemId, Math.round(n * 1000) / 1000); else e.target.value = String(l.qty); if (e.relatedTarget === null) focusScan(); }} />
                <button className="qty-btn" tabIndex={-1} onClick={() => { if (l.serials) setImeiFor(l.it); else setQty(l.itemId, l.qty + 1); focusScan(); }} aria-label="Increase">+</button>
                {scale.connected && scale.reading && isWeighed(l.it.unit) && <button className="qty-btn" title="Use the scale reading" aria-label="Use weight" onClick={() => setQty(l.itemId, qtyFromReading(scale.reading!.kg, l.it.unit))}><Scale size={13} /></button>}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <strong style={{ minWidth: 80, textAlign: 'right' }}>
                  {lo && <div className="small muted" style={{ textDecoration: 'line-through', fontWeight: 400 }}>{money(lineAmount({ qty: l.qty, rate: unit(l.it), taxRate: 0 }))}</div>}
                  {money(lineAmount({ qty: l.qty, rate: unit(l.it), taxRate: 0, discount: lo ? lo.value : 0 }))}
                </strong>
                <button className="icon-btn sm danger" tabIndex={-1} onClick={() => { setQty(l.itemId, 0); focusScan(); }} aria-label="Remove"><Trash2 size={13} /></button>
              </div>
            </div>
            );
          })}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)', background: 'var(--ink-50)' }} className="stack pos-pay">
          <div className="row between small" style={{ gap: 8 }}>
            <span className="muted row" style={{ gap: 6 }}><Tag size={13} /> Bill discount</span>
            <span className="row" style={{ gap: 4 }}>
              <input ref={discRef} className="input" type="number" min={0} step="any" style={{ width: 80, height: 30 }} aria-label="Bill discount" value={disc.value || ''} placeholder="0" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goPay(); } }}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDisc({ ...disc, value: disc.kind === 'percent' ? Math.min(100, v) : v }); }} />
              <select className="select" style={{ width: 58, height: 30 }} aria-label="Bill discount type" value={disc.kind} onChange={(e) => setDisc({ ...disc, kind: e.target.value as BillDiscount['kind'] })}><option value="percent">%</option><option value="amount">₹</option></select>
            </span>
          </div>
          {promo.on && <OffersSummary applied={priced.applied} offers={promo.offers} skipped={skip} onSkip={(id) => setSkip((x) => [...x, id])} onUndo={(id) => setSkip((x) => x.filter((y) => y !== id))} />}
          {promo.loyaltyOn && customer && <PointsBox settings={promo.settings} balance={promo.balance} payable={payable(pricedBase.lines, withGst)} use={usePoints.on} points={usePoints.points} onChange={(on, points) => setUsePoints({ on, points })} earn={willEarn} />}
          {totals.discount > 0.004 && (
            <>
              <div className="row between small"><span className="muted">Sub total</span><span>{money(Math.round((totals.subTotal + totals.discount) * 100) / 100)}</span></div>
              <div className="row between small"><span className="muted">Discount</span><span>− {money(totals.discount)}</span></div>
            </>
          )}
          <div className="row between small"><span className="muted">{withGst && (inclusive || totals.discount > 0.004) ? 'Taxable value' : 'Sub total'}</span><span>{money(totals.subTotal)}</span></div>
          {withGst && <div className="row between small"><span className="muted">GST{inter ? ' (IGST)' : ' (CGST + SGST)'}</span><span>{money(totals.taxTotal)}</span></div>}
          <div className="row between"><strong style={{ fontSize: 14 }}>Total</strong><strong style={{ fontSize: 24, color: 'var(--brand-700)' }}>{money(totals.total)}</strong></div>
          <div className="pay-modes">
            {([['Cash', Banknote, 'F8'], ['UPI', Smartphone, 'F9'], ['Card', CreditCard, 'F10'], ['Split', Split, '']] as const).map(([m, I, k]) => <button key={m} className={mode === m ? 'active' : ''} tabIndex={-1} onClick={() => (m === 'Split' ? setMode(m) : pickMode(m))} title={k ? `${m} (${k})` : m} aria-label={m}><I size={16} /> {m}{k && <kbd className="pm-key" aria-hidden="true">{k}</kbd>}</button>)}
          </div>
          {mode === 'Split' && (
            <div className="split-pay">
              {([['Cash', Banknote], ['UPI', Smartphone], ['Card', CreditCard]] as const).map(([m, I]) => (
                <div key={m} className="split-row">
                  <span className="row" style={{ gap: 6, width: 70 }}><I size={15} /> {m}</span>
                  <div className="input-addon" style={{ flex: 1 }}><span>₹</span><input className="input" type="number" min={0} step="any" aria-label={`${m} amount`} value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value })} /></div>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => fillRest(m)}>Rest</button>
                </div>
              ))}
              <div className={`small strong ${Math.abs(splitLeft) <= 0.5 ? 'ok' : 'due'}`}>{Math.abs(splitLeft) <= 0.5 ? 'Fully paid' : splitLeft > 0 ? `${money(splitLeft)} still to collect` : `${money(-splitLeft)} more than the bill`}</div>
              {qr && <div className="row" style={{ gap: 10 }}><img src={qr} alt="UPI QR" style={{ width: 84, height: 84, borderRadius: 8, background: '#fff', padding: 4 }} /><span className="small muted">Scan to pay {money(upiDue)} by UPI</span></div>}
            </div>
          )}
          {mode === 'Cash' && lines.length > 0 && (
            <div className="cash-quick" aria-label="Amount given">
              {cashSuggestions(totals.total).map((v) => <button key={v} type="button" tabIndex={-1} className={`btn btn-soft btn-sm ${Number(tendered) === v ? 'active' : ''}`} onClick={() => { setTendered(String(v)); chargeRef.current?.focus(); }}>{v === Math.ceil(totals.total) ? 'Exact' : money(v).replace('.00', '')}</button>)}
            </div>
          )}
          {mode === 'Cash' && (
            <div className="row" style={{ gap: 10 }}>
              <Field label="Cash tendered (F8)" className=""><div className="input-addon"><span>₹</span><input ref={tenderRef} className="input" type="number" min={0} value={tendered} aria-label="Cash tendered" onChange={(e) => setTendered(e.target.value)} placeholder={String(totals.total)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); charge(); } else if (e.key === 'Escape') { e.preventDefault(); focusScan(); } }} /></div></Field>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div className="small muted">Change</div><div style={{ fontWeight: 600, fontSize: 16, color: change < 0 ? 'var(--red-600)' : 'var(--green-700)' }}>{tendered ? money(change) : '—'}</div></div>
            </div>
          )}
          {mode === 'UPI' && (
            <div className="row" style={{ gap: 12 }}>
              {qr ? <img src={qr} alt="UPI QR" style={{ width: 96, height: 96, borderRadius: 8, background: '#fff', padding: 4 }} /> : <div className="small muted">{org?.upiId ? 'Add items to show the QR.' : 'Add a UPI ID in Organization profile to show a payment QR.'}</div>}
              <Field label="UPI reference (optional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR" /></Field>
            </div>
          )}
          {mode === 'Card' && <Field label="Card slip / approval no. (optional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
          <button ref={chargeRef} className="btn btn-primary btn-lg btn-block pos-charge" disabled={!lines.length || sale.isPending} onClick={charge} title="Enter in the scan box, then Enter again · End · Ctrl+Enter">
            {sale.isPending ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />} Charge {money(totals.total)}
          </button>
        </div>
      </section>

      <Modal open={!!done} onClose={reset} title="Sale complete" subtitle={done ? `${done.invoice.number} · ${done.invoice.paymentStatus}` : ''}
        footer={
          <>
            {done && done.invoice.customer.phone && org && (
              <a className="btn btn-secondary" target="_blank" rel="noreferrer" href={waLink(done.invoice.customer.phone, `Thank you for shopping at ${org.companyName}! Bill ${done.invoice.number}: ${money(done.invoice.total)}. ${done.invoice.publicToken ? `${window.location.origin}/share/${done.invoice.publicToken}` : ''}`)}><MessageCircle size={15} /> WhatsApp bill</a>
            )}
            <Segmented value={receiptCfg.paper} onChange={setRoll} options={[{ value: '2in', label: '58mm' }, { value: '3in', label: '80mm' }]} />
            <button className="btn btn-secondary" onClick={() => printReceipt(receiptCfg)}><Printer size={15} /> Print receipt</button>
            <button className="btn btn-primary" onClick={reset} autoFocus><Plus size={15} /> New sale</button>
          </>
        }>
        {done && org && (
          <div className="print-area">
            {done.change > 0 && <div className="row no-print" style={{ justifyContent: 'center', gap: 8, marginBottom: 12, fontSize: 16 }}>Give change: <strong style={{ color: 'var(--green-700)', fontSize: 20 }}>{money(done.change)}</strong></div>}
            <div className="receipt-frame">
              <ThermalReceipt data={receiptFromInvoice(done.invoice, items, customers.find((c) => c.id === done.invoice.customerId)?.due, mode === 'Split' ? 'Split' : mode)} org={org} s={receiptCfg} />
            </div>
          </div>
        )}
      </Modal>

      <ImeiPrompt item={imeiFor} onClose={() => { setImeiFor(null); focusScan(); }}
        onSubmit={(it, sn) => { setImeiFor(null); scanRef.current?.focus(); void addByImei(sn, it); }} />

      <Modal open={heldOpen} onClose={() => { setHeldOpen(false); focusScan(); }} title="Held bills" subtitle="On this counter. Press a number or Enter to bring one back.">
        <HeldList bills={held} onPick={recall} onDrop={(id) => { takeHeld(me.shop.id, id); setHeld(heldBills(me.shop.id)); }} />
      </Modal>

      <Modal open={voidAsk} onClose={() => { setVoidAsk(false); focusScan(); }} title="Clear this bill?" subtitle="All items on the bill are removed. Nothing has been charged."
        footer={<><button className="btn btn-secondary" onClick={() => { setVoidAsk(false); focusScan(); }}>Keep the bill</button><button className="btn btn-danger" autoFocus onClick={() => { setVoidAsk(false); reset(); }}>Clear bill</button></>}>
        <p className="muted">{lines.length} item{lines.length === 1 ? '' : 's'} · {money(totals.total)}</p>
      </Modal>

      <Modal open={help} onClose={() => { setHelp(false); focusScan(); }} size="lg" title="Counter keys" subtitle="Billing works with the scanner and keyboard alone, online or offline.">
        <div className="keys-help">
          {[
            ['Scan / type a code, Enter', 'Adds the item (barcode, SKU or a phone’s IMEI)'],
            ['5* then scan (or 5x)', 'Five of it. 2.5*TOMATO for loose items'],
            ['*5, Enter', 'Make the last item five'],
            ['+  /  −', 'One more / one less of the last item (box empty)'],
            ['Delete', 'Remove the last item (box empty)'],
            ['Type a name, ↑ ↓ ← →, Enter', 'Pick from the matches'],
            ['Esc', 'Clear what is typed'],
            ['Enter on an empty box', 'Go to payment: cash amount (Cash) or Charge'],
            ['Enter in cash amount', 'Charge'],
            ['End  /  Ctrl+Enter', 'Charge now'],
            ['Enter after the sale', 'New sale'],
            ['F2', 'Back to the scan box'],
            ['F3', 'Change the last item’s quantity (type, Enter)'],
            ['F4', 'Customer (mobile number or list)'],
            ['F6', 'Hold this bill / bring back a held one'],
            ['F7', 'Bill discount'],
            ['F8  F9  F10', 'Cash · UPI · Card'],
            ['Ctrl+Delete', 'Clear the whole bill'],
            ['F1', 'This list'],
          ].map(([k, v]) => <div key={k} className="keys-row"><kbd>{k}</kbd><span>{v}</span></div>)}
        </div>
      </Modal>

      <Modal open={!!offDone} onClose={reset} title="Sale saved offline" subtitle={offDone ? `${offDone.ref} · kept on this device, sent when the internet is back` : ''}
        footer={
          <>
            <Segmented value={receiptCfg.paper} onChange={setRoll} options={[{ value: '2in', label: '58mm' }, { value: '3in', label: '80mm' }]} />
            <button className="btn btn-secondary" onClick={() => printReceipt(receiptCfg)}><Printer size={15} /> Print receipt</button>
            <button className="btn btn-primary" onClick={reset} autoFocus><Plus size={15} /> New sale</button>
          </>
        }>
        {offDone && org && (
          <div className="print-area">
            <div className="pos-offline no-print"><CloudOff size={16} /> No internet. This bill is safe on this device and will be saved with its GST invoice number automatically.</div>
            {offDone.change > 0 && <div className="row no-print" style={{ justifyContent: 'center', gap: 8, marginBottom: 12, fontSize: 16 }}>Give change: <strong style={{ color: 'var(--green-700)', fontSize: 20 }}>{money(offDone.change)}</strong></div>}
            <div className="receipt-frame"><ThermalReceipt data={offDone.receipt} org={org} s={receiptCfg} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Scan (or type) the IMEI / serial number of the phone whose box was just scanned. Enter closes it at once and the
 * number is checked in the background, so the next scan from the scanner is never lost while the check runs.
 */
function ImeiPrompt({ item, onClose, onSubmit }: { item: Item | null; onClose: () => void; onSubmit: (it: Item, serial: string) => void }) {
  const [v, setV] = useState('');
  useEffect(() => { setV(''); }, [item?.id]);
  return (
    <Modal open={!!item} onClose={onClose} title="Scan the IMEI / serial number" subtitle={item ? `${item.name} · each unit is billed by its number` : ''}>
      <Field label="IMEI / serial number" hint="Scan the box or the phone, or type it and press Enter. Esc to cancel.">
        <input className="input mono" autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label="IMEI or serial number" autoComplete="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const sn = v.replace(/\s+/g, ''); if (item && sn) onSubmit(item, sn); } }} />
      </Field>
    </Modal>
  );
}

/** Held bills on this counter: number keys or arrows + Enter to bring one back. */
function HeldList({ bills, onPick, onDrop }: { bills: HeldBill[]; onPick: (id: string) => void; onDrop: (id: string) => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key) && bills[Number(e.key) - 1]) { e.preventDefault(); onPick(bills[Number(e.key) - 1]!.id); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(bills.length - 1, x + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
      else if (e.key === 'Enter' && bills[i]) { e.preventDefault(); onPick(bills[i]!.id); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [bills, i, onPick]);
  if (!bills.length) return <p className="muted">No held bills.</p>;
  return (
    <div className="held-list">
      {bills.map((b, n) => (
        <div key={b.id} className={`held-row ${n === i ? 'hl' : ''}`}>
          <button type="button" className="held-pick" onClick={() => onPick(b.id)}>
            <kbd>{n + 1}</kbd><span className="strong">{b.label}</span><span className="muted small">held {new Date(b.heldAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span><strong>{money(b.total)}</strong>
          </button>
          <button type="button" className="icon-btn sm danger" aria-label="Remove held bill" onClick={() => onDrop(b.id)}><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}
