/**
 * Demo data. Run with `npm run db:seed` (wipes and recreates everything).
 * Uses the same services as the API so totals, numbering and stock are computed for real.
 */
import { hashPassword, todayISO } from './auth';
import { config } from './config';
import { pool, query, tx, withTenant } from './db';
import { migrate } from './migrate';
import { provisionShop } from './services/provision';
import { createCreditNote, createInvoice, recordPayment } from './services/documents';
import { moveStock } from './services/stock';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export async function resetDatabase() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(undefined, () => {});
}

/** Demo passwords — DEMO_PASSWORD replaces the well-known ones unless demo mode (simple passwords) is on. */
const pw = (fallback: string) => (config.demoSimplePasswords ? fallback : process.env.DEMO_PASSWORD || fallback);

/** The demo logins and their simple passwords, shown on the login page in demo mode. */
export const DEMO_ACCOUNTS: Array<{ label: string; email: string; password: string; kind: 'super' | 'user' }> = [
  { label: 'Shop owner', email: 'owner@shop.com', password: 'owner123', kind: 'user' },
  { label: 'Super admin', email: 'admin@ledgerly.in', password: 'admin123', kind: 'super' },
  { label: 'Manager', email: 'manager@shop.com', password: 'manager123', kind: 'user' },
  { label: 'Sales staff', email: 'sales@shop.com', password: 'sales123', kind: 'user' },
  { label: 'Accountant', email: 'accounts@shop.com', password: 'accounts123', kind: 'user' },
  { label: 'Warehouse', email: 'warehouse@shop.com', password: 'warehouse123', kind: 'user' },
  { label: 'Loan collector', email: 'collector@shop.com', password: 'collector123', kind: 'user' },
];

/** Demo mode on an existing database: put the demo logins back on their simple passwords. */
export async function resetDemoPasswords() {
  for (const a of DEMO_ACCOUNTS) {
    const hash = await hashPassword(a.password);
    if (a.kind === 'super') await query('UPDATE super_admins SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE lower(email) = $1', [a.email, hash]);
    else {
      const done = await query('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, must_change_password = false WHERE lower(email) = $1 RETURNING id', [a.email, hash]);
      // Demo logins added in later releases are created in the demo shop of an existing database.
      if (!done.length && a.label === 'Warehouse')
        await query(`INSERT INTO users (shop_id, name, email, password_hash, role, branch_id)
          SELECT u.shop_id, 'Murugan P', $1, $2, 'Warehouse', u.branch_id FROM users u WHERE lower(u.email) = 'owner@shop.com' AND u.role = 'Owner'`, [a.email, hash]);
    }
  }
  // The microfinance demo arrived later too: give the demo shop its lending book once.
  const owner = (await query("SELECT shop_id, branch_id FROM users WHERE lower(email) = 'owner@shop.com' AND role = 'Owner'"))[0];
  if (owner && !(await query('SELECT 1 FROM users WHERE lower(email) = $1', ['collector@shop.com'])).length) {
    const { seedLending } = await import('./seedLending');
    await withTenant(owner.shop_id, (db) => seedLending(db, owner.shop_id, owner.branch_id, 'collector123'));
  }
}

