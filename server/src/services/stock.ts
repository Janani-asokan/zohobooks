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
