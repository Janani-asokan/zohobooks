import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';

let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let other: ReturnType<typeof request.agent>;
const csrf = { 'X-Requested-With': 'ledgerly' };

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  admin = await login('admin@ledgerly.in', 'admin123');
  sales = await login('sales@shop.com', 'sales123');
  // A second shop, made through the public sign-up.
  other = request.agent(app);
  const r = await other.post('/api/auth/signup').set(csrf).send({ shopName: 'Second Shop', ownerName: 'Lakshmi R', email: 'second@example.com', phone: '9000012345', password: 'Second#2026' });
  expect(r.status).toBe(201);
  // Call-backs are customer care, for paying shops: this one has bought a plan.
  await query("UPDATE shops SET plan_id = 'standard' WHERE name = 'Second Shop'");
});

describe('customer support call-backs', () => {
  let slots: Array<{ start: string; left: number }>;
  let id: string;

  it('offers slots in support hours and lets the owner book one', async () => {
    const r = await owner.get('/api/shop/support/slots');
    expect(r.status).toBe(200);
    slots = r.body.days.flatMap((d: any) => d.slots);
    expect(slots.length).toBeGreaterThan(10);
    expect(slots[0]!.left).toBe(2);
    const b = await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[0]!.start, topic: 'printing', contactName: 'Aravind', phone: '98400 12345', message: 'Labels print sideways' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.status).toBe('scheduled');
    id = b.body.id;
    // The slot now has one place left, for every shop.
    const again = await other.get('/api/shop/support/slots').set(csrf);
    expect(again.body.days.flatMap((d: any) => d.slots).find((s: any) => s.start === slots[0]!.start)?.left).toBe(1);
  });

  it('allows one upcoming call-back per shop, refuses times that are not slots, and keeps staff out', async () => {
    expect((await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[1]!.start, topic: 'gst', contactName: 'Aravind', phone: '9840012345' })).status).toBe(409);
    expect((await other.post('/api/shop/support/callbacks').set(csrf).send({ slotStart: '2026-01-04T03:47:00Z', topic: 'gst', contactName: 'Lakshmi', phone: '9000012345' })).status).toBe(400);
    expect((await sales.get('/api/shop/support/slots')).status).toBe(403);
  });

  it('never overbooks a slot', async () => {
    const s = (await admin.get('/api/platform/support/settings')).body;
    expect((await admin.put('/api/platform/support/settings').send({ ...s, capacity: 1 })).status).toBe(200);
    const r = await other.post('/api/shop/support/callbacks').set(csrf).send({ slotStart: slots[0]!.start, topic: 'gst', contactName: 'Lakshmi', phone: '9000012345' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('slot_full');
    expect((await admin.put('/api/platform/support/settings').send({ ...s, capacity: 2 })).status).toBe(200);
  });

  it('keeps each shop to its own requests', async () => {
    expect((await other.get('/api/shop/support/callbacks').set(csrf)).body).toEqual([]);
    expect((await owner.get('/api/shop/support/callbacks')).body.map((c: any) => c.id)).toEqual([id]);
    expect((await other.post(`/api/shop/support/callbacks/${id}/cancel`).set(csrf)).status).toBe(404);
  });

  it('shows staff every request with the shop, its account summary, and records the outcome', async () => {
    const list = await admin.get('/api/platform/support/callbacks?view=upcoming');
    expect(list.status).toBe(200);
    const cb = list.body.callbacks.find((c: any) => c.id === id);
    expect(cb.shop.name).toBeTruthy();
    expect(list.body.counts.upcoming).toBeGreaterThanOrEqual(1);
    const sum = await admin.get(`/api/platform/support/shops/${cb.shopId}`);
    expect(sum.status).toBe(200);
    expect(sum.body.usage.items).toBeGreaterThan(0);
    expect(sum.body.users.some((u: any) => u.role === 'Owner')).toBe(true);
    const done = await admin.patch(`/api/platform/support/callbacks/${id}`).send({ status: 'completed', staffNotes: 'Set paper to 80 x 25 in the driver' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.assignedTo).toBe('Platform Admin');
    const mine = (await owner.get('/api/shop/support/callbacks')).body[0];
    expect(mine.status).toBe('completed');
    expect(mine.staffNotes).toBe('Set paper to 80 x 25 in the driver');
    // Shops can't reach the console.
    expect([401, 403]).toContain((await owner.get('/api/platform/support/callbacks')).status);
  });

  it('lets the owner book again after the call, and cancel', async () => {
    const b = await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[2]!.start, topic: 'billing', contactName: 'Aravind', phone: '9840012345' });
    expect(b.status).toBe(201);
    const c = await owner.post(`/api/shop/support/callbacks/${b.body.id}/cancel`);
    expect(c.body.status).toBe('cancelled');
  });
});

