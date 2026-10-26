import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Search, Trash2, Banknote, Smartphone, CreditCard, Loader2, Printer, MessageCircle, Plus, CheckCircle2, Package, Wrench, UserRound, Split, Tag } from 'lucide-react';
import { api } from '@/api/client';
import { SALES_KEYS, useBranches, useCustomers, useItems, useMut, useOrg, usePrintSettings } from '@/api/hooks';
import { ThermalReceipt, printReceipt, receiptFromInvoice } from '@/components/printing';
import { withPrintDefaults } from '../../../shared/printSettings';
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
import { Thumb } from '@/components/kit';
import { money } from '@/lib/format';
import { isInterState } from '../../../shared/gst';
import { waLink } from './InvoiceView';

interface CartLine { itemId: string; qty: number }

/** Fast counter billing: scan → cart → charge. Each sale is an issued invoice with its payment. */
export default function Pos() {
  const me = useShopUser();
  const toast = useToast();
  const items = (useItems().data ?? []).filter((i) => !i.isGroup);
  const { data: customers = [] } = useCustomers();
  const branches = useBranches().data ?? [];
  const org = useOrg().data;
  const printCfg = withPrintDefaults(usePrintSettings().data);
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
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!branchId && branches.length) setBranchId(branches.find((b) => b.isPrimary)?.id ?? branches[0]!.id); }, [branches, branchId]);
  useEffect(() => { if (org && (org.compositionScheme || !org.gstin)) setWithGst(false); }, [org]);
  useEffect(() => { scanRef.current?.focus(); }, []);

  const customer = customers.find((c) => c.id === customerId);
  const tier: PriceTier = customer?.tier ?? 'SP1';
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = cart.map((l) => ({ ...l, it: byId.get(l.itemId)! })).filter((l) => l.it);
  const inclusive = withGst && mrp;
  const unit = (it: Item) => priceFor(it, tier, inclusive);
  const calc = lines.map((l) => ({ qty: l.qty, rate: unit(l.it), taxRate: l.it.taxRate, discount: 0 }));
  const inter = !!org && !!customer && isInterState(org.state, customer.state || org.state);
  const billDiscount = disc.value > 0 ? disc : null;
  const totals = computeTotals(applyBillAdjustments(calc, { withGst, pricesIncludeTax: inclusive, billDiscount }), withGst, inter);
  const change = mode === 'Cash' && tendered ? Number(tendered) - totals.total : 0;
  const splitPaid = (['Cash', 'UPI', 'Card'] as const).reduce((a, m) => a + (Number(split[m]) || 0), 0);
  const splitLeft = Math.round((totals.total - splitPaid) * 100) / 100;
  /** Fill the remaining amount into one part with a tap. */
  const fillRest = (m: 'Cash' | 'UPI' | 'Card') => setSplit((sp) => ({ ...sp, [m]: String(Math.max(0, Math.round((totals.total - (['Cash', 'UPI', 'Card'] as const).filter((x) => x !== m).reduce((a, x) => a + (Number(sp[x]) || 0), 0)) * 100) / 100)) }));
  const upiDue = mode === 'Split' ? Number(split.UPI) || 0 : totals.total;
  const qr = useQr((mode === 'UPI' || (mode === 'Split' && upiDue > 0)) && org?.upiId && upiDue > 0 ? upiLink(org, upiDue, 'POS sale') : null);

  const add = (it: Item) => setCart((c) => (c.some((l) => l.itemId === it.id) ? c.map((l) => (l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { itemId: it.id, qty: 1 }]));
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.itemId !== id) : c.map((l) => (l.itemId === id ? { ...l, qty } : l))));

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
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (kind === 'all' || i.type === kind) && (!s || [i.name, i.sku, i.barcode].some((v) => v.toLowerCase().includes(s)))).slice(0, 60);
  }, [items, q, kind]);

  const onScanEnter = () => {
    const code = q.trim();
    if (!code) return;
    const exact = items.find((i) => i.barcode === code || (i.sku && i.sku.toLowerCase() === code.toLowerCase()));
    const target = exact ?? (shown.length === 1 ? shown[0] : undefined);
    if (target) { add(target); setQ(''); }
    else toast('error', 'No item matches', code);
  };

  const sale = useMut((b: Record<string, unknown>) => api.post<{ invoice: Invoice; change: number }>('/shop/pos/sale', b), SALES_KEYS, {});
  const charge = () => {
    if (!lines.length || sale.isPending) return;
    if (mode === 'Cash' && tendered && Number(tendered) < totals.total) return toast('error', 'Cash tendered is less than the bill total');
    const parts = (['Cash', 'UPI', 'Card'] as const).filter((m) => Number(split[m]) > 0).map((m) => ({ mode: m, amount: Number(split[m]), reference: m === 'Cash' ? '' : reference }));
    if (mode === 'Split' && (parts.length < 2 || Math.abs(splitLeft) > 0.5)) return toast('error', parts.length < 2 ? 'Enter at least two payment parts' : splitLeft > 0 ? `₹${splitLeft} still to collect` : `Parts are ₹${-splitLeft} more than the bill`);
    sale.mutate(
      { customerId: customerId || null, branchId: branchId || null, withGst, mode: mode === 'Split' ? 'Cash' : mode, reference, tendered: mode === 'Cash' && tendered ? Number(tendered) : undefined,
        ...(mode === 'Split' ? { split: parts } : {}), pricesIncludeTax: inclusive, billDiscount,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, tier, discount: 0, rate: unit(l.it) })) },
      { onSuccess: (r) => setDone(r) },
    );
  };
  const reset = () => { setCart([]); setTendered(''); setReference(''); setCustomerId(''); setDone(null); setSplit({ Cash: '', UPI: '', Card: '' }); setDisc({ kind: 'percent', value: 0 }); setTimeout(() => scanRef.current?.focus(), 50); };
  useShortcuts({ 'mod+enter': charge, f2: () => scanRef.current?.focus() });

  return (
    <div className="pos">
      <section className="pos-panel card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
            <span className="lead" style={{ color: 'var(--brand-600)' }}>{q ? <Search size={17} /> : <ScanBarcode size={17} />}</span>
            <input ref={scanRef} className="input" style={{ height: 46, fontSize: 14 }} placeholder="Scan barcode or type to search (F2)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onScanEnter()} aria-label="Scan or search items" />
          </div>
          <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'Goods', label: 'Goods', icon: Package }, { value: 'Services', label: 'Services', icon: Wrench }]} />
        </div>
        {aiOn && <div style={{ marginBottom: 12 }}><QuickBill context="pos" onApply={applyQuick} compact /></div>}
        <div className="pos-grid">
          {shown.map((it) => {
            const st = branchId ? it.stockByBranch[branchId] ?? 0 : it.stock;
            return (
              <button key={it.id} className="pos-tile" onClick={() => add(it)}>
                <Thumb name={it.name} image={it.image} size={40} />
                <div className="n">{it.name}</div>
                <div className="small muted">{it.type === 'Goods' ? `${st} ${it.unit} in stock` : 'Service'}</div>
                <div className="p">{money(unit(it))}</div>
              </button>
            );
          })}
          {shown.length === 0 && <div className="muted small" style={{ padding: 20 }}>No items match “{q}”.</div>}
        </div>
      </section>

      <section className="pos-panel card">
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }} className="stack">
          <div className="row" style={{ gap: 8 }}>
            <UserRound size={16} className="muted" />
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
              <option value="">Walk-in customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.phone}</option>)}
            </select>
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
          {lines.map((l) => (
            <div key={l.itemId} className="pos-line">
              <div style={{ minWidth: 0 }}>
                <div className="strong" style={{ color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.it.name}</div>
                <div className="small muted">{money(unit(l.it))}{withGst ? ` · GST ${l.it.taxRate}%${inclusive ? ' incl.' : ''}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="qty-btn" onClick={() => setQty(l.itemId, l.qty - 1)} aria-label="Decrease">−</button>
                <input className="input" style={{ width: 56, height: 30, textAlign: 'center', padding: 0 }} type="number" value={l.qty} onChange={(e) => setQty(l.itemId, Number(e.target.value))} aria-label="Quantity" />
                <button className="qty-btn" onClick={() => setQty(l.itemId, l.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <strong style={{ minWidth: 80, textAlign: 'right' }}>{money(lineAmount({ qty: l.qty, rate: unit(l.it), taxRate: 0 }))}</strong>
                <button className="icon-btn sm danger" onClick={() => setQty(l.itemId, 0)} aria-label="Remove"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)', background: 'var(--ink-50)' }} className="stack">
          <div className="row between small" style={{ gap: 8 }}>
            <span className="muted row" style={{ gap: 6 }}><Tag size={13} /> Bill discount</span>
            <span className="row" style={{ gap: 4 }}>
              <input className="input" type="number" min={0} step="any" style={{ width: 80, height: 30 }} aria-label="Bill discount" value={disc.value || ''} placeholder="0"
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDisc({ ...disc, value: disc.kind === 'percent' ? Math.min(100, v) : v }); }} />
              <select className="select" style={{ width: 58, height: 30 }} aria-label="Bill discount type" value={disc.kind} onChange={(e) => setDisc({ ...disc, kind: e.target.value as BillDiscount['kind'] })}><option value="percent">%</option><option value="amount">₹</option></select>
            </span>
          </div>
          <div className="row between small"><span className="muted">{inclusive ? 'Taxable value' : 'Sub total'}{totals.discount > 0 ? ' (after discount)' : ''}</span><span>{money(totals.subTotal)}</span></div>
          {withGst && <div className="row between small"><span className="muted">GST{inter ? ' (IGST)' : ' (CGST + SGST)'}</span><span>{money(totals.taxTotal)}</span></div>}
          <div className="row between"><strong style={{ fontSize: 14 }}>Total</strong><strong style={{ fontSize: 24, color: 'var(--brand-700)' }}>{money(totals.total)}</strong></div>
          <div className="pay-modes">
            {([['Cash', Banknote], ['UPI', Smartphone], ['Card', CreditCard], ['Split', Split]] as const).map(([m, I]) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}><I size={16} /> {m}</button>)}
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
          {mode === 'Cash' && (
            <div className="row" style={{ gap: 10 }}>
              <Field label="Cash tendered" className=""><div className="input-addon"><span>₹</span><input className="input" type="number" min={0} value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(totals.total)} /></div></Field>
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
          <button className="btn btn-primary btn-lg btn-block" disabled={!lines.length || sale.isPending} onClick={charge} title="Ctrl Enter">
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
            <button className="btn btn-secondary" onClick={() => printReceipt(printCfg.thermal)}><Printer size={15} /> Print receipt</button>
            <button className="btn btn-primary" onClick={reset} autoFocus><Plus size={15} /> New sale</button>
          </>
        }>
        {done && org && (
          <div className="print-area">
            {done.change > 0 && <div className="row" style={{ justifyContent: 'center', gap: 8, marginBottom: 12, fontSize: 16 }}>Give change: <strong style={{ color: 'var(--green-700)', fontSize: 20 }}>{money(done.change)}</strong></div>}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', width: 'fit-content', margin: '0 auto' }}>
              <ThermalReceipt data={receiptFromInvoice(done.invoice, items, customers.find((c) => c.id === done.invoice.customerId)?.due, mode === 'Split' ? 'Split' : mode)} org={org} s={printCfg.thermal} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
