import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import { Modal } from './ui';
import { money } from '@/lib/format';

/** Is this a touch screen (tablet or phone at the counter)? Touch counters get the on-screen pad by default. */
export const isTouchCounter = () => { try { const v = localStorage.getItem('c360.pos.keypad'); if (v) return v === '1'; } catch { /* private mode */ } return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches; };
export const setTouchCounter = (on: boolean) => { try { localStorage.setItem('c360.pos.keypad', on ? '1' : '0'); } catch { /* private mode */ } };

/**
 * A big on-screen number pad for tablets and phones at the counter (quantity, cash given, discount), so billing
 * needs no keyboard. A physical keyboard still works while it is open (digits, ., Backspace, Enter, Esc).
 */
export function NumPad({ open, title, initial, decimals = true, quick, onDone, onClose }: {
  open: boolean; title: string; initial: string; decimals?: boolean; quick?: number[]; onDone: (v: string) => void; onClose: () => void;
}) {
  const [v, setV] = useState('');
  const [fresh, setFresh] = useState(true);
  useEffect(() => { if (open) { setV(initial); setFresh(true); } }, [open, initial]);
  const press = (k: string) => {
    if (k === 'back') { setFresh(false); return setV((x) => x.slice(0, -1)); }
    if (k === 'clear') { setFresh(false); return setV(''); }
    if (k === '.' && (!decimals || (!fresh && v.includes('.')))) return;
    // The first key replaces the shown value (like a calculator); after that keys add on.
    setV((x) => { const base = fresh ? '' : x; const n = (base + k).replace(/^0+(?=\d)/, ''); return n.length > 10 ? base : n; });
    setFresh(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
      else if (e.key === 'Enter') { e.preventDefault(); onDone(v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimals ? '.' : 'clear', '0', 'back'];
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="numpad">
        <div className="numpad-show" aria-live="polite">{v || '0'}</div>
        {quick && quick.length > 0 && (
          <div className="numpad-quick">{quick.map((q) => <button key={q} type="button" className="btn btn-soft" onClick={() => onDone(String(q))}>{money(q).replace('.00', '')}</button>)}</div>
        )}
        <div className="numpad-keys">
          {keys.map((k) => (
            <button key={k} type="button" className={`numpad-key ${k === 'back' || k === 'clear' ? 'fn' : ''}`} onClick={() => press(k)} aria-label={k === 'back' ? 'Delete digit' : k === 'clear' ? 'Clear' : k}>
              {k === 'back' ? <Delete size={20} /> : k === 'clear' ? 'C' : k}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onDone(v)}>OK</button>
      </div>
    </Modal>
  );
}
