/**
 * The shop's bank account for the "Pay to" box on invoices: separate fields, each checked, and the printed text
 * built from them so every invoice, PDF and receipt shows it the same way.
 *
 *  - Account number: 9 to 18 digits (Indian banks use 9–18), spaces and dashes dropped.
 *  - IFSC: 11 characters, 4 letters (the bank), then 0, then 6 letters or digits (the branch), e.g. HDFC0001234.
 *    The first 4 letters name the bank, so the bank name fills itself in for the common banks.
 */
export interface BankFields { bankAccountName: string; bankName: string; bankAccountNo: string; bankIfsc: string; bankBranch: string; bankNote: string }

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const IFSC_RULE = 'Enter the 11-character IFSC, e.g. HDFC0001234 (4 letters, 0, then 6 letters or digits)';
export const ACCOUNT_RULE = 'Enter the account number: 9 to 18 digits';

export const cleanAccountNo = (v: string | null | undefined) => String(v ?? '').replace(/[\s-]/g, '');
export const isValidAccountNo = (v: string | null | undefined) => /^\d{9,18}$/.test(cleanAccountNo(v));
export const cleanIfsc = (v: string | null | undefined) => String(v ?? '').replace(/\s/g, '').toUpperCase();
export const isValidIfsc = (v: string | null | undefined) => IFSC_RE.test(cleanIfsc(v));

const BANKS: Record<string, string> = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IDIB: 'Indian Bank', IOBA: 'Indian Overseas Bank', BKID: 'Bank of India',
  CBIN: 'Central Bank of India', MAHB: 'Bank of Maharashtra', UCBA: 'UCO Bank', PSIB: 'Punjab & Sind Bank', INDB: 'IndusInd Bank', YESB: 'Yes Bank',
  IDFB: 'IDFC FIRST Bank', FDRL: 'Federal Bank', KVBL: 'Karur Vysya Bank', TMBL: 'Tamilnad Mercantile Bank', CIUB: 'City Union Bank', SIBL: 'South Indian Bank',
  KARB: 'Karnataka Bank', LAVB: 'Lakshmi Vilas Bank', DCBL: 'DCB Bank', RATN: 'RBL Bank', AUBL: 'AU Small Finance Bank', ESFB: 'Equitas Small Finance Bank',
  UJVN: 'Ujjivan Small Finance Bank', JAKA: 'Jammu & Kashmir Bank', DLXB: 'Dhanlaxmi Bank', CSBK: 'CSB Bank', BDBL: 'Bandhan Bank', IBKL: 'IDBI Bank',
  PYTM: 'Paytm Payments Bank', AIRP: 'Airtel Payments Bank', IPOS: 'India Post Payments Bank', SCBL: 'Standard Chartered Bank', HSBC: 'HSBC', CITI: 'Citibank',
};
/** The bank's name from its IFSC (common banks), or ''. */
export const bankFromIfsc = (ifsc: string) => BANKS[cleanIfsc(ifsc).slice(0, 4)] ?? '';

/** Problems with the bank fields, by field name ({} when fine). Account number and IFSC go together. */
export function bankErrors(b: Pick<BankFields, 'bankAccountNo' | 'bankIfsc' | 'bankAccountName'>, confirmNo?: string, opts: { requireName?: boolean } = { requireName: true }): Record<string, string> {
  const e: Record<string, string> = {};
  const no = cleanAccountNo(b.bankAccountNo), ifsc = cleanIfsc(b.bankIfsc);
  if (no && !isValidAccountNo(no)) e.bankAccountNo = ACCOUNT_RULE;
  if (ifsc && !IFSC_RE.test(ifsc)) e.bankIfsc = IFSC_RULE;
  if (no && !ifsc) e.bankIfsc = 'Enter the IFSC for this account';
  if (ifsc && !no) e.bankAccountNo = 'Enter the account number for this IFSC';
  if (opts.requireName && no && !b.bankAccountName.trim()) e.bankAccountName = 'Enter the name on the account (customers check it before paying)';
  if (confirmNo !== undefined && no && cleanAccountNo(confirmNo) !== no) e.bankAccountNoConfirm = 'The two account numbers don’t match';
  return e;
}

/** The text printed in the "Pay to" box, built from the fields. */
export function composeBankDetails(b: BankFields): string {
  const no = cleanAccountNo(b.bankAccountNo), ifsc = cleanIfsc(b.bankIfsc);
  const lines: string[] = [];
  if (b.bankAccountName.trim()) lines.push(`A/c name: ${b.bankAccountName.trim()}`);
  if (no) lines.push([b.bankName.trim(), `A/c ${no}`].filter(Boolean).join(' · '));
  else if (b.bankName.trim()) lines.push(b.bankName.trim());
  if (ifsc) lines.push([`IFSC ${ifsc}`, b.bankBranch.trim()].filter(Boolean).join(' · '));
  if (b.bankNote.trim()) lines.push(b.bankNote.trim());
  return lines.join('\n');
}

/** Best-effort split of an old free-text bank box into the fields (for shops that typed it before). */
export function parseBankDetails(text: string): BankFields {
  const t = String(text ?? '');
  const ifsc = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i.exec(t)?.[1]?.toUpperCase() ?? '';
  const no = /(?:a\/?c|account)(?:\s*(?:no\.?|number))?\s*[:.#-]?\s*([\d][\d\s-]{7,24}\d)/i.exec(t)?.[1] ?? /\b(\d{9,18})\b/.exec(t)?.[1] ?? '';
  const name = /a\/?c\s*name\s*[:-]\s*([^\n·]+)/i.exec(t)?.[1]?.trim() ?? '';
  const bank = bankFromIfsc(ifsc) || (/^\s*([A-Za-z][A-Za-z .&]*?Bank)\b/im.exec(t)?.[1]?.trim() ?? '');
  const branch = ifsc ? (new RegExp(`${ifsc}\\s*[·,-]\\s*([^\\n]+)`, 'i').exec(t)?.[1]?.trim() ?? '') : '';
  const parsed = { bankAccountName: name, bankName: bank, bankAccountNo: cleanAccountNo(no), bankIfsc: ifsc, bankBranch: branch, bankNote: '' };
  // Anything we could not place is kept as a note, so nothing the shop wrote is lost.
  // (Only a complete account number + IFSC pair is taken out of the text; otherwise the old text stays whole, as before.)
  if (t.trim() && !(isValidAccountNo(parsed.bankAccountNo) && parsed.bankIfsc)) return { bankAccountName: '', bankName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '', bankNote: t.trim().slice(0, 300) };
  return parsed;
}
