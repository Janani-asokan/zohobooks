import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Mic, MicOff, Sparkles, Wand2 } from 'lucide-react';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';

export interface ParsedBill {
  customer: { id: string; name: string } | null;
  customerText: string | null;
  lines: Array<{ itemId: string; name: string; qty: number; rate: number | null; discount: number }>;
  unmatched: string[];
  billDiscount: { kind: 'percent' | 'amount'; value: number } | null;
  paymentMode: 'Cash' | 'UPI' | 'Card' | null;
  pricesIncludeTax: boolean | null;
  notes: string | null;
}

// The Web Speech API is Chrome/Edge/Safari only, and prefixed in Chrome.
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
const SpeechRecognition = (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) as (new () => Recognition) | undefined;
const LANGS = [['en-IN', 'English'], ['hi-IN', 'हिन्दी'], ['ta-IN', 'தமிழ்'], ['te-IN', 'తెలుగు'], ['kn-IN', 'ಕನ್ನಡ'], ['ml-IN', 'മലയാളം'], ['mr-IN', 'मराठी'], ['gu-IN', 'ગુજરાતી'], ['bn-IN', 'বাংলা']] as const;

/** Type or say the bill in plain words ("3 Logitech mouse and a Dell monitor for Nila Textiles, 5% off, UPI"); AI fills the form. */
export function QuickBill({ context, onApply, compact }: { context: 'invoice' | 'pos'; onApply: (b: ParsedBill) => void; compact?: boolean }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('c360.voice.lang') ?? 'en-IN'; } catch { return 'en-IN'; } });
  const [last, setLast] = useState<ParsedBill | null>(null);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);

  const listen = () => {
    if (!SpeechRecognition) return toast('info', 'Voice needs Chrome, Edge or Safari', 'You can still type the bill.');
    if (listening) { rec.current?.stop(); return; }
    const r = new SpeechRecognition();
    r.lang = lang; r.interimResults = true; r.continuous = false;
    const before = text ? `${text.trim()} ` : '';
    r.onresult = (e) => setText(before + Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(' '));
    r.onerror = (e) => { if (e.error === 'not-allowed') toast('error', 'Microphone blocked', 'Allow the microphone for this site in the browser.'); };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const fill = async () => {
    if (text.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      const b = await api.post<ParsedBill>('/shop/ai/parse-bill', { text, context });
      setLast(b);
      if (!b.lines.length && !b.customer) return toast('info', 'Nothing matched your items', b.unmatched.length ? `Not found: ${b.unmatched.join(', ')}` : 'Try the item names as they are in your catalogue.');
      onApply(b);
      toast('success', `${b.lines.length} item${b.lines.length === 1 ? '' : 's'} added${b.customer ? ` for ${b.customer.name}` : ''}`, b.unmatched.length ? `Not found: ${b.unmatched.join(', ')}` : 'Check the bill before saving.');
      setText('');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`quick-bill ${compact ? 'compact' : ''}`}>
      <div className="qb-head">
        <span className="qb-icon"><Wand2 size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Type or speak the bill</strong>
          {!compact && <div className="small muted">e.g. “3 Logitech mouse aur ek Dell monitor for Nila Textiles, 5% off, UPI”. AI finds your items and customer.</div>}
        </div>
        {SpeechRecognition && (
          <select className="select qb-lang" value={lang} aria-label="Voice language" onChange={(e) => { setLang(e.target.value); try { localStorage.setItem('c360.voice.lang', e.target.value); } catch { /* private mode */ } }}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <div className="qb-row">
        <textarea className="textarea" rows={compact ? 1 : 2} value={text} maxLength={1500} aria-label="Bill in your words" placeholder={compact ? '2 pen drive, 1 USB cable, cash…' : 'Items, quantities, customer, discount, payment…'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void fill(); } }} />
        <button type="button" className={`icon-btn qb-mic ${listening ? 'on' : ''}`} onClick={listen} aria-label={listening ? 'Stop listening' : 'Speak the bill'} title={listening ? 'Stop' : 'Speak'}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>
        <button type="button" className="btn btn-primary" onClick={() => void fill()} disabled={busy || text.trim().length < 2}>{busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Fill</button>
      </div>
      {listening && <div className="small qb-listening"><span className="qb-dot" /> Listening… speak the items, then pause.</div>}
      {last && last.unmatched.length > 0 && <div className="small qb-warn"><AlertTriangle size={13} /> Not in your catalogue: {last.unmatched.join(', ')}</div>}
    </div>
  );
}