describe('help chat', () => {
  const ask = (who: typeof owner, q: string) => who.post('/api/shop/support/chat').send({ messages: [{ role: 'user', content: q }] });

  it('answers stock per branch, invoice status, dues, overdue and how-to from the shop’s data', async () => {
    const stock = (await ask(owner, 'What is the stock of HP 680 ink?')).body;
    expect(stock.text).toMatch(/HP 680/);
    expect(stock.table.columns).toEqual(expect.arrayContaining(['Item', 'Head Office', 'Total']));
    const inv = (await owner.get('/api/shop/invoices')).body.find((i: any) => i.status === 'Issued');
    const status = (await ask(owner, `status of invoice ${inv.number}`)).body;
    expect(status.text).toContain(inv.number);
    expect(status.links[0].to).toBe(`/app/sales/invoices/${inv.id}`);
    expect((await ask(owner, 'How much does Nila Textiles owe?')).body.text).toMatch(/Nila Textiles (owes|owes nothing)/);
    expect((await ask(owner, 'which bills are overdue')).body.text).toMatch(/overdue/);
    const how = (await ask(owner, 'How do I record a payment?')).body;
    expect(how.links[0].to).toBe('/app/sales/payments');
    expect((await ask(owner, 'what is low on stock')).body.by).toBe('bot');
  });

  it('keeps to the user’s role, and offers a person when it can’t help', async () => {
    expect((await ask(sales, 'Stock of pen drive')).body.table).toBeTruthy();       // every role can see stock
    const wh = await login('warehouse@shop.com', 'warehouse123');
    expect((await ask(wh, 'which bills are overdue')).body).toMatchObject({ escalate: true });  // no access to money
    expect((await ask(owner, 'I want to talk to a person')).body.escalate).toBe(true);
    expect((await ask(owner, 'blorp zzz')).body).toMatchObject({ escalate: true, by: 'bot' });
    const contact = (await sales.get('/api/shop/support/contact')).body;
    expect(contact).toMatchObject({ canBook: false });
    expect(typeof contact.openNow).toBe('boolean');
  });

  it('a call-back booked from the chat carries the conversation to the support agent', async () => {
    const s = (await admin.get('/api/platform/support/settings')).body;
    expect((await admin.put('/api/platform/support/settings').send({ ...s, phone: '+91 44 4000 1234', email: 'help@corpus360lite.com' })).status).toBe(200);
    expect((await owner.get('/api/shop/support/contact')).body).toMatchObject({ phone: '+91 44 4000 1234', email: 'help@corpus360lite.com', canBook: true });
    const slot = (await owner.get('/api/shop/support/slots')).body.days.flatMap((d: any) => d.slots).at(-1).start;
    const chat = [{ role: 'user', text: 'Labels print sideways' }, { role: 'bot', text: 'Settings → Print settings…' }, { role: 'user', text: 'Talk to a person' }];
    const b = await owner.post('/api/shop/support/callbacks').send({ slotStart: slot, topic: 'printing', contactName: 'Aravind', phone: '9840012345', message: 'From the help chat', chat });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body).toMatchObject({ source: 'chat', chat });
    const staffView = (await admin.get('/api/platform/support/callbacks?view=upcoming')).body.callbacks.find((x: any) => x.id === b.body.id);
    expect(staffView.chat).toEqual(chat);
  });
});

