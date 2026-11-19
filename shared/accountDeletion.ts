/** Rules for deleting an account, shared by the server, the app and the public help page. */

/** Days a closed shop can still be restored through support before personal details are wiped. */
export const SHOP_RESTORE_DAYS = 30;

/**
 * GST law (CGST Act s.36) keeps books for 72 months from the due date of the annual return for the year. The annual
 * return (GSTR-9) for a financial year April–March is due on 31 December after it ends, so a bill dated in FY 2025-26
 * is kept until 31 December 2032. We keep to the latest year with bills, counting from the closing date.
 */
export function recordsUntil(closedOn: string): string {
  const [y, m] = closedOn.split('-').map(Number) as [number, number];
  const fyEnd = m >= 4 ? y + 1 : y;          // the FY the closing date falls in ends in March of this year
  return `${fyEnd + 6}-12-31`;               // GSTR-9 due 31 Dec of fyEnd, plus 72 months
}

/** The shop name must be typed exactly (ignoring case and spaces at the ends) to close it. */
export const confirmsShopName = (typed: string, name: string) => typed.trim().toLowerCase() === name.trim().toLowerCase() && typed.trim() !== '';

/** A deleted login's stand-in email: unique, can never receive mail or be signed in with. */
export const deletedEmail = (userId: string) => `deleted-${userId}@deleted.invalid`;
