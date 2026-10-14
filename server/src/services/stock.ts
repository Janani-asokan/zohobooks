import type { Db } from '../db';
import { many, one } from '../db';

export type StockReason = 'opening' | 'sale' | 'sale_cancel' | 'credit_note' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'purchase';

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
