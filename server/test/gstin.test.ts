import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDb, login } from './helpers';
import { query } from '../src/db';
import { config } from '../src/config';
import { parseTaxpayer } from '../src/services/gstinLookup';
import { checkGstin, gstinCheckDigit, hsnNote } from '../../shared/gst';
import { emailSuggestion } from '../../shared/contact';

const REAL = '27AAPFU0939F1ZV'; // a published, valid GSTIN (Maharashtra, firm)
// What GST lookup providers return: the GST portal's taxpayer record.
const RECORD = {
  flag: true,
  taxpayerInfo: {
    gstin: REAL, lgnm: 'UBER INDIA SYSTEMS PRIVATE LIMITED', tradeNam: 'Uber India', sts: 'Active', rgdt: '01/07/2017', ctb: 'Private Limited Company', dty: 'Regular',
    pradr: { addr: { bno: '602', flno: '6th Floor', bnm: 'Peninsula Business Park', st: 'Senapati Bapat Marg', loc: 'Lower Parel', dst: 'Mumbai', stcd: 'Maharashtra', pncd: '400013' } },
  },
};

beforeAll(async () => { await freshDb(); });
afterEach(() => { vi.unstubAllGlobals(); (config as any).gstLookup = null; });

describe('checking a GSTIN offline', () => {
  it('computes the check digit the GST network uses', () => {
    expect(gstinCheckDigit('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckDigit('29AAGCB7383J1Z')).toBe('4');
  });
  it('tells the state, the PAN holder and a likely typo', () => {
    expect(checkGstin(REAL)).toMatchObject({ status: 'ok', state: 'Maharashtra', pan: 'AAPFU0939F', holder: 'Partnership firm / LLP', partyType: 'Business' });
    expect(checkGstin('27AAPFU0939F1ZX')).toMatchObject({ status: 'typo', message: expect.stringContaining('should be V') });
    expect(checkGstin('27AAPFU0939F1Z')).toMatchObject({ status: 'bad' });
    expect(checkGstin('99AAPFU0939F1ZV')).toMatchObject({ status: 'bad', message: expect.stringContaining('not an Indian state code') });
    expect(checkGstin('33ABCPK1234F1Z' + gstinCheckDigit('33ABCPK1234F1Z'))).toMatchObject({ status: 'ok', partyType: 'Individual', state: 'Tamil Nadu' });
  });
});

describe('Validate in the app', () => {
  it('without a lookup service: offline answer, state, and a duplicate warning', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const r = (await owner.get(`/api/shop/gstin/${REAL}?for=customer`)).body;
    expect(r).toMatchObject({ lookup: 'off', taxpayer: null, check: { status: 'ok', state: 'Maharashtra' }, existing: null });
    const cust = (await query("SELECT gstin, company_name FROM customers WHERE gstin <> '' AND shop_id = (SELECT shop_id FROM users WHERE email = 'owner@shop.com') LIMIT 1"))[0];
    const dup = (await owner.get(`/api/shop/gstin/${cust.gstin}?for=customer`)).body;
    expect(dup.existing.name).toBe(cust.company_name);
    expect((await owner.get('/api/shop/gstin/33ABC?for=customer')).status).toBe(400);
  });

  it('with a lookup service: fills name and address from the register, once per 30 days', async () => {
    (config as any).gstLookup = { url: 'https://gst.example/verify?gstNo={gstin}&key_secret={key}', key: 'k', keyHeader: 'x-api-key' };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify(RECORD), { status: 200, headers: { 'content-type': 'application/json' } }); }));
    const owner = await login('owner@shop.com', 'owner123');
    const r = (await owner.get(`/api/shop/gstin/${REAL}?for=vendor`)).body;
    expect(r.lookup).toBe('found');
    expect(r.taxpayer).toMatchObject({ legalName: 'UBER INDIA SYSTEMS PRIVATE LIMITED', tradeName: 'Uber India', status: 'Active', state: 'Maharashtra', pincode: '400013' });
    expect(r.taxpayer.address).toBe('602, 6th Floor, Peninsula Business Park, Senapati Bapat Marg, Lower Parel, Mumbai, Maharashtra 400013');
    expect(calls[0]).toBe(`https://gst.example/verify?gstNo=${REAL}&key_secret=k`);
    await owner.get(`/api/shop/gstin/${REAL}?for=vendor`);
    expect(calls).toHaveLength(1); // the second time comes from the cache
    const logged = await query("SELECT service, feature, ok FROM api_calls WHERE service = 'gstin' ORDER BY created_at DESC LIMIT 1");
    expect(logged[0]).toMatchObject({ feature: 'gstin_lookup', ok: true });
  });

  it('a mistyped number is not sent to the paid lookup; a service failure still gives the offline answer', async () => {
    (config as any).gstLookup = { url: 'https://gst.example/{gstin}', key: 'k', keyHeader: 'x-api-key' };
    const f = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', f);
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.get('/api/shop/gstin/27AAPFU0939F1Z1')).body).toMatchObject({ lookup: 'skipped', check: { status: 'typo' } });
    const other = '29AAGCB7383J1Z4';
    const r = (await owner.get(`/api/shop/gstin/${other}`)).body;
    expect(r).toMatchObject({ lookup: 'failed', check: { status: 'ok', state: 'Karnataka' } });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reads cancelled registrations and records nested in other wrappers', () => {
    const t = parseTaxpayer({ data: { result: { lgnm: 'OLD TRADERS', sts: 'Cancelled', cxdt: '31/03/2024', pradr: { adr: 'Shop 4, Main Road, Salem, Tamil Nadu, 636001' } } } }, '33AABCO1234F1Z5');
    expect(t).toMatchObject({ legalName: 'OLD TRADERS', status: 'Cancelled', cancelledOn: '31/03/2024', address: 'Shop 4, Main Road, Salem, Tamil Nadu, 636001', state: 'Tamil Nadu' });
    expect(parseTaxpayer({ error: 'not found' }, REAL)).toBeNull();
  });
});

describe('other gentle checks', () => {
  it('suggests the right email domain for common typos', () => {
    expect(emailSuggestion('ravi@gmial.com')).toBe('ravi@gmail.com');
    expect(emailSuggestion('ravi@company.con')).toBe('ravi@company.com');
    expect(emailSuggestion('ravi@gmail.com')).toBeNull();
    expect(emailSuggestion('ravi@corpus360lite.com')).toBeNull();
  });
  it('flags HSN / SAC codes that look wrong', () => {
    expect(hsnNote('8471', 'Goods')).toBeNull();
    expect(hsnNote('998314', 'Services')).toBeNull();
    expect(hsnNote('847', 'Goods')).toMatch(/4, 6 or 8/);
    expect(hsnNote('8471', 'Services')).toMatch(/start with 99/);
    expect(hsnNote('9983', 'Goods')).toMatch(/for services/);
  });
});
