import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { query } from '../src/db';

beforeAll(async () => { await freshDb(); });

describe('WhatsApp support channel', () => {
  it('the team sets its WhatsApp number; shops get it in Help and on the public pages', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    const cur = (await admin.get('/api/platform/support/settings')).body;
    expect((await admin.put('/api/platform/support/settings').send({ ...cur, whatsapp: '12345' })).status).toBe(400);
    const ok = await admin.put('/api/platform/support/settings').send({ ...cur, whatsapp: '+91 98400 12345' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.whatsapp).toBe('+91 98400 12345');
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.get('/api/shop/support/contact')).body.whatsapp).toBe('919840012345');
    const pub = await sales.get('/api/public/contact');
    expect(pub.body.whatsapp).toBe('919840012345');
  });

  it('records each "WhatsApp us" tap with the conversation; staff see it and mark it handled', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    const r = await sales.post('/api/shop/support/whatsapp').send({ question: 'Printer not printing', chat: [{ role: 'user', text: 'Printer not printing' }, { role: 'bot', text: 'Try this…' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.recorded).toBe(true);
    const admin = await login('admin@ledgerly.in', 'admin123');
    const list = (await admin.get('/api/platform/support/whatsapp')).body;
    const w = list.contacts.find((x: { question: string }) => x.question === 'Printer not printing');
    expect(w).toMatchObject({ status: 'open', contactName: 'Vignesh R', shop: { name: 'Aravind Computer Store' } });
    expect(w.chat).toHaveLength(2);
    expect(list.counts.open).toBeGreaterThan(0);
    const done = await admin.patch(`/api/platform/support/whatsapp/${w.id}`).send({ status: 'done', staffNotes: 'Reinstalled driver' });
    expect(done.body).toMatchObject({ status: 'done', staffNotes: 'Reinstalled driver', handledBy: 'Platform Admin' });
    expect((await admin.get('/api/platform/support/whatsapp?view=done')).body.contacts.some((x: { id: string }) => x.id === w.id)).toBe(true);
  });

  it('keeps each shop to its own records and limits repeated taps', async () => {
    const shop = (await query("SELECT shop_id FROM users WHERE email = 'sales@shop.com'"))[0].shop_id;
    const owner = await login('owner@shop.com', 'owner123');
    for (let i = 0; i < 9; i++) await owner.post('/api/shop/support/whatsapp').send({ question: `q${i}` });
    expect((await owner.post('/api/shop/support/whatsapp').send({ question: 'one too many' })).status).toBe(429);
    const [{ n }] = await query('SELECT count(*)::int AS n FROM support_whatsapp WHERE shop_id = $1', [shop]);
    expect(n).toBe(10);
    const shopUser = await login('owner@shop.com', 'owner123');
    expect([401, 403]).toContain((await shopUser.get('/api/platform/support/whatsapp')).status);
  });
});
