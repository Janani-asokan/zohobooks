/**
 * How quantities work for an item's unit, the way a shop counter really sells:
 *  - pieces (pcs, nos, box, set…): whole numbers only. An iPhone is 1, never 1.5.
 *  - weight (kg / g), volume (ltr / ml), length (mtr): decimals, typed the way people say them:
 *    "200g", "half kg", "1/2", "1.25", "750 ml". Quantities are kept to 3 decimals (1 g in a kg).
 *  - "₹50 worth": the weight that a given amount buys at the item's price.
 *  - weighing-scale labels: EAN-13 starting with 2 that carry the item's code and the weight.
 */

export type UnitKind = 'count' | 'weight' | 'volume' | 'length' | 'time' | 'other';

const KIND: Array<[RegExp, UnitKind]> = [
  [/^(pcs?|pieces?|nos?|numbers?|units?|box(es)?|packs?|packets?|pkts?|sets?|pairs?|dozens?|doz|ream|reams|bottles?|btl|cans?|strips?|tabs?|tablets?|bags?|sacks?|rolls?|sheets?|cartons?|ctn|tins?|jars?|cups?|plates?|bundles?|job|jobs|visits?)$/, 'count'],
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms|g|gm|gms|gram|grams|qtl|quintal|quintals|tonne|tonnes|ton|tons|mt)$/, 'weight'],
  [/^(l|ltr|ltrs|litre|litres|liter|liters|ml|millilitre|millilitres|milliliter|milliliters|kl)$/, 'volume'],
  [/^(m|mtr|mtrs|metre|metres|meter|meters|cm|mm|ft|feet|foot|inch|inches|in|yard|yards|yd|sqft|sq\.?\s?ft|sqm|sq\.?\s?m)$/, 'length'],
  [/^(hours?|hrs?|days?|months?|years?|weeks?|minutes?|mins?)$/, 'time'],
];
export const unitKind = (unit: string): UnitKind => KIND.find(([re]) => re.test(unit.trim().toLowerCase()))?.[1] ?? 'other';

/** True when the unit can only be sold in whole numbers (pieces, boxes, sets…). */
export const wholeOnly = (unit: string) => unitKind(unit) === 'count';
/** True for loose goods sold by weight, volume or length: decimals, ₹-worth and the weighing scale make sense. */
export const isMeasured = (unit: string) => ['weight', 'volume', 'length'].includes(unitKind(unit));

/** Each spoken unit in the item's own unit: how many item-units one of these is. */
function factor(spoken: string, itemUnit: string): number | null {
  const s = spoken.toLowerCase().replace(/\.$/, '');
  const base: Record<string, [UnitKind, number]> = {
    kg: ['weight', 1000], kgs: ['weight', 1000], kilo: ['weight', 1000], kilos: ['weight', 1000], kilogram: ['weight', 1000], kilograms: ['weight', 1000],
    g: ['weight', 1], gm: ['weight', 1], gms: ['weight', 1], gram: ['weight', 1], grams: ['weight', 1], gr: ['weight', 1],
    qtl: ['weight', 100000], quintal: ['weight', 100000], tonne: ['weight', 1000000], ton: ['weight', 1000000],
    l: ['volume', 1000], ltr: ['volume', 1000], ltrs: ['volume', 1000], litre: ['volume', 1000], litres: ['volume', 1000], liter: ['volume', 1000], liters: ['volume', 1000],
    ml: ['volume', 1],
    m: ['length', 100], mtr: ['length', 100], mtrs: ['length', 100], metre: ['length', 100], metres: ['length', 100], meter: ['length', 100], meters: ['length', 100],
    cm: ['length', 1], mm: ['length', 0.1], ft: ['length', 30.48], feet: ['length', 30.48], inch: ['length', 2.54], inches: ['length', 2.54],
    dozen: ['count', 12], doz: ['count', 12], dz: ['count', 12],
    pcs: ['count', 1], pc: ['count', 1], piece: ['count', 1], pieces: ['count', 1], nos: ['count', 1], no: ['count', 1],
  };
  const a = base[s]; const b = base[itemUnit.toLowerCase().trim()];
  if (!a) return null;
  if (!b) return a[0] === 'count' && wholeOnly(itemUnit) ? a[1] : null;
  if (a[0] !== b[0]) return null;
  return a[1] / b[1];
}

