import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';
import { devOutbox } from '../src/mailer';
import { leadRecipients, runLeadReminders } from '../src/services/salesLeads';
import { isPaidShop, salesContact } from '../../shared/support';

let shopId = '';
const pub = () => request(app).post('/api/public/sales-leads').set('X-Requested-With', 'ledgerly');
const setPlan = (plan: string, end = '2030-01-01') => query('UPDATE shops SET plan_id = $2, license_end = $3 WHERE id = $1', [shopId, plan, end]);

beforeAll(async () => {
  await freshDb();
  shopId = (await query("SELECT shop_id FROM users WHERE email = 'owner@shop.com'"))[0].shop_id;
});

describe('who Help connects you to', () => {
  it('paid plan with a current license → customer care; trial or expired → sales', () => {
    expect(isPaidShop({ planId: 'premium', licenseExpired: false })).toBe(true);
    expect(isPaidShop({ planId: 'trial', licenseExpired: false })).toBe(false);
    expect(isPaidShop({ planId: 'standard', licenseExpired: true })).toBe(false);
    expect(salesContact({ phone: '1', email: 'help@x.in', whatsapp: '+91 98400 12345', salesEmail: 'sales@x.in' }))
      .toEqual({ phone: '1', email: 'sales@x.in', whatsapp: '919840012345' });
  });
});

describe('Talk to sales from the public pages', () => {
  it('the team sets a sales contact; the public pages get it (support contact fills any gap)', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    const cur = (await admin.get('/api/platform/support/settings')).body;
    const r = await admin.put('/api/platform/support/settings').send({ ...cur, email: 'help@corpus360lite.com', salesEmail: 'sales@corpus360lite.com', salesWhatsapp: '+91 98400 67890' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ salesEmail: 'sales@corpus360lite.com', salesWhatsapp: '+91 98400 67890' });
    const c = (await request(app).get('/api/public/contact')).body;
    expect(c.sales).toMatchObject({ email: 'sales@corpus360lite.com', whatsapp: '919840067890' });
  });

  it('a visitor leaves a number; it lands in Sales leads and staff work it', async () => {
    expect((await pub().send({ name: 'Meena', source: 'landing' })).status).toBe(400); // no phone or email
    expect((await pub().send({ name: 'Meena', phone: '123', source: 'landing' })).status).toBe(400);
    const ok = await pub().send({ name: 'Meena Stores', phone: '98400 55555', business: 'Meena Textiles', city: 'Madurai', message: 'Need a demo', source: 'signup', page: '/signup' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const admin = await login('admin@ledgerly.in', 'admin123');
    const list = (await admin.get('/api/platform/support/leads')).body;
    const lead = list.leads.find((l: { business: string }) => l.business === 'Meena Textiles');
    expect(lead).toMatchObject({ source: 'signup', status: 'new', phone: '98400 55555', whatsapp: '919840055555' });
    expect(list.counts.new).toBeGreaterThan(0);
    const won = await admin.patch(`/api/platform/support/leads/${lead.id}`).send({ status: 'won', staffNotes: 'Bought Standard' });
    expect(won.body).toMatchObject({ status: 'won', staffNotes: 'Bought Standard', handledBy: 'Platform Admin' });
    expect((await admin.get('/api/platform/support/leads?view=won')).body.leads.some((l: { id: string }) => l.id === lead.id)).toBe(true);
  });

  it('the hidden trap field: kept but marked (a browser autofill might have filled it), never emailed or counted', async () => {
    expect((await pub().send({ name: 'Bot', phone: '9840000001', website: 'http://spam.example' })).status).toBe(201);
    const [r] = await query("SELECT suspected_spam, notified_to FROM sales_leads WHERE phone = '9840000001'");
    expect(r).toMatchObject({ suspected_spam: true, notified_to: '' });
  });

  it('the sales team is told: email to the sales inbox, a confirmation to the visitor, one lead per person a day', async () => {
    const out = devOutbox(); const from = out.length;
    const a = await pub().send({ name: 'Ravi', phone: '+91 98400 77777', email: 'ravi@example.com', business: 'Ravi Veg Shop', source: 'landing' });
    expect(a.status).toBe(201);
    const mails = out.slice(from);
    expect(mails.find((m) => m.to === 'sales@corpus360lite.com')?.subject).toMatch(/Ravi Veg Shop/);
    expect(mails.find((m) => m.to === 'ravi@example.com')?.text).toMatch(/call you within one working day/);
    // Pressing the button again the same day adds the message to the same lead.
    await pub().send({ name: 'Ravi', phone: '9840077777', message: 'Also need Tamil invoices', source: 'landing' });
    const rows = await query("SELECT message, notified_to FROM sales_leads WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%9840077777'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ notified_to: 'sales@corpus360lite.com' });
    expect(rows[0].message).toMatch(/Tamil/);
    const admin = await login('admin@ledgerly.in', 'admin123');
    const sum = (await admin.get('/api/platform/support/leads/summary')).body;
    expect(sum.latest[0].name).toBe('Ravi');
    expect(sum.recipients).toEqual(['sales@corpus360lite.com']);
  });

  it('a lead nobody called within 2 hours gets one reminder', async () => {
    await query("UPDATE sales_leads SET created_at = now() - interval '3 hours' WHERE name = 'Ravi'");
    const from = devOutbox().length;
    expect(await runLeadReminders()).toBeGreaterThan(0);
    expect(devOutbox().slice(from).some((m) => /still waiting for a call/.test(m.subject) && /Ravi/.test(m.text ?? ''))).toBe(true);
    expect(await runLeadReminders()).toBe(0); // only once
  });

  it('with no sales or support email, every super admin hears about it', async () => {
    await query("UPDATE platform_config SET sales_email = '', support_email = '' WHERE id = 1");
    expect(await leadRecipients()).toContain('admin@ledgerly.in');
    await query("UPDATE platform_config SET sales_email = 'sales@corpus360lite.com', support_email = 'help@corpus360lite.com' WHERE id = 1");
  });

  it('shops can’t read the leads', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.get('/api/platform/support/leads')).status).toBeGreaterThanOrEqual(401);
  });
});