export async function seed({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  await resetDatabase();
  await query("INSERT INTO super_admins (name, email, password_hash) VALUES ('Platform Admin', 'admin@ledgerly.in', $1)", [await hashPassword(pw('admin123'))]);

  const others: Array<[string, string, string, string, string, number]> = [
    ['Sri Balaji Textiles', 'Balaji Venkatesh', 'balaji@sbtextiles.in', 'Coimbatore', 'standard', -350],
    ['Green Leaf Organics', 'Fatima Sheikh', 'fatima@greenleaf.co.in', 'Bengaluru', 'premium', -200],
    ['Metro Hardware Hub', 'Joseph Mathew', 'joseph@metrohw.in', 'Kochi', 'standard', -358],
    ['Lotus Pharmacy', 'Dr. Kavitha Rao', 'kavitha@lotuspharma.in', 'Hyderabad', 'premium', -400],
    ['Urban Threads Boutique', 'Neha Kapoor', 'neha@urbanthreads.in', 'Pune', 'trial', -10],
    ['Sai Mobile World', 'Sai Prasad', 'sai@saimobile.in', 'Vijayawada', 'standard', -12],
    ['Annapoorna Sweets', 'Lakshmi Narayanan', 'contact@annapoorna.in', 'Madurai', 'standard', -390],
    ['BlueWave Electronics', 'Arjun Reddy', 'arjun@bluewave.in', 'Visakhapatnam', 'standard', -5],
  ];

  const demo = await provisionShop(null, {
    shopName: 'Aravind Computer Store', ownerName: 'Aravind Kumar', email: 'owner@shop.com', phone: '+91 98400 12345', city: 'Chennai',
    planId: 'premium', years: 1, password: pw('owner123'), mustChangePassword: false, licenseStart: day(-120),
  });
  for (const [i, [name, owner, email, city, plan, start]] of others.entries()) {
    const s = await provisionShop(null, { shopName: name, ownerName: owner, email, phone: `+91 98${String(41000000 + i * 1234567).slice(0, 8)}`, city, planId: plan, years: 1, password: pw('welcome123'), mustChangePassword: true, licenseStart: day(start) });
    if (name === 'Annapoorna Sweets') await query('UPDATE shops SET active = false WHERE id = $1', [s.id]);
  }
  await query('UPDATE shops SET created_at = license_start::timestamptz');
  // SaaS revenue history
  const shops = await query("SELECT id, plan_id, license_start FROM shops WHERE plan_id <> 'trial'");
  for (const s of shops)
    await query("INSERT INTO subscription_payments (shop_id, plan_id, years, amount, method, status, paid_at, created_at) VALUES ($1,$2,1,(SELECT price_per_year FROM plans WHERE id=$2),'manual','paid',$3,$3)", [s.id, s.plan_id, s.license_start]);

  const shopId = demo.id as string;
  await withTenant(shopId, async (db) => {
    await db.query(
      `UPDATE organizations SET legal_name = 'Aravind Computer Store Pvt. Ltd.', gstin = '33AABCA1234F1Z5', address = E'42, Anna Salai, Teynampet\\nChennai, Tamil Nadu 600018',
         state = 'Tamil Nadu', upi_id = 'aravindstore@okhdfcbank', bank_details = E'HDFC Bank · A/c 50200012345678\\nIFSC HDFC0001234 · Teynampet', invoice_template = 'classic' WHERE shop_id = $1`,
      [shopId],
    );
    const head = (await db.query('SELECT id FROM branches WHERE shop_id = $1', [shopId])).rows[0].id;
    const vel = (await db.query("INSERT INTO branches (shop_id, name, address, phone) VALUES ($1,'Velachery Branch','12, 100 Feet Road, Velachery, Chennai 600042','+91 98400 54321') RETURNING id", [shopId])).rows[0].id;
    const hdfc = (await db.query("INSERT INTO bank_accounts (shop_id, name, bank, account_no, type, opening_balance) VALUES ($1,'HDFC Current A/c','HDFC Bank','XXXX XXXX 4821','Bank',250000) RETURNING id", [shopId])).rows[0].id;
    await db.query("UPDATE bank_accounts SET opening_balance = 15000 WHERE shop_id = $1 AND type = 'Cash'", [shopId]);

    const items: Array<[string, string, string, string, string, number, number, number, number, string, number, number?, boolean?]> = [
      // type, name, sku, barcode, hsn, cost, sp1, sp2, sp3, slab, stock, reorder, batches
      ['Goods', 'Logitech M331 Silent Mouse', 'LOG-M331', '5099206066861', '8471', 850, 1199, 1099, 1149, 'tax_18', 42],
      ['Goods', 'HP 680 Ink Cartridge (Black)', 'HP-680B', '0888793164524', '8443', 620, 849, 799, 829, 'tax_18', 65, 10, true],
      ['Goods', 'SanDisk 64GB Pen Drive', 'SD-64U3', '0619659161323', '8523', 390, 599, 549, 569, 'tax_18', 120],
      ['Goods', 'A4 Copier Paper (500 sheets)', 'PAP-A4-75', '8901057510011', '4802', 240, 320, 295, 310, 'tax_12', 300, 50],
      ['Goods', 'Dell 24" FHD Monitor', 'DEL-E2423', '5397184654321', '8528', 9800, 12499, 11899, 12199, 'tax_28', 14, 5],
      ['Goods', 'USB-C Charging Cable 1m', 'CAB-UC1M', '8906000123457', '8544', 90, 199, 169, 179, 'tax_5', 210, 30],
      ['Services', 'Laptop Servicing (General)', 'SRV-LAP', '', '9987', 300, 799, 699, 749, 'tax_18', 0],
      ['Services', 'OS Installation & Setup', 'SRV-OS', '', '9987', 150, 499, 449, 479, 'tax_18', 0],
      ['Services', 'Annual Maintenance Contract', 'SRV-AMC', '', '9987', 2500, 5999, 5499, 5799, 'tax_18', 0],
    ];
    const ids: string[] = [];
    for (const [type, name, sku, barcode, hsn, cost, sp1, sp2, sp3, slab, stock, reorder, batches] of items) {
      const r = await db.query(
        `INSERT INTO items (shop_id, type, name, sku, barcode, unit, hsn, cost, sp1, sp2, sp3, tax_slab_id, reorder_level, track_batches, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - interval '150 days') RETURNING id`,
        [shopId, type, name, sku, barcode, type === 'Goods' ? (name.includes('Paper') ? 'ream' : 'pcs') : 'job', hsn, cost, sp1, sp2, sp3, slab, reorder ?? 10, !!batches],
      );
      ids.push(r.rows[0].id);
      if (stock) {
        if (batches) {
          await moveStock(db, { shopId, itemId: r.rows[0].id, branchId: head, qty: 40, reason: 'opening', batchNo: 'B2401', expiryDate: day(20) });
          await moveStock(db, { shopId, itemId: r.rows[0].id, branchId: head, qty: stock - 40, reason: 'opening', batchNo: 'B2407', expiryDate: day(300) });
        } else {
          await moveStock(db, { shopId, itemId: r.rows[0].id, branchId: head, qty: Math.ceil(stock * 0.7), reason: 'opening' });
          await moveStock(db, { shopId, itemId: r.rows[0].id, branchId: vel, qty: Math.floor(stock * 0.3), reason: 'opening' });
        }
      }
    }

    const customers: Array<[string, string, string, string, string, string, string, string, string]> = [
      ['Business', 'Priya Raman', 'Nila Textiles', '33AAFCN5678K1Z2', 'accounts@nilatextiles.in', '+91 94440 11223', 'Tamil Nadu', 'T. Nagar, Chennai 600017', 'SP2'],
      ['Individual', 'Karthik Subramanian', '', '', 'karthik.s@gmail.com', '+91 98765 43210', 'Tamil Nadu', 'Adyar, Chennai 600020', 'SP1'],
      ['Business', 'Rahul Menon', 'Menon Associates', '32AAKFM4321P1Z9', 'rahul@menonassoc.com', '+91 90480 77881', 'Kerala', 'MG Road, Kochi 682016', 'SP1'],
      ['Individual', 'Divya Lakshmi', '', '', 'divya.l@outlook.com', '+91 99620 33445', 'Tamil Nadu', 'Velachery, Chennai 600042', 'SP3'],
      ['Business', 'Sanjay Gupta', 'BrightPath Academy', '33AAGCB9988L1Z1', 'admin@brightpath.edu.in', '+91 97910 66554', 'Tamil Nadu', 'Anna Nagar, Chennai 600040', 'SP2'],
      ['Individual', 'Mohammed Irfan', '', '', '', '+91 98840 22113', 'Karnataka', 'Indiranagar, Bengaluru 560038', 'SP1'],
    ];
    // Categories, brands & MRP (Zoho Inventory-style catalogue)
    const meta: Array<[string, string, string, number | null]> = [
      ['LOG-M331', 'Computer Accessories', 'Logitech', 1495], ['HP-680B', 'Printer Supplies', 'HP', 999], ['SD-64U3', 'Storage', 'SanDisk', 799],
      ['PAP-A4-75', 'Stationery', 'JK Copier', 360], ['DEL-E2423', 'Monitors', 'Dell', 15999], ['CAB-UC1M', 'Computer Accessories', 'Portronics', 299],
      ['SRV-LAP', 'Repair Services', '', null], ['SRV-OS', 'Repair Services', '', null], ['SRV-AMC', 'Contracts', '', null],
    ];
    for (const [sku, cat, brand, mrp] of meta) await db.query('UPDATE items SET category = $3, brand = $4, mrp = $5 WHERE shop_id = $1 AND sku = $2', [shopId, sku, cat, brand, mrp]);

    const cust: string[] = [];
    for (const [type, name, company, gstin, email, phone, state, address, tier] of customers) {
      const n = (await db.query("UPDATE counters SET value = CASE WHEN value < 1581 THEN 1582 ELSE value + 1 END WHERE shop_id = $1 AND key = 'customer' RETURNING value", [shopId])).rows[0].value;
      const r = await db.query(
        'INSERT INTO customers (shop_id, custom_id, type, name, company_name, gstin, email, phone, state, address, tier, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - interval \'140 days\') RETURNING id',
        [shopId, `ACS-${n}`, type, name, company, gstin, email, phone, state, address, tier],
      );
      cust.push(r.rows[0].id);
    }

    // Invoices spread over ~6 months: [customer, [itemIdx, qty]..., gst, paidFraction, dayOffset]
    const plan: Array<[number, Array<[number, number]>, boolean, number, number]> = [
      [0, [[0, 5], [3, 10]], true, 1, -165], [1, [[6, 1]], false, 1, -150], [2, [[4, 2], [0, 2]], true, 1, -128], [4, [[3, 20], [2, 15]], true, 1, -110],
      [3, [[7, 1], [5, 2]], true, 0.5, -90], [0, [[8, 1]], true, 1, -70], [5, [[4, 1]], true, 0, -55], [1, [[2, 2], [5, 3]], false, 1, -40],
      [4, [[4, 3], [8, 1]], true, 0, -30], [2, [[8, 1]], true, 0, -20], [3, [[1, 4]], true, 1, -9], [0, [[0, 3], [5, 6]], true, 0, -3],
    ];
    const tierOf = (ci: number) => customers[ci]![8] as 'SP1' | 'SP2' | 'SP3';
    const invIds: string[] = [];
    for (const [ci, lines, gst, paid, off] of plan) {
      const date = day(off);
      const inv = await createInvoice(db, null, shopId, {
        customerId: cust[ci]!, date, dueDate: day(off + 15), branchId: off % 2 ? vel : head, withGst: gst, reverseCharge: false, tcsRate: 0, notes: '',
        lines: lines.map(([ix, qty]) => ({ itemId: ids[ix]!, qty, tier: tierOf(ci), discount: 0 })),
      }, { issue: true });
      invIds.push(inv.id);
      if (paid > 0) {
        const amt = Math.round(inv.total * paid);
        await recordPayment(db, null, shopId, inv.id, { date: day(Math.min(0, off + 6)), amount: amt, tdsAmount: 0, mode: paid < 1 ? 'Cash' : ci % 2 ? 'UPI' : 'Bank Transfer', reference: '', accountId: paid < 1 ? null : hdfc, notes: '' });
      }
    }
    // a draft, a credit note, and a POS sale
    await createInvoice(db, null, shopId, { customerId: cust[5]!, date: day(0), dueDate: day(15), branchId: head, withGst: true, reverseCharge: false, tcsRate: 0, notes: 'Quote follow-up', lines: [{ itemId: ids[2]!, qty: 5, tier: 'SP1', discount: 5 }] }, { issue: false });
    const fakeReq = { ctx: undefined, ip: '' } as any;
    const firstInv = (await db.query('SELECT lines FROM invoices WHERE id = $1', [invIds[3]])).rows[0];
    await createCreditNote(db, fakeReq, shopId, { invoiceId: invIds[3]!, date: day(-100), reason: 'Sales return', restock: true, lines: [{ lineId: firstInv.lines[0].id, qty: 2 }] });

    await db.query(
      `INSERT INTO sales_orders (shop_id, number, customer_id, date, expiry_date, lines, with_gst, status, notes, total) VALUES
        ($1,'SO-0001',$2,$5,$6,'[]',true,'Accepted','Lab upgrade',0), ($1,'SO-0002',$3,$7,$8,'[]',true,'Sent','',0), ($1,'SO-0003',$4,$9,$10,'[]',false,'Draft','',0)`,
      [shopId, cust[4], cust[2], cust[1], day(-6), day(24), day(-3), day(27), day(-1), day(29)],
    );
    await db.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'so',3)", [shopId]);
    // fill SO lines with real computed data
    const soLines = [[[4, 5]], [[8, 1]], [[0, 2], [5, 4]]];
    const sos = (await db.query('SELECT id, number FROM sales_orders WHERE shop_id = $1 ORDER BY number', [shopId])).rows;
    const { buildLines } = await import('./services/documents');
    const { computeTotals } = await import('../../shared/calc');
    for (const [i, so] of sos.entries()) {
      const lines = await buildLines(db, shopId, soLines[i]!.map(([ix, qty]) => ({ itemId: ids[ix!]!, qty: qty!, tier: 'SP1' as const, discount: 0 })));
      await db.query('UPDATE sales_orders SET lines = $2, total = $3 WHERE id = $1', [so.id, JSON.stringify(lines), computeTotals(lines, i !== 2, i === 1).total]);
    }
    // quotes waiting on customers
    const quotes: Array<[string, number, number, string, Array<[number, number]>]> = [['QT-0001', 3, -4, 'Sent', [[0, 10], [2, 2]]], ['QT-0002', 0, -1, 'Draft', [[5, 3]]], ['QT-0003', 5, -12, 'Declined', [[4, 1]]]];
    for (const [number, ci, off, status, picks] of quotes) {
      const lines = await buildLines(db, shopId, picks.map(([ix, qty]) => ({ itemId: ids[ix]!, qty, tier: 'SP1' as const, discount: 0 })));
      await db.query(
        `INSERT INTO sales_orders (shop_id, kind, number, customer_id, date, expiry_date, lines, with_gst, status, notes, total) VALUES ($1,'quote',$2,$3,$4,$5,$6,true,$7,'',$8)`,
        [shopId, number, cust[ci], day(off), day(off + 15), JSON.stringify(lines), status, computeTotals(lines, true, false).total],
      );
    }
    await db.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'qt',3)", [shopId]);

    const v = (await db.query(
      `INSERT INTO vendors (shop_id, name, gstin, phone, email, state) VALUES
        ($1,'Redington India Ltd.','33AABCR1234D1Z8','+91 44 4224 3353','orders@redington.in','Tamil Nadu'),
        ($1,'Ingram Micro India','27AAACI2345E1Z3','+91 22 6888 8888','sales@ingrammicro.in','Maharashtra'),
        ($1,'Chennai Paper Mart','33AAFFC7788Q1Z6','+91 98410 22110','cpm@papermart.in','Tamil Nadu') RETURNING id`,
      [shopId],
    )).rows.map((r) => r.id);
    // Itemised stock purchases: each bill brings in goods at cost (moved out of opening stock, so stock levels stay as above).
    const { buildPurchaseLines: billLines, purchaseTotals: billTotals } = await import('./routes/shop/purchasing');
    const bills: Array<[number, number, number, Array<[number, number]>, 'Open' | 'Paid', string]> = [
      [0, -35, -5, [[4, 10]], 'Paid', 'Monitors ×10'], [1, -20, 10, [[0, 30], [2, 40]], 'Open', 'Peripherals restock'], [2, -8, 22, [[3, 100]], 'Open', 'A4 paper ×100 reams'],
    ];
    for (const [i, [vi, d, due, picks, , desc]] of bills.entries()) {
      const lines = await billLines(db, shopId, picks.map(([ix, qty]) => ({ itemId: ids[ix]!, qty })));
      const t = billTotals(lines);
      const number = `BILL-${String(i + 1).padStart(4, '0')}`;
      const bill = (await db.query(
        `INSERT INTO bills (shop_id, number, vendor_id, date, due_date, taxable_amount, tax_amount, amount, status, description, lines, branch_id, stock_added)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Open',$9,$10,$11,true) RETURNING id`,
        [shopId, number, v[vi], day(d), day(due), t.sub, t.tax, t.total, desc, JSON.stringify(lines.map((l) => ({ ...l, received: l.qty }))), head],
      )).rows[0].id;
      for (const [ix, qty] of picks) {
        await moveStock(db, { shopId, itemId: ids[ix]!, branchId: head, qty: -qty, reason: 'opening', note: 'Opening stock moved to purchase' });
        await moveStock(db, { shopId, itemId: ids[ix]!, branchId: head, qty, reason: 'purchase', refType: 'bill', refId: bill, note: number });
      }
    }
    await db.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'bill',3)", [shopId]);
    // Bill 1 paid in full, bill 2 in part; each payment is a bank withdrawal.
    const { payBill } = await import('./routes/shop/money');
    const billIds = (await db.query('SELECT id, status FROM bills WHERE shop_id = $1 ORDER BY number', [shopId])).rows.map((r) => r.id);
    for (const [i, [, d, , , st]] of bills.entries())
      if (st === 'Paid') await payBill(db, null, shopId, billIds[i], { accountId: hdfc, date: day(d + 1), tdsAmount: 0, mode: 'Bank Transfer', reference: 'NEFT', notes: '' }, null);
    await payBill(db, null, shopId, billIds[1], { accountId: hdfc, date: day(-6), amount: 20000, tdsAmount: 0, mode: 'UPI', reference: '', notes: 'Part payment' }, null);
    for (const [acc, d, desc, amt, cat] of [
      [hdfc, -25, 'Godown rent — Ambattur', -12000, 'Rent'],
      [hdfc, -9, 'Electricity bill', -6240, 'Utilities'],
    ] as const)
      await db.query('INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category) VALUES ($1,$2,$3,$4,$5,$6)', [shopId, acc, day(d), desc, amt, cat]);

    await db.query(
      `INSERT INTO users (shop_id, name, email, password_hash, role, branch_id) VALUES
        ($1,'Meena Krishnan','manager@shop.com',$3,'Manager',$2), ($1,'Vignesh R','sales@shop.com',$4,'Sales Staff',$5), ($1,'Anitha S','accounts@shop.com',$6,'Accountant',$2),
        ($1,'Murugan P','warehouse@shop.com',$7,'Warehouse',$2)`,
      [shopId, head, await hashPassword(pw('manager123')), await hashPassword(pw('sales123')), vel, await hashPassword(pw('accounts123')), await hashPassword(pw('warehouse123'))],
    );
    // A purchase order half-received, and a few expenses
    const { buildPurchaseLines, purchaseTotals } = await import('./routes/shop/purchasing');
    const poLines = await buildPurchaseLines(db, shopId, [{ itemId: ids[0]!, qty: 20 }, { itemId: ids[2]!, qty: 50 }]);
    poLines[0]!.received = 20;
    const pt = purchaseTotals(poLines);
    await db.query(
      `INSERT INTO purchase_orders (shop_id, number, vendor_id, branch_id, date, expected_date, lines, status, sub_total, tax_total, total, notes)
       VALUES ($1,'PO-0001',$2,$3,$4,$5,$6,'Partially Received',$7,$8,$9,'Festive season restock'), ($1,'PO-0002',$10,$3,$11,$12,$13,'Issued',$14,$15,$16,'')`,
      [shopId, v[1], head, day(-6), day(4), JSON.stringify(poLines), pt.sub, pt.tax, pt.total, v[2], day(-1), day(6),
        JSON.stringify(await buildPurchaseLines(db, shopId, [{ itemId: ids[3]!, qty: 100 }])), 24000, 2880, 26880],
    );
    await moveStock(db, { shopId, itemId: ids[0]!, branchId: head, qty: 20, reason: 'purchase', refType: 'purchase_order', note: 'PO-0001' });
    await db.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'po',2)", [shopId]);
    const cashAcc = (await db.query("SELECT id FROM bank_accounts WHERE shop_id = $1 AND type = 'Cash' LIMIT 1", [shopId])).rows[0].id;
    for (const [d, cat, desc, amt, tax, acc] of [
      [-28, 'Rent', 'Shop rent — Anna Salai', 35000, 0, hdfc], [-20, 'Internet & Phone', 'Airtel broadband', 1179, 212, hdfc],
      [-12, 'Fuel & Travel', 'Delivery fuel', 1800, 0, cashAcc], [-5, 'Food & Refreshments', 'Tea & snacks', 640, 0, cashAcc],
    ] as const)
      await db.query('INSERT INTO expenses (shop_id, date, category, description, amount, tax_amount, account_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [shopId, day(d), cat, desc, amt, tax, acc]);

    await db.query(
      `INSERT INTO recurring_profiles (shop_id, name, customer_id, frequency, start_date, next_date, lines, with_gst, terms_days, branch_id, auto_issue)
       VALUES ($1,'BrightPath AMC (monthly)',$2,'monthly',$3,$4,$5,true,15,$6,true)`,
      [shopId, cust[4], day(-60), day(5), JSON.stringify([{ itemId: ids[8], qty: 1, tier: 'SP2', discount: 0 }]), head],
    );
    const { seedLending } = await import('./seedLending');
    await seedLending(db, shopId, head, pw('collector123'));
  });
  await tx(async (db) => db.query("INSERT INTO audit_log (shop_id, actor_type, actor_name, action, entity) VALUES (NULL,'system','System','seed','database')"));
  log(`[seed] done — today ${todayISO()}`);
  if (process.env.DEMO_PASSWORD && !config.demoSimplePasswords) log('  All demo accounts use the DEMO_PASSWORD value.');
  else {
    log('  Super admin : admin@ledgerly.in / admin123');
    log('  Shop owner  : owner@shop.com / owner123');
    log('  Staff       : manager@shop.com / manager123 · sales@shop.com / sales123 · accounts@shop.com / accounts123 · warehouse@shop.com / warehouse123 · collector@shop.com / collector123');
  }
}

if (/seed\.(ts|js)$/.test(process.argv[1] ?? '')) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
