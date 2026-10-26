/* Reading weighing scales over a serial/USB cable. Most Indian retail scales (Essae, Aczet, Atom, Citizen, Contech)
   stream lines like "ST,GS,+  1.250kg", "   1.250 kg", "W:0001.250" or "+001250" (grams) at 9600 baud. */

export interface ScaleReading { kg: number; stable: boolean }

/** The weight in kg from one line of scale output, or null if the line has no weight. */
export function parseScale(line: string): ScaleReading | null {
  const s = line.replace(/\0/g, '').trim();
  if (!s) return null;
  const stable = !/\bUS\b|unstable|motion|\?/i.test(s);
  const m = s.match(/([-+]?\s*\d+(?:\.\d+)?)\s*(kg|g|gm|gms|lb)?\b/i);
  if (!m) return null;
  let n = Number(m[1]!.replace(/\s/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'g' || unit === 'gm' || unit === 'gms') n /= 1000;
  else if (unit === 'lb') n *= 0.45359237;
  else if (!unit && !m[1]!.includes('.') && Math.abs(n) >= 1000) n /= 1000; // "+001250" is grams
  return { kg: Math.round(n * 1000) / 1000, stable };
}

/** Quantity to bill for an item, from a reading in kg, by the item's unit. */
export function qtyFromReading(kg: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'g' || u === 'gm' || u === 'gms' || u === 'gram' || u === 'grams') return Math.round(kg * 1000);
  return Math.round(kg * 1000) / 1000;
}
export const isWeighed = (unit: string) => /^(kg|kgs|g|gm|gms|gram|grams|kilogram)$/i.test(unit.trim());