const WORDS: Record<string, number> = { half: 0.5, quarter: 0.25, 'one and half': 1.5, 'one and a half': 1.5, 'three quarter': 0.75, 'three quarters': 0.75, 'dedh': 1.5, 'adha': 0.5, 'paav': 0.25, 'pav': 0.25, 'sava': 1.25, 'dhai': 2.5 };
const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

export const roundQty = (q: number) => Math.round(q * 1000) / 1000;

/**
 * Reads a quantity the way it is typed or said at the counter, in the item's unit.
 * "200g" on a per-kg item → 0.2; "1.5" → 1.5; "half kg" → 0.5; "750 ml" on a per-ltr item → 0.75;
 * "2 dozen" on a pcs item → 24. Pieces must come out whole.
 */
export function parseQty(input: string, unit: string): { qty: number } | { error: string } {
  let s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  if (!s) return { error: 'Enter a quantity' };
  for (const [k, v] of Object.entries(FRACTIONS)) s = s.replace(new RegExp(`(\\d)\\s*${k}`), (_m, d) => String(Number(d) + v)).replace(k, String(v));
  let num: number | null = null; let spoken = '';
  const word = Object.keys(WORDS).sort((a, b) => b.length - a.length).find((w) => s === w || s.startsWith(`${w} `));
  if (word) { num = WORDS[word]!; spoken = s.slice(word.length).trim(); }
  else {
    const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*([a-z.]*)$/.exec(s);
    if (!m) return { error: 'Type a number, like 2, 0.5 or 200g' };
    num = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
    spoken = m[3] ?? '';
  }
  if (!Number.isFinite(num) || num <= 0) return { error: 'The quantity must be more than 0' };
  let qty = num;
  if (spoken) {
    const f = factor(spoken, unit);
    if (f === null) return { error: `Can’t turn ${spoken} into ${unit}` };
    qty = num * f;
  }
  qty = roundQty(qty);
  if (qty <= 0) return { error: `That is less than the smallest amount (0.001 ${unit})` };
  if (wholeOnly(unit) && !Number.isInteger(qty)) return { error: `${unit} are sold whole: enter ${Math.floor(qty) || 1} or ${Math.ceil(qty)}` };
  return { qty };
}

/** The smaller unit people also use for this unit (kg → g, ltr → ml, mtr → cm), with how many make one. */
export function subUnit(unit: string): { name: string; per: number } | null {
  const u = unit.toLowerCase().trim();
  if (/^(kg|kgs|kilo|kilogram|kilograms)$/.test(u)) return { name: 'g', per: 1000 };
  if (/^(l|ltr|ltrs|litre|litres|liter|liters)$/.test(u)) return { name: 'ml', per: 1000 };
  if (/^(m|mtr|mtrs|metre|metres|meter|meters)$/.test(u)) return { name: 'cm', per: 100 };
  return null;
}

/** A quantity as people say it: "200 g" for 0.2 kg, "1.25 kg", "750 ml", "3 pcs". */
export function formatQty(qty: number, unit: string): string {
  const q = roundQty(qty);
  const sub = subUnit(unit);
  if (sub && q > 0 && q < 1) return `${roundQty(q * sub.per)} ${sub.name}`;
  return `${Number.isInteger(q) ? q : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} ${unit}`;
}

