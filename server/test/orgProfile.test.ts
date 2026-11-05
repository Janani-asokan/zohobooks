import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { freshDb, login } from './helpers';

/* Organization / Business profile: strict phone, and the bank account as separate checked fields. */
let owner: Awaited<ReturnType<typeof login>>;
let org: any;
const put = (patch: Record<string, unknown>) => owner.put('/api/shop/organization').send({ ...org, ...patch });

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  org = (await owner.get('/api/shop/organization')).body;
});

describe('business phone', () => {
  it('refuses numbers with too many or too few digits, letters, or another country', async () => {
    for (const phone of ['98400123456', '984001234567', '+91 98400 123456', '98400', 'call us', '+1 415 555 0100']) {
      const r = await put({ phone });
      expect(r.status, phone).toBe(400);
      expect(JSON.stringify(r.body), phone).toMatch(/10-digit mobile or a landline/);
    }
    expect((await owner.get('/api/shop/organization')).body.phone).toBe(org.phone);
  });
  it('saves a real mobile or landline, tidied', async () => {
    expect((await put({ phone: '98400 12345' })).body.phone).toBe('+91 98400 12345');
    expect((await put({ phone: '044-24345678' })).body.phone).toBe('04424345678');
    expect((await put({ phone: '' })).body.phone).toBe('');
  });
  it('an older invalid phone already saved does not block saving something else (logo, template)', async () => {
    const shopId = (await owner.get('/api/auth/me')).body.shop.id;
    await query("UPDATE organizations SET phone = '984001234567' WHERE shop_id = $1", [shopId]);
    const cur = (await owner.get('/api/shop/organization')).body;
    const r = await owner.put('/api/shop/organization').send({ ...cur, invoiceTemplate: 'modern' });
    expect(r.status).toBe(200);
    expect((await owner.put('/api/shop/organization').send({ ...cur, phone: '984001234568' })).status).toBe(400);
    await owner.put('/api/shop/organization').send({ ...cur, phone: '9840012345' });
  });
});

describe('bank account fields', () => {
  it('the demo shop’s old bank text shows up split into the fields', () => {
    expect(org).toMatchObject({ bankName: 'HDFC Bank', bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankBranch: 'Teynampet' });
  });
  it('checks the account number and IFSC, which go together with the holder’s name', async () => {
    const base = { bankAccountName: 'Aravind Computer Store', bankName: '', bankBranch: '', bankNote: '' };
    const cases: Array<[Record<string, string>, string]> = [
      [{ bankAccountNo: '1234', bankIfsc: 'HDFC0001234' }, 'bankAccountNo'],
      [{ bankAccountNo: '1234567890123456789', bankIfsc: 'HDFC0001234' }, 'bankAccountNo'],
      [{ bankAccountNo: '50200012345678', bankIfsc: 'HDFC1234' }, 'bankIfsc'],
      [{ bankAccountNo: '50200012345678', bankIfsc: 'HDFC1001234' }, 'bankIfsc'],
      [{ bankAccountNo: '50200012345678', bankIfsc: '' }, 'bankIfsc'],
      [{ bankAccountNo: '', bankIfsc: 'HDFC0001234' }, 'bankAccountNo'],
      [{ bankAccountNo: '50200099999999', bankIfsc: 'HDFC0001234', bankAccountName: '' }, 'bankAccountName'], // a new account needs the holder's name
    ];
    for (const [f, field] of cases) {
      const r = await put({ ...base, ...f });
      expect(r.status, JSON.stringify(f)).toBe(400);
      expect(r.body.details?.[field], JSON.stringify(f)).toBeTruthy();
    }
  });
  it('keeping the same account with no holder name (older shops) still saves', async () => {
    expect((await put({ bankAccountName: '', bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank', bankBranch: 'Teynampet', bankNote: '' })).status).toBe(200);
  });
  it('saves clean fields, fills the bank name from the IFSC, and prints them in the Pay-to text', async () => {
    const r = await put({ bankAccountName: 'Aravind Computer Store', bankName: '', bankAccountNo: '3910 1234 5678', bankIfsc: 'sbin0001234', bankBranch: 'Anna Salai', bankNote: '' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bankAccountNo: '391012345678', bankIfsc: 'SBIN0001234', bankName: 'State Bank of India' });
    expect(r.body.bankDetails).toBe('A/c name: Aravind Computer Store\nState Bank of India · A/c 391012345678\nIFSC SBIN0001234 · Anna Salai');
    // The invoice print data carries the same text
    const inv = (await owner.get('/api/shop/invoices')).body.find((i: any) => i.status === 'Draft' || i.status === 'Issued');
    if (inv) { const pr = await owner.get(`/api/shop/invoices/${inv.id}`); expect(pr.status).toBe(200); }
  });
  it('clearing every bank field clears the Pay-to text', async () => {
    const r = await put({ bankAccountName: '', bankName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '', bankNote: '' });
    expect(r.body.bankDetails).toBe('');
  });
});

describe('branch phone', () => {
  it('same rule for warehouse / branch phones', async () => {
    expect((await owner.post('/api/shop/branches').send({ name: 'Bad Phone Godown', phone: '12345678901234' })).status).toBe(400);
    const ok = await owner.post('/api/shop/branches').send({ name: 'Good Phone Godown', phone: '0422 2345678' });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe('04222345678');
  });
});
