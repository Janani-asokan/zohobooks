import type { Db } from '../db';
import { many, one } from '../db';
import { HttpError } from '../http';

export type StockReason = 'opening' | 'sale' | 'sale_cancel' | 'credit_note' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'transfer_cancel' | 'purchase';

interface Move {
  shopId: string;
  itemId: string;
  branchId: string;
  qty: number; // signed
  reason: StockReason;
  refType?: string;
  refId?: string | null;
  note?: string;
  userId?: string | null;
  batchNo?: string;
  expiryDate?: string | null;
}

/**
 * Applies a stock change for a Goods item at a branch and records the movement.
 * Batch-tracked items: stock-in adds to the named batch; stock-out consumes batches
 * first-expiry-first-out (FEFO). Returns the batches consumed (for invoice lines).
 */
export async function moveStock(db: Db, m: Move): Promise<Array<{ batchNo: string; qty: number; expiryDate: string | null }>> {
  const item = await one(db, 'SELECT type, track_batches FROM items WHERE shop_id = $1 AND id = $2', [m.shopId, m.itemId]);
  if (!item || item.type !== 'Goods' || m.qty === 0) return [];
  await db.query(
    `INSERT INTO item_stock (shop_id, item_id, branch_id, qty) VALUES ($1,$2,$3,$4)
     ON CONFLICT (item_id, branch_id) DO UPDATE SET qty = item_stock.qty + EXCLUDED.qty`,
    [m.shopId, m.itemId, m.branchId, m.qty],
  );
  const used: Array<{ batchNo: string; qty: number; expiryDate: string | null }> = [];
  if (item.track_batches) {
    if (m.qty > 0) {
      const batchNo = m.batchNo?.trim() || 'DEFAULT';
      await db.query(
        `INSERT INTO item_batches (shop_id, item_id, branch_id, batch_no, expiry_date, qty) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (item_id, branch_id, batch_no) DO UPDATE SET qty = item_batches.qty + EXCLUDED.qty,
           expiry_date = COALESCE(EXCLUDED.expiry_date, item_batches.expiry_date)`,
        [m.shopId, m.itemId, m.branchId, batchNo, m.expiryDate ?? null, m.qty],
      );
      used.push({ batchNo, qty: m.qty, expiryDate: m.expiryDate ?? null });
    } else {
      let need = -m.qty;
      const batches = m.batchNo
        ? await many(db, 'SELECT * FROM item_batches WHERE shop_id=$1 AND item_id=$2 AND branch_id=$3 AND batch_no=$4 FOR UPDATE', [m.shopId, m.itemId, m.branchId, m.batchNo])
        : await many(db, 'SELECT * FROM item_batches WHERE shop_id=$1 AND item_id=$2 AND branch_id=$3 AND qty > 0 ORDER BY expiry_date NULLS LAST, created_at FOR UPDATE', [m.shopId, m.itemId, m.branchId]);
      for (const b of batches) {
        if (need <= 0) break;
        const take = Math.min(need, Number(b.qty));
        if (take <= 0) continue;
        await db.query('UPDATE item_batches SET qty = qty - $2 WHERE id = $1', [b.id, take]);
        used.push({ batchNo: b.batch_no, qty: take, expiryDate: b.expiry_date });
        need -= take;
      }
    }
  }
  const batchLabel = used.map((u) => u.batchNo).join(',') || m.batchNo || '';
  await db.query(
    `INSERT INTO stock_movements (shop_id, item_id, branch_id, qty_change, reason, batch_no, ref_type, ref_id, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [m.shopId, m.itemId, m.branchId, m.qty, m.reason, batchLabel, m.refType ?? '', m.refId ?? null, m.note ?? '', m.userId ?? null],
  );
  return used;
}

/* ---------------- Serial numbers ---------------- */

/** Marks the serials on an invoice line as sold. Serial-tracked items need exactly one serial per unit, in stock at the branch. */
export async function sellSerials(db: Db, shopId: string, line: { itemId: string; name: string; qty: number; serials?: string[] }, branchId: string, invoiceId: string) {
  const item = await one(db, 'SELECT track_serials FROM items WHERE shop_id = $1 AND id = $2', [shopId, line.itemId]);
  if (!item?.track_serials) return;
  const serials = [...new Set((line.serials ?? []).map((s) => s.trim()).filter(Boolean))];
  if (!Number.isInteger(line.qty) || serials.length !== line.qty)
    throw new HttpError(400, `${line.name} needs ${line.qty} serial number${line.qty === 1 ? '' : 's'} (${serials.length} entered)`, 'serials_required');
  const rows = await many(db, "SELECT id, serial FROM item_serials WHERE shop_id = $1 AND item_id = $2 AND branch_id = $3 AND status = 'In stock' AND serial = ANY($4::text[]) FOR UPDATE", [shopId, line.itemId, branchId, serials]);
  const found = new Set(rows.map((r) => r.serial));
  const missing = serials.filter((s) => !found.has(s));
  if (missing.length) throw new HttpError(400, `Not in stock at this branch for ${line.name}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`, 'serials_unavailable');
  await db.query("UPDATE item_serials SET status = 'Sold', invoice_id = $3, updated_at = now() WHERE shop_id = $1 AND id = ANY($2::uuid[])", [shopId, rows.map((r) => r.id), invoiceId]);
}

/** Puts an invoice's sold serials back in stock (invoice cancelled or edited). */
export async function releaseSerials(db: Db, shopId: string, invoiceId: string) {
  await db.query("UPDATE item_serials SET status = 'In stock', invoice_id = NULL, updated_at = now() WHERE shop_id = $1 AND invoice_id = $2 AND status = 'Sold'", [shopId, invoiceId]);
}

/** A serial / IMEI as it is stored: spaces dropped (typed in groups or pasted), at most 60 characters. */
export const cleanSerial = (s: string) => String(s ?? '').replace(/\s+/g, '');

/**
 * Serials / IMEIs that are already taken anywhere in the shop (any item, any status), so one number is never two units.
 * Returns "IMEI (item name)" strings for the error message.
 */
export async function serialsTaken(db: Db, shopId: string, serials: string[]): Promise<string[]> {
  if (!serials.length) return [];
  const rows = await many(db, 'SELECT s.serial, i.name FROM item_serials s JOIN items i ON i.id = s.item_id WHERE s.shop_id = $1 AND s.serial = ANY($2::text[]) ORDER BY s.serial', [shopId, serials]);
  return rows.map((r) => `${r.serial} (${r.name})`);
}

/** Checks a list of serials for one line: none blank, no repeats, each at most 60 characters. Returns them cleaned. */
export function checkSerialList(name: string, raw: string[]): string[] {
  const serials = raw.map(cleanSerial).filter(Boolean);
  const long = serials.find((s) => s.length > 60);
  if (long) throw new HttpError(400, `${name}: “${long.slice(0, 20)}…” is too long for a serial / IMEI number`, 'serials_invalid');
  const seen = new Set<string>();
  const dup = serials.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
  if (dup.length) throw new HttpError(400, `${name}: ${[...new Set(dup)].slice(0, 5).join(', ')} entered twice`, 'serials_duplicate');
  return serials;
}

/**
 * Registers the serials / IMEIs of units just received (a purchase bill or a purchase order delivery). Serial-tracked
 * items need exactly one per unit received; every number must be new to the shop. Each remembers its bill or order,
 * vendor and the day it came in, for warranty.
 */
export async function receiveSerials(db: Db, p: { shopId: string; itemId: string; name: string; qty: number; serials?: string[]; branchId: string; billId?: string | null; purchaseOrderId?: string | null; vendorId: string; date: string; note: string }) {
  const item = await one(db, 'SELECT track_serials FROM items WHERE shop_id = $1 AND id = $2', [p.shopId, p.itemId]);
  if (!item?.track_serials) return 0;
  const serials = checkSerialList(p.name, p.serials ?? []);
  if (!Number.isInteger(p.qty)) throw new HttpError(400, `${p.name} has serial / IMEI numbers, so its quantity must be a whole number`, 'serials_required');
  if (serials.length !== p.qty)
    throw new HttpError(400, `${p.name} needs ${p.qty} serial / IMEI number${p.qty === 1 ? '' : 's'}, one per unit (${serials.length} entered)`, 'serials_required');
  const taken = await serialsTaken(db, p.shopId, serials);
  if (taken.length) throw new HttpError(400, `Already in your stock records: ${taken.slice(0, 5).join(', ')}${taken.length > 5 ? '…' : ''}`, 'serials_taken');
  await db.query(
    `INSERT INTO item_serials (shop_id, item_id, branch_id, serial, status, note, bill_id, purchase_order_id, vendor_id, received_on)
     SELECT $1, $2, $3, unnest($4::text[]), 'In stock', $5, $6, $7, $8, $9`,
    [p.shopId, p.itemId, p.branchId, serials, p.note, p.billId ?? null, p.purchaseOrderId ?? null, p.vendorId, p.date],
  );
  return serials.length;
}
