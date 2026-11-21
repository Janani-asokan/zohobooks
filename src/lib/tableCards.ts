/**
 * Phones: a table wider than the screen is shown as cards, one per row, with each value labelled by its column
 * heading (the CSS is `.as-cards` in app.css). Tables that fit stay tables. This runs for every screen, so lists,
 * editors and reports all behave the same without each page doing its own phone layout.
 *
 * A table can opt out with the class `no-cards` (or by having its own phone layout, like the stock transfer lines).
 */
const PHONE = '(max-width: 640px)';
const SKIP = '.no-cards, .tf-cards, .hc-table table';

function labelCells(table: HTMLTableElement) {
  const heads = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!heads) return;
  // Column index → heading, allowing for headings that span columns.
  const names: string[] = [];
  for (const th of Array.from(heads.cells)) {
    const text = (th.getAttribute('aria-label') || th.textContent || '').trim().replace(/\s+/g, ' ');
    for (let i = 0; i < (th.colSpan || 1); i++) names.push(text);
  }
  for (const body of Array.from(table.tBodies).concat(table.tFoot ? [table.tFoot as HTMLTableSectionElement] : [])) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const td of Array.from(row.cells)) {
        const name = td.colSpan > 1 ? '' : names[col] ?? '';
        if (td.dataset.label !== name && !td.hasAttribute('data-label-fixed')) td.dataset.label = name;
        col += td.colSpan || 1;
      }
    }
  }
}

function check(table: HTMLTableElement) {
  if (table.matches(SKIP) || table.closest('.doc, .print-only, .invoice-doc, .no-cards')) return;
  const wrap = table.parentElement;
  if (!wrap) return;
  // Decide once per table while it is a table; a carded table stays carded until the screen is wide again.
  if (!table.classList.contains('as-cards') && table.scrollWidth > wrap.clientWidth + 4) table.classList.add('as-cards');
  if (table.classList.contains('as-cards')) labelCells(table);
}

export function installTableCards() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia(PHONE);
  let queued = false;
  const run = () => {
    queued = false;
    if (!mq.matches) {
      document.querySelectorAll('table.as-cards').forEach((t) => t.classList.remove('as-cards'));
      return;
    }
    document.querySelectorAll<HTMLTableElement>('.table-wrap > table.table, .table-wrap > table').forEach(check);
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, characterData: true });
  mq.addEventListener?.('change', queue);
  window.addEventListener('resize', queue);
  queue();
}
