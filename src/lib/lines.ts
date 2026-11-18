/**
 * Item tables everywhere (invoices, quotes, orders, recurring, purchases, stock, challans, transfers) behave the same:
 * picking an item on the last line adds a fresh empty line under it, and Enter in a number cell moves to the next
 * line's item box, so a whole bill can be keyed without the mouse. Empty lines are never saved or printed.
 */

/** Keeps exactly one empty line at the end once the last line has an item. */
export function withTrailingBlank<T>(lines: T[], isBlank: (l: T) => boolean, blank: () => T): T[] {
  if (lines.length && isBlank(lines[lines.length - 1]!)) return lines;
  return [...lines, blank()];
}

/** Rows without an item are hidden in print. */
export const blankRowClass = (blank: boolean) => (blank ? 'line-blank' : '');

/**
 * Enter in a quantity / rate / discount box: go to the next line's item box (the first input of the next row with
 * data-line), so the next item can be typed straight away. Returns true when it moved.
 */
export function enterToNextLine(e: { key: string; currentTarget: HTMLElement; preventDefault: () => void }) {
  if (e.key !== 'Enter') return false;
  const row = e.currentTarget.closest('tr[data-line]');
  let next = row?.nextElementSibling ?? null;
  while (next && !next.hasAttribute('data-line')) next = next.nextElementSibling;
  const target = next?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  if (!target) return false;
  e.preventDefault();
  target.focus();
  if (target instanceof HTMLInputElement) target.select();
  return true;
}
