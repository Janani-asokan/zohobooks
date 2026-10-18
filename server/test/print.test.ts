import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { DEFAULT_PRINT_SETTINGS } from '../../shared/printSettings';

let owner: Awaited<ReturnType<typeof login>>;
beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('print settings', () => {
  it('starts from the defaults and saves changes', async () => {
    const cur = (await owner.get('/api/shop/print-settings')).body;
    expect(cur).toEqual(DEFAULT_PRINT_SETTINGS);
    const next = { ...cur, thermal: { ...cur.thermal, theme: 'classic', paper: '2in', showTime: true }, barcode: { ...cur.barcode, labelSize: '38x25-2' } };
    const r = await owner.put('/api/shop/print-settings').send(next);
    expect(r.status).toBe(200);
    const saved = (await owner.get('/api/shop/print-settings')).body;
    expect(saved.thermal.theme).toBe('classic');
    expect(saved.thermal.paper).toBe('2in');
    expect(saved.barcode.labelSize).toBe('38x25-2');
  });

  it('rejects more than six label columns and mismatched printer sizes', async () => {
    const cur = (await owner.get('/api/shop/print-settings')).body;
    const seven = { ...cur, barcode: { ...cur.barcode, fields: cur.barcode.fields.map((f: any, i: number) => ({ ...f, enabled: i < 7 })) } };
    expect((await owner.put('/api/shop/print-settings').send(seven)).status).toBe(400);
    const mismatch = { ...cur, barcode: { ...cur.barcode, printer: 'a4', labelSize: '50x25-2' } };
    expect((await owner.put('/api/shop/print-settings').send(mismatch)).status).toBe(400);
  });

  it('only admins can change them', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.get('/api/shop/print-settings')).status).toBe(200);
    expect((await sales.put('/api/shop/print-settings').send(DEFAULT_PRINT_SETTINGS)).status).toBe(403);
  });
});
