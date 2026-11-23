import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IndianRupee } from 'lucide-react';
import { formatQty, isMeasured, parseQty, qtyForAmount, quickQtys, roundQty, subUnit, wholeOnly } from '../../shared/units';
import '@/styles/qty.css';

/**
 * Quantity box that knows the item's unit. Pieces take whole numbers; loose goods take what people say:
 * "200g", "half", "1/2", "1.25". The unit shows inside the box, and the amount reads back in words (200 g).
 */
export function QtyInput({ value, unit, onChange, onKeyDown, invalid, label = 'Quantity' }: {
  value: number; unit: string; onChange: (q: number) => void; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; invalid?: boolean; label?: string;
}) {
  const [text, setText] = useState(String(value));
  const [err, setErr] = useState('');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(roundQty(value))); }, [value]);
  const commit = (raw = text) => {
    if (!raw.trim()) { setText(String(value)); setErr(''); return; }
    const r = parseQty(raw, unit || 'pcs');
    if ('error' in r) { setErr(r.error); return; }
    setErr(''); setText(String(r.qty));
    if (r.qty !== value) onChange(r.qty);
  };
  const measured = isMeasured(unit);
  const sub = subUnit(unit);
  return (
    <div className="qty-box">
      <div className={`qty-field ${err || invalid ? 'invalid' : ''}`}>
        <input className="input" value={text} aria-label={label} aria-invalid={!!err} inputMode={wholeOnly(unit) ? 'numeric' : 'decimal'} autoComplete="off"
          title={measured ? `Type 1.5, 200${sub?.name ?? ''}, half or 1/2` : undefined}
          onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
          onChange={(e) => { setText(e.target.value); setErr(''); const r = parseQty(e.target.value, unit || 'pcs'); if ('qty' in r && /^\d+(\.\d*)?$/.test(e.target.value.trim())) onChange(r.qty); }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const step = measured ? (value < 1 ? 0.05 : 0.25) : 1; const n = roundQty(Math.max(step, value + (e.key === 'ArrowUp' ? step : -step))); onChange(n); setText(String(n)); } onKeyDown?.(e); }} />
        {unit && <span className="qty-unit">{unit}</span>}
      </div>
      {err ? <div className="qty-err" role="alert">{err}</div> : measured && value > 0 && value < 1 && sub ? <div className="qty-read">{formatQty(value, unit)}</div> : null}
    </div>
  );
}

/** One-tap amounts (250 g, 500 g, 1 kg…) and "₹ worth" for loose goods, shown under the item on a bill line. */
export function LooseQtyHelper({ unit, rate, taxRate, rateIncludesTax, value, onChange }: {
  unit: string; rate: number; taxRate: number; rateIncludesTax: boolean; value: number; onChange: (q: number) => void;
}) {
  const [worth, setWorth] = useState<string | null>(null);
  if (!isMeasured(unit)) return null;
  const chips = quickQtys(unit);
  const apply = () => {
    const amt = Number(worth);
    const q = qtyForAmount(amt, rate, taxRate, rateIncludesTax);
    if (q > 0) onChange(q);
    setWorth(null);
  };
  return (
    <div className="loose-help">
      {chips.map((c) => <button key={c.label} type="button" className={`loose-chip ${Math.abs(value - c.qty) < 0.0005 ? 'on' : ''}`} onClick={() => onChange(c.qty)}>{c.label}</button>)}
      {worth === null ? (
        <button type="button" className="loose-chip" onClick={() => setWorth('')} title="The customer asks for an amount, e.g. ₹50 of carrots"><IndianRupee size={11} /> worth</button>
      ) : (
        <span className="loose-worth">
          ₹<input autoFocus inputMode="decimal" value={worth} aria-label="Amount the customer wants" placeholder="50" onChange={(e) => setWorth(e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') setWorth(null); }} onBlur={() => (worth ? apply() : setWorth(null))} />
          {Number(worth) > 0 && rate > 0 && <span className="muted">= {formatQty(qtyForAmount(Number(worth), rate, taxRate, rateIncludesTax), unit)}</span>}
        </span>
      )}
    </div>
  );
}