describe('inside the app', () => {
  it('a paid shop gets customer care', async () => {
    await setPlan('premium');
    const owner = await login('owner@shop.com', 'owner123');
    const c = (await owner.get('/api/shop/support/contact')).body;
    expect(c).toMatchObject({ paid: true, canBook: true });
    expect((await owner.post('/api/shop/support/whatsapp').send({ question: 'Help' })).status).toBe(200);
  });

  it('a trial shop is sent to sales: no call-backs, live chat or WhatsApp support, but it can ask sales to call', async () => {
    await setPlan('trial');
    const owner = await login('owner@shop.com', 'owner123');
    const c = (await owner.get('/api/shop/support/contact')).body;
    expect(c).toMatchObject({ paid: false, canBook: false, liveChat: false });
    expect(c.sales.email).toBe('sales@corpus360lite.com');
    for (const [path, body] of [['/api/shop/support/whatsapp', { question: 'x' }], ['/api/shop/support/live', {}], ['/api/shop/support/callbacks', {}]] as const) {
      const r = await owner.post(path).send(body);
      expect(r.status, path).toBe(402);
      expect(r.body.code).toBe('paid_only');
    }
    // The help bot still answers how-to questions.
    expect((await owner.post('/api/shop/support/chat').send({ messages: [{ role: 'user', content: 'how do I add an item' }] })).status).toBe(200);
    const lead = await owner.post('/api/billing/sales-lead').send({ phone: '9840011223', message: 'Which plan for 2 shops?', page: '/app/support' });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    const [row] = await query("SELECT * FROM sales_leads WHERE message = 'Which plan for 2 shops?'");
    expect(row).toMatchObject({ source: 'app', shop_id: shopId, business: 'Aravind Computer Store', phone: '9840011223' });
  });

  it('a paid shop whose license ran out is sent to sales too', async () => {
    await setPlan('premium', '2020-01-01');
    const owner = await login('owner@shop.com', 'owner123');
    // An expired shop can only reach billing, so "call me back" lives there.
    expect((await owner.get('/api/shop/support/contact')).body.code).toBe('license_expired');
    expect((await owner.post('/api/billing/sales-lead').send({ message: 'Renewal please' })).status).toBe(201);
    const [row] = await query("SELECT * FROM sales_leads WHERE message LIKE '%Renewal please%'"); // joins the shop's earlier lead today
    expect(row.phone).not.toBe(''); // the shop's phone, when none was typed
    await setPlan('premium');
  });
});