describe('live chat with an agent', () => {
  let id: string;
  let allHours: any;
  beforeAll(async () => {
    // Open every day, all day, so the test doesn't depend on the clock.
    const s = (await admin.get('/api/platform/support/settings')).body;
    allHours = { ...s, days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' };
    expect((await admin.put('/api/platform/support/settings').send(allHours)).status).toBe(200);
    await query('UPDATE super_admins SET support_seen_at = NULL');
  });

  it('is offered only while an agent is online', async () => {
    expect((await owner.get('/api/shop/support/live/current')).body).toEqual({ chat: null, messages: [] });
    expect((await owner.get('/api/shop/support/contact')).body).toMatchObject({ agentsOnline: 0, liveChat: false });
    expect((await owner.post('/api/shop/support/live').send({})).body.code).toBe('live_no_agent');
    expect((await admin.get('/api/platform/support/live')).status).toBe(200);    // console open → online
    expect((await owner.get('/api/shop/support/contact')).body).toMatchObject({ agentsOnline: 1, liveChat: true });
  });

  it('queues the chat with the bot conversation, and only a picked-up chat gets agent replies', async () => {
    const bot = [{ role: 'user', text: 'Labels print sideways' }, { role: 'bot', text: 'Printer and paper size: …' }];
    const r = await owner.post('/api/shop/support/live').send({ botChat: bot, first: 'Still printing sideways on the TSC printer' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id = r.body.chat.id;
    expect(r.body.chat).toMatchObject({ status: 'waiting', queuePosition: 1, botTranscript: bot });
    expect(r.body.messages.map((m: any) => m.sender)).toEqual(['system', 'shop']);
    // Starting again returns the same open chat.
    expect((await owner.post('/api/shop/support/live').send({})).body.chat.id).toBe(id);
    const list = (await admin.get('/api/platform/support/live')).body;
    expect(list.waiting).toBe(1);
    expect(list.chats[0]).toMatchObject({ id, status: 'waiting', unread: 1, shopName: expect.any(String) });
    expect((await admin.post(`/api/platform/support/live/${id}/messages`).send({ body: 'Hi' })).body.code).toBe('chat_not_mine');
    expect((await admin.post(`/api/platform/support/live/${id}/pick`).send({})).body).toMatchObject({ status: 'active', agentName: 'Platform Admin' });
    expect((await admin.post(`/api/platform/support/live/${id}/messages`).send({ body: 'Set the label size to 50 x 25 in Print settings' })).status).toBe(201);
    const last = r.body.messages.at(-1).id;
    const poll = (await owner.get(`/api/shop/support/live/${id}?after=${last}`)).body;
    expect(poll.chat).toMatchObject({ status: 'active', agentName: 'Platform Admin' });
    expect(poll.messages.map((m: any) => [m.sender, m.body])).toEqual([['system', 'Platform Admin from Corpus360 support joined the chat.'], ['agent', 'Set the label size to 50 x 25 in Print settings']]);
    expect((await owner.post(`/api/shop/support/live/${id}/messages`).send({ body: 'That fixed it, thanks!' })).status).toBe(201);
  });

  it('keeps chats private to the person who started them (and the owner), and to the shop', async () => {
    expect((await sales.get(`/api/shop/support/live/${id}`)).status).toBe(404);
    expect((await other.get(`/api/shop/support/live/${id}`).set(csrf)).status).toBe(404);
    expect((await other.post(`/api/shop/support/live/${id}/messages`).set(csrf).send({ body: 'hi' })).status).toBe(404);
  });

  it('either side can end it; the shop can rate it once, and nothing more can be sent', async () => {
    expect((await admin.post(`/api/platform/support/live/${id}/close`).send({})).body.status).toBe('closed');
    const rated = (await owner.post(`/api/shop/support/live/${id}/close`).send({ rating: 5 })).body;
    expect(rated.chat).toMatchObject({ status: 'closed', closedBy: 'agent', rating: 5 });
    expect((await owner.post(`/api/shop/support/live/${id}/messages`).send({ body: 'one more' })).body.code).toBe('chat_closed');
  });

  it('a chat nobody picks up in 5 minutes ends with an offer of a call-back', async () => {
    const r = (await owner.post('/api/shop/support/live').send({})).body;
    await query("UPDATE support_chats SET created_at = now() - interval '6 minutes' WHERE id = $1", [r.chat.id]);
    const poll = (await owner.get(`/api/shop/support/live/${r.chat.id}`)).body;
    expect(poll.chat.status).toBe('missed');
    expect(poll.messages.at(-1).body).toMatch(/book a call-back/);
  });
});
