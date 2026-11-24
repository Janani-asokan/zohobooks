/**
 * Voice billing: what the counter says, turned into bill lines without the internet or AI, phrase by phrase.
 *   "two kg carrot and three logitech mouse"  →  2 kg Carrot, 3 Logitech Mouse
 *   "ek dal pack aur do rice", "half kg onion", "5 pen drive", "remove last", "undo"
 * A phrase that names no known item is returned as unmatched (the caller may ask the AI, when online).
 */
import { parseQty } from './units';

export interface VoiceItem { id: string; name: string; unit: string; sku?: string | null; brand?: string | null; extra?: Record<string, unknown> | null }
export type VoiceAction =
  | { kind: 'add'; itemId: string; name: string; qty: number; heard: string; score: number }
  | { kind: 'undo'; heard: string }
  | { kind: 'unmatched'; heard: string; options: Array<{ itemId: string; name: string }> };

const NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
  // Hindi / Hinglish, as Indian-English recognisers write them.
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
};
const SPLIT = /\s*(?:,|;|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b|\baur\b|\bplus\b|\bwith\b)\s+/i;
const UNDO = /^(?:remove|delete|cancel|undo)(?: the)?(?: last(?: one| item)?)?$/i;
const UNIT_WORDS = /\b(kg|kgs|kilo|kilos|kilogram|kilograms|g|gm|gms|gram|grams|litre|litres|liter|liters|ltr|l|ml|pcs|pc|piece|pieces|nos|packet|packets|pack|packs|box|boxes|bottle|bottles|half|quarter|pav|paav|dedh|adha)\b/i;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s.]/gu, ' ').replace(/\s+/g, ' ').trim();
const bigrams = (s: string) => { const t = ` ${s} `; const out = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); } return out; };
/** How alike two names sound when written (0–1): letter pairs in common, so "logitec mouse" still finds "Logitech Mouse". */
export function likeness(a: string, b: string) {
  const A = bigrams(a); const B = bigrams(b); let common = 0; let n = 0;
  for (const [g, c] of A) { common += Math.min(c, B.get(g) ?? 0); n += c; }
  for (const c of B.values()) n += c;
  return n ? (2 * common) / n : 0;
}

function bestItems(words: string, items: VoiceItem[]) {
  const w = norm(words);
  if (!w) return [];
  return items.map((it) => {
    const names = [it.name, it.sku ?? '', it.brand ? `${it.brand} ${it.name}` : '', String(it.extra?.localName ?? '')].map(norm).filter(Boolean);
    let score = 0;
    for (const n of names) {
      const s = n === w ? 1 : n.includes(w) || w.includes(n) ? 0.9 * Math.min(n.length, w.length) / Math.max(n.length, w.length) + 0.1 : 0;
      // Every spoken word found in the name (in any order) also counts as a strong match.
      const ws = w.split(' '); const hit = ws.filter((x) => x.length > 1 && n.split(' ').some((y) => y === x || (x.length > 3 && likeness(x, y) > 0.75))).length;
      const words = ws.length ? (hit / ws.length) * 0.85 : 0;
      score = Math.max(score, s, words, likeness(w, n));
    }
    return { it, score };
  }).filter((x) => x.score >= 0.45).sort((a, b) => b.score - a.score);
}

