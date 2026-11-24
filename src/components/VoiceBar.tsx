import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, HelpCircle, Loader2, Mic, MicOff, Undo2 } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { engineLangs, speechEngine, startListening, type Listening } from '@/lib/speech';
import { parseVoice, type VoiceItem } from '../../shared/voiceParse';
import { formatQty } from '../../shared/units';
import type { ParsedBill } from '@/components/QuickBill';

const LANGS = [['en-IN', 'English'], ['hi-IN', 'हिन्दी'], ['ta-IN', 'தமிழ்'], ['te-IN', 'తెలుగు'], ['kn-IN', 'ಕನ್ನಡ'], ['ml-IN', 'മലയാളം'], ['mr-IN', 'मराठी'], ['gu-IN', 'ગુજરાતી'], ['bn-IN', 'বাংলা']] as const;
type Log = { id: number; heard: string; added?: string; state: 'added' | 'undo' | 'asking' | 'missed'; options?: Array<{ itemId: string; name: string; qty: number }> };

/**
 * Continuous voice billing: tap the mic once and keep talking. Every phrase ("two kg carrot and three mouse") goes
 * on the bill as soon as it is heard, with no Fill button or new rows. "Remove last" takes the last one off. A phrase
 * that names nothing known is asked of the AI when it is on and online (it also understands the customer, discount
 * and payment), otherwise the closest items are offered to tap.
 */
export function VoiceBar({ items, onAdd, onUndo, onAi, aiOn, autoStart, onStop }: {
  items: Array<VoiceItem & { unit: string }>;
  /** Start listening as soon as it shows (opened from a mic button), and tell when it stops. */
  autoStart?: boolean; onStop?: () => void;
  onAdd: (itemId: string, qty: number) => void;
  onUndo: () => void;
  onAi?: (b: ParsedBill) => void;
  aiOn?: boolean;
}) {
  const toast = useToast();
  const engine = speechEngine();
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [partial, setPartial] = useState('');
  const [log, setLog] = useState<Log[]>([]);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('c360.voice.lang') ?? 'en-IN'; } catch { return 'en-IN'; } });
  const ref = useRef<Listening | null>(null);
  const seq = useRef(0);
  // The newest list of items and callbacks, for phrases heard after a re-render.
  const live = useRef({ items, onAdd, onUndo, onAi, aiOn });
  live.current = { items, onAdd, onUndo, onAi, aiOn };
  useEffect(() => () => ref.current?.stop(), []);
  const started = useRef(false);
  useEffect(() => { if (autoStart && !started.current) { started.current = true; void toggle(); } }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!engine) return null;
  const langs = engineLangs(engine);

  const push = (l: Omit<Log, 'id'>) => setLog((x) => [{ ...l, id: ++seq.current }, ...x].slice(0, 6));
  const heard = async (text: string) => {
    const { items: its, onAdd: add, onUndo: undo, onAi: ai, aiOn: useAi } = live.current;
    for (const a of parseVoice(text, its)) {
      if (a.kind === 'add') { add(a.itemId, a.qty); const it = its.find((i) => i.id === a.itemId); push({ heard: a.heard, added: `${it ? formatQty(a.qty, it.unit) : a.qty} ${a.name}`, state: 'added' }); }
      else if (a.kind === 'undo') { undo(); push({ heard: a.heard, added: 'Removed the last item', state: 'undo' }); }
      else if (useAi && ai && navigator.onLine) {
        push({ heard: a.heard, state: 'asking' });
        try {
          const b = await api.post<ParsedBill>('/shop/ai/parse-bill', { text: a.heard, context: 'invoice' });
          if (b.lines.length || b.customer || b.paymentMode || b.billDiscount) {
            ai(b);
            push({ heard: a.heard, added: [b.lines.map((l) => `${l.qty} ${l.name}`).join(', '), b.customer && `customer ${b.customer.name}`, b.paymentMode, b.billDiscount && `${b.billDiscount.value}${b.billDiscount.kind === 'percent' ? '%' : ' ₹'} off`].filter(Boolean).join(' · '), state: 'added' });
          } else push({ heard: a.heard, state: 'missed', options: a.options.map((o) => ({ ...o, qty: 1 })) });
        } catch { push({ heard: a.heard, state: 'missed', options: a.options.map((o) => ({ ...o, qty: 1 })) }); }
      } else push({ heard: a.heard, state: 'missed', options: a.options.map((o) => ({ ...o, qty: 1 })) });
    }
  };
  const toggle = async () => {
    if (on) { ref.current?.stop(); ref.current = null; setOn(false); setPartial(''); onStop?.(); return; }
    setStarting(true);
    try {
      ref.current = await startListening({
        lang: langs ? langs[0]! : lang, continuous: true, words: live.current.items.flatMap((i) => [i.name, i.brand ?? '', String(i.extra?.localName ?? '')]),
        onPartial: setPartial, onFinal: (t) => void heard(t),
        onError: (m) => { toast('error', 'Voice stopped', m); setOn(false); },
        onEnd: () => { setOn(false); setPartial(''); onStop?.(); },
      });
      setOn(true);
    } catch (e) { toast('error', 'Voice can’t start', (e as Error).message); } finally { setStarting(false); }
  };
  return (
    <div className={`voice-bar ${on ? 'on' : ''}`}>
      <div className="voice-row">
        <button type="button" className={`btn ${on ? 'btn-danger' : 'btn-secondary'} voice-btn`} onClick={() => void toggle()} disabled={starting} aria-pressed={on}>
          {starting ? <Loader2 size={16} className="spin" /> : on ? <MicOff size={16} /> : <Mic size={16} />} {on ? 'Stop voice billing' : 'Voice billing'}
        </button>
        {on ? <span className="voice-live"><span className="qb-dot" /> {partial ? `“${partial}”` : 'Listening… say “2 kg carrot and 3 mouse”. Say “remove last” to undo.'}</span>
          : <span className="small muted">Tap once and keep talking: items go on the bill as you say them.</span>}
        {!langs && !on && (
          <select className="select voice-lang" value={lang} aria-label="Voice language" onChange={(e) => { setLang(e.target.value); try { localStorage.setItem('c360.voice.lang', e.target.value); } catch { /* */ } }}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      {log.length > 0 && (
        <ul className="voice-log">
          {log.map((l) => (
            <li key={l.id} className={l.state}>
              {l.state === 'added' ? <CheckCircle2 size={14} /> : l.state === 'undo' ? <Undo2 size={14} /> : l.state === 'asking' ? <Loader2 size={14} className="spin" /> : <HelpCircle size={14} />}
              <span className="muted">“{l.heard}”</span>
              {l.added && <strong>{l.added}</strong>}
              {l.state === 'missed' && (l.options?.length
                ? <>Did you mean {l.options.map((o) => <button key={o.itemId} type="button" className="btn btn-soft btn-xs" onClick={() => { live.current.onAdd(o.itemId, 1); setLog((x) => x.map((y) => (y.id === l.id ? { ...y, state: 'added', added: `1 ${o.name}`, options: [] } : y))); }}>{o.name}</button>)}</>
                : <span>Not in your items. Say it as it is named, or type it.</span>)}
              {l.state === 'asking' && <span className="muted">checking…</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
