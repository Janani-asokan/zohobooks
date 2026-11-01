import { cleanExtra, templateByKey, type ItemField } from '../../../shared/templates';
import { withPrintDefaults } from '../../../shared/printSettings';
import { one, type Db } from '../db';
import { badRequest } from '../http';

export interface ApplyOptions {
  /** Add the template's common items (skipping any whose name the shop already uses). */
  samples: boolean;
  /** Set the counter receipt paper to the template's size. */
  printLayout: boolean;
}

export interface ApplyResult { template: string; fieldsAdded: string[]; unitsAdded: string[]; itemsAdded: number; itemsSkipped: number; printUpdated: boolean }

/**
 * Applies a business template to a shop, inside the caller's tenant transaction. It only adds: existing item fields,
 * units, items and features are kept as they are, and applying the same template twice changes nothing more.
 * Features are not touched here; a new shop's trial is set by provisionShop.
 */
export async function applyTemplate(db: Db, shopId: string, key: string, opts: ApplyOptions): Promise<ApplyResult> {
  const t = templateByKey(key);
  if (!t) throw badRequest('Unknown business type');
  const org = await one(db, 'SELECT item_fields, invoice_fields, units, print_settings FROM organizations WHERE shop_id = $1', [shopId]);
  if (!org) throw badRequest('Business profile not found');

  const fields: ItemField[] = Array.isArray(org.item_fields) ? org.item_fields : [];
  const fieldsAdded = t.itemFields.filter((f) => !fields.some((x) => x.key === f.key));
  const allFields = [...fields, ...fieldsAdded];
  const invFields: ItemField[] = Array.isArray(org.invoice_fields) ? org.invoice_fields : [];
  const invoiceFieldsAdded = (t.invoiceFields ?? []).filter((f) => !invFields.some((x) => x.key === f.key));
  const units: string[] = Array.isArray(org.units) ? org.units : [];
  const unitsAdded = t.units.filter((u) => !units.includes(u));

  let print = org.print_settings;
  let printUpdated = false;
  if (opts.printLayout) {
    const p = withPrintDefaults(org.print_settings);
    printUpdated = p.thermal.paper !== t.thermalPaper;
    print = {
      ...p, thermal: { ...p.thermal, paper: t.thermalPaper },
      invoice: { ...p.invoice, terms: t.invoiceTerms ?? p.invoice.terms, fields: { ...p.invoice.fields, ...(t.printMrp ? { mrp: true } : {}) } },
    };
  }
  await db.query('UPDATE organizations SET business_type = $2, item_fields = $3, units = $4, print_settings = $5, invoice_fields = $6 WHERE shop_id = $1',
    [shopId, t.key, JSON.stringify(allFields), JSON.stringify([...units, ...unitsAdded]), print == null ? null : JSON.stringify(print), JSON.stringify([...invFields, ...invoiceFieldsAdded])]);

  let itemsAdded = 0;
  let itemsSkipped = 0;
  if (opts.samples) {
    for (const s of t.samples) {
      const exists = await one(db, 'SELECT 1 FROM items WHERE shop_id = $1 AND lower(name) = lower($2)', [shopId, s.name]);
      if (exists) { itemsSkipped++; continue; }
      const extra = cleanExtra(allFields, s.extra).value;
      await db.query(
        `INSERT INTO items (shop_id, type, name, unit, hsn, cost, sp1, sp2, sp3, tax_slab_id, reorder_level, track_batches, track_serials, category, extra, description)
         VALUES ($1, 'Goods', $2, $3, $4, 0, $5, $5, $5, $6, 0, $7, $8, $9, $10, '')`,
        // No description: it prints on bills. The owner is told to check prices and rates when the template is applied.
        [shopId, s.name, s.unit, s.hsn, s.price, `tax_${s.gst}`, !!t.trackBatches, !!s.trackSerials, s.category, JSON.stringify(extra)],
      );
      itemsAdded++;
    }
  }
  return { template: t.key, fieldsAdded: [...fieldsAdded, ...invoiceFieldsAdded].map((f) => f.label), unitsAdded, itemsAdded, itemsSkipped, printUpdated };
}