/** Reads one phrase ("three kg carrot"): quantity, unit and the item it names. */
function onePhrase(raw: string, items: VoiceItem[]): VoiceAction | null {
  const heard = raw.trim().replace(/[.?!]+$/, '');
  if (!heard) return null;
  if (UNDO.test(norm(heard))) return { kind: 'undo', heard };
  const words = norm(heard).split(' ');
  // Quantity first: "3", "three", "2.5", "half kg", "200 gram"…
  let i = 0; let qtyText = '';
  while (i < words.length && (/^\d+(?:\.\d+)?$/.test(words[i]!) || NUM[words[i]!] !== undefined || (qtyText && UNIT_WORDS.test(words[i]!)) || (!qtyText && UNIT_WORDS.test(words[i]!) && /^(half|quarter|pav|paav|dedh|adha)$/.test(words[i]!)))) {
    const w = words[i]!; qtyText += ` ${NUM[w] !== undefined && !UNIT_WORDS.test(w) ? NUM[w] : w}`; i++;
    if (i - 1 > 0 && UNIT_WORDS.test(w) && !/^(half|quarter|pav|paav|dedh|adha)$/.test(w)) break; // "2 kg" ends at the unit
  }
  let rest = words.slice(i).join(' ');
  // Or quantity last: "carrot two kg", "mouse 3".
  if (!qtyText) {
    const m = /^(.*?)\s+((?:\d+(?:\.\d+)?|[a-z]+)(?:\s+[a-z]+)?)$/.exec(rest);
    if (m && (/^\d/.test(m[2]!) || NUM[m[2]!.split(' ')[0]!] !== undefined) && bestItems(m[1]!, items).length) { rest = m[1]!; qtyText = ` ${m[2]!.split(' ').map((w) => (NUM[w] !== undefined && !UNIT_WORDS.test(w) ? NUM[w] : w)).join(' ')}`; }
  }
  // Words that are never part of an item name: fillers, and a stray "last" heard next to an item.
  rest = rest.replace(/^(of|ka|ki|ke)\s+/, '').replace(/\b(uh|um|the|last|please|okay|ok)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const found = bestItems(rest, items);
  const top = found[0];
  const clear = top && (found.length === 1 || top.score - found[1]!.score >= 0.12 || top.score >= 0.98);
  if (!top || !clear) return { kind: 'unmatched', heard, options: found.slice(0, 4).map((x) => ({ itemId: x.it.id, name: x.it.name })) };
  let qty = 1;
  if (qtyText.trim()) {
    const p = parseQty(qtyText.trim(), top.it.unit);
    if ('qty' in p) qty = p.qty;
    else { const n = Number(/\d+(?:\.\d+)?/.exec(qtyText)?.[0]); if (n > 0) qty = n; }
  }
  return { kind: 'add', itemId: top.it.id, name: top.it.name, qty, heard, score: top.score };
}

/**
 * Said without "and" ("carrot three mouse"), or "and" heard as "an": a new phrase starts at a quantity word that
 * follows an item word. "Half kg" and "2 kg" stay with what follows them.
 */
function splitAtQuantities(phrase: string): string[] {
  const w = phrase.trim().split(/\s+/);
  const isQty = (x: string) => /^\d+(?:\.\d+)?$/.test(x) || (NUM[x.toLowerCase()] !== undefined && !['a', 'an', 'to', 'too', 'for', 'do'].includes(x.toLowerCase()));
  const out: string[][] = [[]];
  w.forEach((x, i) => {
    const prev = w[i - 1]?.toLowerCase() ?? '';
    if (i > 0 && isQty(x) && !isQty(prev) && !UNIT_WORDS.test(prev) && out[out.length - 1]!.length) out.push([]);
    out[out.length - 1]!.push(x);
  });
  // A piece that is only a quantity ("carrot two kg") belongs to the item before it.
  const onlyQty = (p: string[]) => p.every((x) => isQty(x) || UNIT_WORDS.test(x) || /^(an|and|aur)$/i.test(x));
  const merged: string[][] = [];
  for (const p of out) { if (merged.length && onlyQty(p)) merged[merged.length - 1]!.push(...p); else merged.push(p); }
  return merged.map((p) => p.join(' ').replace(/\s+\b(an|and|aur|uh|um)$/i, ''));
}

/** A whole utterance, split into phrases ("2 kg carrot and three mouse, one cable"). */
export function parseVoice(text: string, items: VoiceItem[]): VoiceAction[] {
  return text.replace(/\[unk\]/g, ' ').split(SPLIT).flatMap(splitAtQuantities)
    .map((p) => onePhrase(p, items)).filter((x): x is VoiceAction => !!x);
}
