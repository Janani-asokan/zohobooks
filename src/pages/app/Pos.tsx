import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Search, Trash2, Banknote, Smartphone, CreditCard, Loader2, Printer, MessageCircle, Plus, CheckCircle2, Package, Wrench, UserRound } from 'lucide-react';
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
import { computeTotals, lineAmount } from '@/lib/calc';
import { money } from '@/lib/format';
import { isInterState } from '../../../shared/gst';
import { waLink } from './InvoiceView';

interface CartLine { itemId: string; qty: number }
const price = (it: Item, tier: PriceTier) => (tier === 'SP1' ? it.sp1 : tier === 'SP2' ? it.sp2 : it.sp3);

/** Fast counter billing: scan → cart → charge. Each sale is an issued invoice with its payment. */
export default function Pos() {
  const me = useShopUser();
  const toast = useToast();
  const { data: items = [] } = useItems();
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
  const [mode, setMode] = useState<'Cash' | 'UPI' | 'Card'>('Cash');
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
  const calc = lines.map((l) => ({ qty: l.qty, rate: price(l.it, tier), taxRate: l.it.taxRate, discount: 0 }));
  const inter = !!org && !!customer && isInterState(org.state, customer.state || org.state);
  const totals = computeTotals(calc, withGst, inter);
  const change = mode === 'Cash' && tendered ? Number(tendered) - totals.total : 0;
  const qr = useQr(mode === 'UPI' && org?.upiId && totals.total > 0 ? upiLink(org, totals.total, 'POS sale') : null);

  const add = (it: Item) => setCart((c) => (c.some((l) => l.itemId === it.id) ? c.map((l) => (l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { itemId: it.id, qty: 1 }]));
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l.itemId !== id) : c.map((l) => (l.itemId === id ? { ...l, qty } : l))));

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
    sale.mutate(
      { customerId: customerId || null, branchId: branchId || null, withGst, mode, reference, tendered: mode === 'Cash' && tendered ? Number(tendered) : undefined, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, tier, discount: 0 })) },
      { onSuccess: (r) => setDone(r) },
    );
  };
  const reset = () => { setCart([]); setTendered(''); setReference(''); setCustomerId(''); setDone(null); setTimeout(() => scanRef.current?.focus(), 50); };
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
        <div className="pos-grid">
          {shown.map((it) => {
            const st = branchId ? it.stockByBranch[branchId] ?? 0 : it.stock;
            return (
              <button key={it.id} className="pos-tile" onClick={() => add(it)}>
                <div className="n">{it.name}</div>
                <div className="small muted">{it.type === 'Goods' ? `${st} ${it.unit} in stock` : 'Service'}</div>
                <div className="p">{money(price(it, tier))}</div>
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
            <Toggle size="sm" checked={withGst} disabled={!!org && (org.compositionScheme || !org.gstin)} onChange={setWithGst} label={<span className="small">{withGst ? 'GST applied' : 'Net price (no tax)'}</span>} />
          </div>
        </div>
        <div className="pos-cart">
          {lines.length === 0 && <div className="muted small" style={{ padding: 24, textAlign: 'center' }}>Scan an item or tap a tile to start a bill.</div>}
          {lines.map((l) => (
            <div key={l.itemId} className="pos-line">
              <div style={{ minWidth: 0 }}>
                <div className="strong" style={{ color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.it.name}</div>
                <div className="small muted">{money(price(l.it, tier))}{withGst ? ` · GST ${l.it.taxRate}%` : ''}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="qty-btn" onClick={() => setQty(l.itemId, l.qty - 1)} aria-label="Decrease">−</button>
                <input className="input" style={{ width: 56, height: 30, textAlign: 'center', padding: 0 }} type="number" value={l.qty} onChange={(e) => setQty(l.itemId, Number(e.target.value))} aria-label="Quantity" />
                <button className="qty-btn" onClick={() => setQty(l.itemId, l.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <strong style={{ minWidth: 80, textAlign: 'right' }}>{money(lineAmount({ qty: l.qty, rate: price(l.it, tier), taxRate: 0 }))}</strong>
                <button className="icon-btn sm danger" onClick={() => setQty(l.itemId, 0)} aria-label="Remove"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)', background: 'var(--ink-50)' }} className="stack">
          <div className="row between small"><span className="muted">Sub total</span><span>{money(totals.subTotal)}</span></div>
          {withGst && <div className="row between small"><span className="muted">GST{inter ? ' (IGST)' : ' (CGST + SGST)'}</span><span>{money(totals.taxTotal)}</span></div>}
          <div className="row between"><strong style={{ fontSize: 14 }}>Total</strong><strong style={{ fontSize: 24, color: 'var(--brand-700)' }}>{money(totals.total)}</strong></div>
          <div className="pay-modes">
            {([['Cash', Banknote], ['UPI', Smartphone], ['Card', CreditCard]] as const).map(([m, I]) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}><I size={16} /> {m}</button>)}
          </div>
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
              <ThermalReceipt data={receiptFromInvoice(done.invoice, items, customers.find((c) => c.id === done.invoice.customerId)?.due, mode)} org={org} s={printCfg.thermal} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
