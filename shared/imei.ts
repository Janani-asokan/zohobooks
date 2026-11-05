/**
 * IMEI numbers on phone boxes. An IMEI is 15 digits and its last digit is a Luhn check digit, so a misread or a
 * random number can be told apart from a real IMEI. Phone boxes carry several barcodes: the model's EAN, IMEI 1,
 * IMEI 2, a serial number, and often a QR code holding all of them ("IMEI1:… IMEI2:… SN:…").
 */
export function luhnOk(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/** A real IMEI: 15 digits with a valid check digit. */
export const isImei = (s: string) => /^\d{15}$/.test(s) && luhnOk(s);

/** The IMEIs in a scanned text: a single code, or a box QR code / label with several ("IMEI1:… IMEI2:…"). */
export function extractImeis(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/(?<!\d)(\d{15})(?!\d)/g)) if (isImei(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
