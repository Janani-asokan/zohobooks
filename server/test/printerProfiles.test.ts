import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

const tsc = { language: 'tspl', dpi: 203, headMm: 108, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 };

describe('printer profiles', () => {
  it('saves the label roll, turn and page size on a printer, and one printer is the shop default', async () => {
    const a = await owner.post('/api/shop/label/printers').send({ name: 'TSC 156 · 38x25 2-up', settings: { ...tsc, stockId: 'preset:3in-38x25x2', turn: 90, pageSize: 'exact' } });
    expect(a.status).toBe(200);
    const b = await owner.post('/api/shop/label/printers').send({ name: 'Zebra ZD220 · 4x6 shipping', settings: { ...tsc, language: 'zpl', stockId: 'preset:4in-100x150' } });
    expect(b.status).toBe(200);

    expect((await owner.post(`/api/shop/label/printers/${a.body.id}/default`)).status).toBe(200);
    expect((await owner.post(`/api/shop/label/printers/${b.body.id}/default`)).status).toBe(200);
    const setup = (await owner.get('/api/shop/label/setup')).body;
    const byName = Object.fromEntries(setup.printers.map((p: any) => [p.name, p]));
    expect(byName['TSC 156 · 38x25 2-up'].settings).toMatchObject({ stockId: 'preset:3in-38x25x2', turn: 90, pageSize: 'exact' });
    expect(byName['TSC 156 · 38x25 2-up'].isDefault).toBe(false);
    expect(byName['Zebra ZD220 · 4x6 shipping'].isDefault).toBe(true);
  });

  it('refuses a bad turn or page size', async () => {
    expect((await owner.post('/api/shop/label/printers').send({ name: 'x', settings: { ...tsc, turn: 45 } })).status).toBe(400);
    expect((await owner.post('/api/shop/label/printers').send({ name: 'x', settings: { ...tsc, pageSize: 'a4' } })).status).toBe(400);
  });

  it('keeps a no-gap roll in the shop’s print settings', async () => {
    const cur = (await owner.get('/api/shop/print-settings')).body;
    const layout = { stock: 'roll', w: 38, h: 25, across: 2, rows: 0, gapX: 0, gapY: 0, marginX: 1, marginY: 0, rollMm: 80, rotate: 0, media: 'continuous' };
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, barcode: { ...cur.barcode, layout } })).status).toBe(200);
    expect((await owner.get('/api/shop/print-settings')).body.barcode.layout).toMatchObject({ gapX: 0, gapY: 0, media: 'continuous' });
  });
});

describe('what the Print button prints for a bill', () => {
  it('is a 58 mm receipt by default, can be changed, and is kept when an older client leaves it out', async () => {
    const cur = (await owner.get('/api/shop/print-settings')).body;
    expect(cur.invoice.printAs).toBe('2in');
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, invoice: { ...cur.invoice, printAs: 'a4' } })).status).toBe(200);
    const { printAs: _drop, ...older } = (await owner.get('/api/shop/print-settings')).body.invoice;
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, invoice: older })).status).toBe(200);
    expect((await owner.get('/api/shop/print-settings')).body.invoice.printAs).toBe('a4');
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, invoice: { ...cur.invoice, printAs: 'a3' } })).status).toBe(400);
  });
});
