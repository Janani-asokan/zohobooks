import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { isValidEan13 } from '../../shared/barcode';

/* Onboarding a shop's stock: barcodes for loose items in one go, and item lists imported from a supplier file. */

type Client = Awaited<ReturnType<typeof login>>;
let owner: Client;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  await owner.post('/api/shop/organization/business-type').send({ key: 'toys', samples: false, printLayout: false });
});

describe('barcodes for items that have none', () => {
  it('gives every goods item without one a valid, unique shop barcode and leaves the rest alone', async () => {
    const mk = (name: string, extra: Record<string, unknown> = {}) => owner.post('/api/shop/items').send({ type: 'Goods', name, unit: 'pcs', hsn: '9503', cost: 100, sp1: 199, sp2: 199, sp3: 199, taxSlabId: 'tax_5', ...extra });
    const loose = [(await mk('Loose bouncy ball')).body, (await mk('Loose spinning top')).body, (await mk('Loose whistle')).body];
    const branded = (await mk('Branded puzzle', { barcode: '8901234500017' })).body;
    const service = (await owner.post('/api/shop/items').send({ type: 'Services', name: 'Gift wrapping', unit: 'job', hsn: '9985', cost: 0, sp1: 30, sp2: 30, sp3: 30, taxSlabId: 'tax_18' })).body;
    const r = await owner.post('/api/shop/items/generate-barcodes').send({});
    expect(r.status).toBe(200);
    const items = (await owner.get('/api/shop/items')).body;
    for (const l of loose) {
      const it = items.find((i: any) => i.id === l.id);
      expect(isValidEan13(it.barcode)).toBe(true);
      expect(it.barcode.startsWith('2')).toBe(true);
    }
    expect(items.find((i: any) => i.id === branded.id).barcode).toBe('8901234500017');
    expect(items.find((i: any) => i.id === service.id).barcode).toBe('');
    const codes = items.map((i: any) => i.barcode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    expect((await owner.post('/api/shop/items/generate-barcodes').send({})).body.generated).toBe(0);
  });

  it('staff who cannot edit items cannot generate barcodes', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.post('/api/shop/items/generate-barcodes').send({})).status).toBe(403);
  });
});

describe('importing a supplier’s item list', () => {
  it('keeps MRP, category and brand apart from the price, and uses the trade’s usual GST when the file has none', async () => {
    const m = await owner.post('/api/shop/data-import/map').send({ headers: ['Item Name', 'Barcode', 'MRP', 'Selling Price', 'Category', 'Brand', 'Qty'] });
    expect(m.body.mapping).toMatchObject({ name: 'Item Name', barcode: 'Barcode', mrp: 'MRP', sp1: 'Selling Price', category: 'Category', brand: 'Brand', stock: 'Qty' });
    const r = await owner.post('/api/shop/data-import').send({ kind: 'items', rows: [
      { name: 'Import doll house', barcode: '8901234500024', mrp: '1,499', sp1: '1299', category: 'Dolls', brand: 'Funskool', stock: '6' },
      { name: 'Import kite (MRP only)', mrp: '₹99', category: 'Outdoor', stock: '40' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(2);
    expect(r.body.warnings.join(' ')).toMatch(/set to 5%, the usual rate for your business type/);
    const items = (await owner.get('/api/shop/items')).body;
    expect(items.find((i: any) => i.name === 'Import doll house')).toMatchObject({ sp1: 1299, mrp: 1499, category: 'Dolls', brand: 'Funskool', taxRate: 5, stock: 6, barcode: '8901234500024' });
    expect(items.find((i: any) => i.name === 'Import kite (MRP only)')).toMatchObject({ sp1: 99, mrp: 99, taxRate: 5, stock: 40 });
  });
});

describe('importing items from the Items page (CSV file)', () => {
  it('reads MRP, category and brand, prices MRP-only rows at MRP, uses 5% for toys without a GST column, and updates by barcode', async () => {
    const csv = 'Name,Barcode,Category,Brand,Cost,MRP,SP1,Stock\r\nCSV racing car,0890123450007,Cars,Hot Track,220,399,349,12\r\nCSV skipping rope,,Outdoor,,30,79,,50\r\n';
    const r = await owner.post('/api/shop/items/import').send({ csv });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 2, updated: 0, errors: [] });
    let items = (await owner.get('/api/shop/items')).body;
    expect(items.find((i: any) => i.name === 'CSV racing car')).toMatchObject({ sp1: 349, mrp: 399, category: 'Cars', brand: 'Hot Track', taxRate: 5, stock: 12 });
    expect(items.find((i: any) => i.name === 'CSV skipping rope')).toMatchObject({ sp1: 79, mrp: 79, taxRate: 5, stock: 50 });
    // The supplier's next list has the same box as a 12-digit UPC and a new price: the item is updated, not doubled.
    const again = await owner.post('/api/shop/items/import').send({ csv: 'Name,Barcode,SP1,Tax Rate\r\nCSV racing car (new pack),890123450007,379,18\r\n' });
    expect(again.body).toMatchObject({ created: 0, updated: 1 });
    items = (await owner.get('/api/shop/items')).body;
    const car = items.filter((i: any) => i.name.startsWith('CSV racing car'));
    expect(car).toHaveLength(1);
    expect(car[0]).toMatchObject({ sp1: 379, taxRate: 18, category: 'Cars', mrp: 399 });
  });
});

