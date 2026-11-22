import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { devOutbox } from '../src/mailer';
import { query } from '../src/db';

beforeAll(async () => { await freshDb(); });

const table = {
  filename: 'GSTR3B_summary_2026-10', title: 'GSTR-3B summary', subtitle: 'October 2026',
  columns: [{ label: 'Section' }, { label: 'Taxable', money: true }, { label: 'IGST', money: true }],
  rows: [{ cells: ['3.1(a) Outward taxable', 125000.5, 2250] }, { cells: ['Tax payable', null, 2250], kind: 'total' }],
};

describe('email or WhatsApp a report', () => {
  it('emails an Excel or CSV file to the person typed in', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.post('/api/shop/reports/share').send({ ...table, format: 'xlsx', via: 'email', to: 'not-an-email' })).status).toBe(400);
    const before = devOutbox().length;
    const r = await owner.post('/api/shop/reports/share').send({ ...table, format: 'xlsx', via: 'email', to: 'ca@example.com', message: 'October figures' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mail = devOutbox().slice(before).find((m) => m.to === 'ca@example.com')!;
    expect(mail.subject).toContain('GSTR-3B summary');
    expect(mail.text).toContain('October figures');
    expect(mail.attachments![0]!.filename).toBe('GSTR3B_summary_2026-10.xlsx');
    expect(mail.attachments![0]!.content.subarray(0, 2).toString()).toBe('PK'); // a real .xlsx (zip)

    const csv = await owner.post('/api/shop/reports/share').send({ ...table, format: 'csv', via: 'email', to: 'ca@example.com' });
    expect(csv.status).toBe(200);
    const c = devOutbox().at(-1)!.attachments![0]!;
    expect(c.filename).toBe('GSTR3B_summary_2026-10.csv');
    expect(c.content.toString('utf8')).toContain('125000.50');
  });

  it('makes a 7-day private link for WhatsApp that opens the file without signing in', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const r = await owner.post('/api/shop/reports/share').send({ ...table, format: 'csv', via: 'link' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.text).toContain(r.body.url);
    const path = new URL(r.body.url).pathname;
    const f = await request(app).get(path);
    expect(f.status).toBe(200);
    expect(f.headers['content-disposition']).toMatch(/attachment; filename="GSTR3B_summary_2026-10.csv"/);
    expect(f.headers['content-security-policy']).toContain('sandbox');
    expect(f.text).toContain('3.1(a) Outward taxable');
    // A guessed or expired link opens nothing.
    expect((await request(app).get('/api/public/files/' + '0'.repeat(48))).status).toBe(404);
    await query("UPDATE shared_files SET expires_at = now() - interval '1 minute'");
    expect((await request(app).get(path)).status).toBe(404);
  });

  it('needs permission to read reports', async () => {
    const wh = await login('warehouse@shop.com', 'warehouse123');
    expect((await wh.post('/api/shop/reports/share').send({ ...table, format: 'csv', via: 'link' })).status).toBe(403);
  });
});
