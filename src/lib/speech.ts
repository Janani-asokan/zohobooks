/**
 * Listening for voice billing. Two engines behind one call:
 *  - Browsers with built-in speech (Chrome, Edge, Safari): the Web Speech API, any Indian language.
 *  - The CorpusLite Windows app: Electron has the same API but it only works with Google's keys, so it silently
 *    hears nothing. There a recogniser runs on the PC itself (Vosk, Indian English, model shipped in the installer),
 *    limited to the words of the shop's own items, numbers and units, which makes names much easier to catch.
 *    It also works with no internet.
 * `continuous`: keeps listening until stopped; each finished phrase comes to onFinal.
 */
import { IS_APP, IS_DESKTOP } from '@/lib/platform';

export interface SpeechOpts {
  lang: string;
  continuous: boolean;
  /** Words the shop uses (item names): the on-PC recogniser listens for these. */
  words?: string[];
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}
export interface Listening { stop: () => void }

type WebRec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
const WebSpeech = (typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined) as (new () => WebRec) | undefined;
const desktopVoice = () => (typeof window !== 'undefined' ? (window as unknown as { corpusDesktop?: { voiceModel?: () => Promise<Uint8Array | null> } }).corpusDesktop?.voiceModel : undefined);

/** Which engine this device uses, or null when voice isn't possible here. */
export function speechEngine(): 'web' | 'local' | null {
  if (IS_DESKTOP) return desktopVoice() ? 'local' : null; // an older Windows app without the model: no voice
  if (IS_APP) return null; // the Android WebView has no speech service
  return WebSpeech ? 'web' : null;
}
/** Languages the engine can hear. */
export const engineLangs = (e: 'web' | 'local') => (e === 'local' ? ['en-IN'] : null);

export function startListening(o: SpeechOpts): Promise<Listening> {
  return speechEngine() === 'local' ? startLocal(o) : startWeb(o);
}

/* ---------- Web Speech API ---------- */
async function startWeb(o: SpeechOpts): Promise<Listening> {
  if (!WebSpeech) throw new Error('Voice needs Chrome, Edge or Safari');
  let active = true; let r: WebRec | null = null;
  const begin = () => {
    r = new WebSpeech();
    r.lang = o.lang; r.interimResults = true; r.continuous = o.continuous; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = String(e.results[i][0].transcript ?? '');
        if (e.results[i].isFinal) { if (t.trim()) o.onFinal(t.trim()); } else partial += t;
      }
      o.onPartial?.(partial);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active = false; o.onError?.('The microphone is blocked. Allow it for this site in the browser (the lock icon next to the address).'); }
      else if (e.error === 'network') { active = false; o.onError?.('Voice needs the internet in this browser.'); }
      else if (e.error === 'audio-capture') { active = false; o.onError?.('No microphone found. Plug one in or check Windows sound settings.'); }
    };
    // The browser ends a session after a pause or a minute: start again while the counter still wants to listen.
    r.onend = () => { if (active && o.continuous) { try { begin(); } catch { active = false; o.onEnd?.(); } } else o.onEnd?.(); };
    r.start();
  };
  begin();
  return { stop: () => { active = false; try { r?.stop(); } catch { /* */ } } };
}

/* ---------- On the PC (Windows app) ---------- */
let modelP: Promise<import('vosk-browser').Model> | null = null;
async function loadModel() {
  return (modelP ??= (async () => {
    const bytes = await desktopVoice()!();
    if (!bytes) throw new Error('The voice model is missing. Reinstall CorpusLite for Windows.');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
    const { createModel } = await import('vosk-browser');
    return createModel(url, -1);
  })().catch((e) => { modelP = null; throw e; }));
}

const FILLER = ['and', 'aur', 'then', 'also', 'plus', 'remove', 'delete', 'undo', 'last', 'cancel', 'kilo', 'kilos', 'kilogram', 'gram', 'grams', 'litre', 'liter', 'ml', 'half', 'quarter', 'piece', 'pieces',
  'packet', 'pack', 'box', 'bottle', 'dozen', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'hundred',
  'ek', 'do', 'teen', 'char', 'paanch', 'a', 'an', 'of'];

async function startLocal(o: SpeechOpts): Promise<Listening> {
  // Made before any wait, while the tap still counts as the person's action: an audio context made later starts
  // paused and never hears anything.
  const ctx = new AudioContext();
  void ctx.resume().catch(() => undefined);
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch { void ctx.close(); throw new Error('No microphone, or it is blocked. Check Windows Settings → Privacy → Microphone, and that a mic is plugged in.'); }
  const model = await loadModel().catch((e) => { stream.getTracks().forEach((t) => t.stop()); void ctx.close(); throw e; });
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  const words = [...new Set([...FILLER, ...(o.words ?? []).flatMap((w) => w.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 1)])];
  // Listen for the shop's words only ([unk] catches the rest), as a JSON grammar.
  const rec = new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify([...words, '[unk]']));
  let active = true;
  rec.on('result', (m) => {
    const text = String((m as { result?: { text?: string } }).result?.text ?? '').replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();
    o.onPartial?.('');
    if (text) o.onFinal(text);
    if (!o.continuous && text) stop();
  });
  rec.on('partialresult', (m) => o.onPartial?.(String((m as { result?: { partial?: string } }).result?.partial ?? '')));
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (ev) => { if (active) { try { rec.acceptWaveform(ev.inputBuffer); } catch { /* */ } } };
  src.connect(node); node.connect(ctx.destination);
  function stop() {
    if (!active) return; active = false;
    try { rec.retrieveFinalResult(); } catch { /* */ }
    setTimeout(() => { try { node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); rec.remove(); void ctx.close(); } catch { /* */ } o.onEnd?.(); }, 300);
  }
  return { stop };
}
