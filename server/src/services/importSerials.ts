import type { Db } from '../db';
import { one } from '../db';
import { cleanSerial, moveStock, serialsTaken } from './stock';

/* IMEI / serial numbers from an Excel or CSV item list. Phone and electronics shops list them either one row per unit
   (the item repeated, one IMEI each) or several in one cell ("356…, 356…"). Either way every number becomes one unit
   of stock with its own record, so it can be sold once and found later for warranty. */

/** The column names an item list uses for IMEI / serial numbers (CSV headers after lower_snake_case). */
const SERIAL_KEYS = ['serials', 'imei', 'imei_no', 'imei_number', 'imei_numbers', 'imei_1', 'imei1', 'imei_no_1', 'imei_serial', 'imei_serial_no', 'imei_serial_number', 'serial_no', 'serial_number', 'serial_numbers', 'serial_nos', 'serial_no_s', 'serial_no_imei', 'sn', 'device_serial'];
const IMEI2_KEYS = ['imei2', 'imei_2', 'imei_no_2', 'second_imei'];

export const serialCell = (r: Record<string, string | undefined>) => SERIAL_KEYS.map((k) => r[k]).find((v) => v && v.trim()) ?? '';
export const imei2Cell = (r: Record<string, string | undefined>) => IMEI2_KEYS.map((k) => r[k]).find((v) => v && v.trim()) ?? '';

/** The numbers in one cell: separated by new lines, commas, semicolons, slashes or pipes; spaces inside one are dropped. */
export const splitSerialCell = (v?: string) => String(v ?? '').split(/[\n\r,;|/]+/).map(cleanSerial).filter(Boolean);

/** Excel shows a long number it treats as a number as 3.56789E+14: the real digits are lost. */
export const isScientific = (s: string) => /^\d+(\.\d+)?e\+?\d+$/i.test(s);

/**
 * "Serial No." in many Indian sheets is the row number (1, 2, 3…), not a device serial. A column whose values are all
 * small whole numbers counting up is treated as row numbers and ignored.
 */
export function looksLikeRowNumbers(values: string[]): boolean {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (v.length < 2) return false;
  if (!v.every((x) => /^\d{1,4}$/.test(x))) return false;
  const n = v.map(Number);
  return n.every((x, i) => i === 0 || x === n[i - 1]! + 1);
}

export class SerialImport {
  private seen = new Set<string>();
  added = 0;
  warnings: string[] = [];
  constructor(private db: Db, private shopId: string, private branchId: string, private userId: string | null) {}

  /**
   * Adds the numbers as units in stock of the item (turning on IMEI / serial tracking for an item with no stock yet).
   * Bad numbers are skipped with a warning rather than failing the whole row. Returns how many were added.
   */
  async add(item: { id: string; name: string }, serials: string[], imei2: string[], rowNo: number): Promise<number> {
    if (!serials.length) return 0;
    const ok: Array<{ s: string; note: string }> = [];
    for (const [i, s] of serials.entries()) {
      if (isScientific(s)) { this.warnings.push(`Row ${rowNo}: IMEI “${s}” was shortened by Excel. Format the IMEI column as Text, type the numbers again and re-import`); continue; }
      if (s.length > 60) { this.warnings.push(`Row ${rowNo}: “${s.slice(0, 20)}…” is too long for a serial / IMEI number, skipped`); continue; }
      if (this.seen.has(s)) { this.warnings.push(`Row ${rowNo}: ${s} is in the file twice, added once`); continue; }
      this.seen.add(s);
      const second = imei2[i] && !isScientific(imei2[i]!) ? `IMEI 2: ${imei2[i]}` : '';
      ok.push({ s, note: ['Imported', second].filter(Boolean).join(' · ') });
    }
    const taken = new Set((await serialsTaken(this.db, this.shopId, ok.map((x) => x.s))).map((t) => t.split(' ')[0]!));
    for (const t of taken) this.warnings.push(`Row ${rowNo}: ${t} is already in your stock records, skipped`);
    const fresh = ok.filter((x) => !taken.has(x.s));
    if (!fresh.length) return 0;
    const it = await one(this.db, 'SELECT type, track_serials, (SELECT coalesce(sum(qty), 0) FROM item_stock WHERE item_id = items.id) AS stock FROM items WHERE shop_id = $1 AND id = $2 FOR UPDATE', [this.shopId, item.id]);
    if (!it || it.type !== 'Goods') { this.warnings.push(`Row ${rowNo}: ${item.name} is a service, its serial numbers were skipped`); return 0; }
    if (!it.track_serials) {
      if (Number(it.stock) > 0) {
        this.warnings.push(`Row ${rowNo}: ${item.name} already has ${Number(it.stock)} in stock without IMEI / serial numbers, so its numbers were skipped. Add them from the item’s Serial numbers tab`);
        return 0;
      }
      await this.db.query('UPDATE items SET track_serials = true WHERE shop_id = $1 AND id = $2', [this.shopId, item.id]);
    }
    await moveStock(this.db, { shopId: this.shopId, itemId: item.id, branchId: this.branchId, qty: fresh.length, reason: 'opening', userId: this.userId, note: 'Imported with IMEI / serial numbers' });
    await this.db.query(
      `INSERT INTO item_serials (shop_id, item_id, branch_id, serial, status, note, received_on)
       SELECT $1, $2, $3, s, 'In stock', n, current_date FROM unnest($4::text[], $5::text[]) AS u(s, n)`,
      [this.shopId, item.id, this.branchId, fresh.map((x) => x.s), fresh.map((x) => x.note)],
    );
    this.added += fresh.length;
    return fresh.length;
  }
}