/** One-tap amounts for loose goods, in the item's unit. */
export function quickQtys(unit: string): Array<{ label: string; qty: number }> {
  const u = unit.toLowerCase().trim();
  const sub = subUnit(u);
  if (sub?.name === 'g') return [{ label: '100 g', qty: 0.1 }, { label: '250 g', qty: 0.25 }, { label: '500 g', qty: 0.5 }, { label: '1 kg', qty: 1 }, { label: '2 kg', qty: 2 }];
  if (sub?.name === 'ml') return [{ label: '200 ml', qty: 0.2 }, { label: '500 ml', qty: 0.5 }, { label: '1 ltr', qty: 1 }, { label: '2 ltr', qty: 2 }];
  if (sub?.name === 'cm') return [{ label: '50 cm', qty: 0.5 }, { label: '1 m', qty: 1 }, { label: '2 m', qty: 2 }, { label: '5 m', qty: 5 }];
  if (/^(g|gm|gms|gram|grams)$/.test(u)) return [{ label: '100 g', qty: 100 }, { label: '250 g', qty: 250 }, { label: '500 g', qty: 500 }, { label: '1 kg', qty: 1000 }];
  if (u === 'ml') return [{ label: '100 ml', qty: 100 }, { label: '250 ml', qty: 250 }, { label: '500 ml', qty: 500 }, { label: '1 ltr', qty: 1000 }];
  return [];
}

/**
 * "Give me ₹50 of carrots": the quantity that amount buys. `ratePerUnit` is the price of one unit; `taxRate`
 * applies when that price is before GST (the customer pays the amount including GST). Kept to 3 decimals, rounded
 * down, so the bill never comes to more than the amount asked for.
 */
export function qtyForAmount(amount: number, ratePerUnit: number, taxRate = 0, rateIncludesTax = true): number {
  if (!(amount > 0) || !(ratePerUnit > 0)) return 0;
  const perUnit = rateIncludesTax ? ratePerUnit : ratePerUnit * (1 + taxRate / 100);
  return Math.floor((amount / perUnit) * 1000) / 1000;
}

/**
 * Weighing-scale label: EAN-13 "2" + 1 flag digit + 5-digit item code (PLU) + 5-digit weight in grams (or the
 * smallest unit) + check digit, as Essae, Aczet, Citizen and most counter scales print. Read only when the code
 * isn't an item's own barcode (shop barcodes also start with 2).
 */
export function parseScaleLabel(code: string): { plu: string; grams: number } | null {
  const c = code.trim();
  if (!/^2\d{12}$/.test(c)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(c[i]) * (i % 2 ? 3 : 1);
  if ((10 - (sum % 10)) % 10 !== Number(c[12])) return null;
  const grams = Number(c.slice(7, 12));
  if (!grams) return null;
  return { plu: c.slice(2, 7), grams };
}

/** A scale label's weight in the item's unit (grams → kg for a per-kg item). */
export const qtyFromGrams = (grams: number, unit: string) => {
  const u = unit.toLowerCase().trim();
  if (/^(g|gm|gms|gram|grams|ml)$/.test(u)) return grams;
  return roundQty(grams / 1000);
};

/** Matches a scale label's item code to an item: by its PLU / SKU / barcode, ignoring leading zeros. */
export function itemForPlu<T extends { sku?: string | null; barcode?: string | null; plu?: string | null }>(items: T[], plu: string): T | undefined {
  const n = plu.replace(/^0+/, '');
  if (!n) return undefined;
  const norm = (v?: string | null) => (v ?? '').trim().replace(/^0+/, '');
  return items.find((i) => norm(i.plu) === n) ?? items.find((i) => norm(i.sku) === n) ?? items.find((i) => norm(i.barcode) === n);
}

/** Why a quantity can't be billed in this unit (pieces must be whole; at most 3 decimals), or null when it can. */
export function qtyProblem(name: string, qty: number, unit: string): string | null {
  if (!(qty > 0)) return `${name}: the quantity must be more than 0`;
  if (wholeOnly(unit) && !Number.isInteger(qty)) return `${name} is sold in whole ${unit}; ${qty} isn’t a whole number`;
  if (Math.abs(roundQty(qty) - qty) > 1e-9) return `${name}: use at most 3 decimals (1 g in a kg)`;
  return null;
}
