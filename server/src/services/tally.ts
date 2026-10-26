/* Tally (TallyPrime / Tally.ERP 9) data transfer.
   Export: an XML envelope Tally imports with Gateway of Tally → Import → Masters / Transactions.
   Import: ledgers (customers under Sundry Debtors, vendors under Sundry Creditors) and stock items from Tally's master XML. */
import { XMLParser } from 'fast-xml-parser';
import type { Db } from '../db';
import { many } from '../db';
import { getOrg } from './common';
import { isInterState } from '../../../shared/gst';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const tdate = (d: string) => d.replaceAll('-', '');
const tag = (name: string, v: unknown) => (v === undefined || v === null || v === '' ? '' : `<${name}>${esc(v)}</${name}>`);
const unitOf = (u: string) => (u || 'pcs').trim() || 'pcs';

/** Ledger names used in the export. Tally matches on name, so keep them stable. */
export const TALLY_LEDGERS = {
  sales: 'Sales', purchase: 'Purchase', roundOff: 'Round Off', tcs: 'TCS Payable', tdsReceivable: 'TDS Receivable', tdsPayable: 'TDS Payable', cash: 'Cash',
  out: { cgst: 'Output CGST', sgst: 'Output SGST', igst: 'Output IGST' }, in: { cgst: 'Input CGST', sgst: 'Input SGST', igst: 'Input IGST' },
};

const envelope = (company: string, report: 'All Masters' | 'Vouchers', body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>
   <REQUESTDATA>
${body}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
const msg = (inner: string) => `    <TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE>`;

const partyName = (snap: { companyName?: string; name?: string }) => (snap.companyName || snap.name || 'Cash').trim();

function ledgerXml(name: string, parent: string, extra = '') {
  return msg(`<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT>${extra}</LEDGER>`);
}
function partyXml(p: { name: string; gstin: string; state: string; address: string; phone: string; email: string }, parent: 'Sundry Debtors' | 'Sundry Creditors') {
  return ledgerXml(p.name, parent, [
    '<ISBILLWISEON>Yes</ISBILLWISEON><COUNTRYNAME>India</COUNTRYNAME>',
    `<GSTREGISTRATIONTYPE>${p.gstin ? 'Regular' : 'Unregistered/Consumer'}</GSTREGISTRATIONTYPE>`,
    tag('PARTYGSTIN', p.gstin), tag('LEDSTATENAME', p.state), tag('LEDGERPHONE', p.phone), tag('EMAIL', p.email),
    p.address ? `<ADDRESS.LIST TYPE="String">${p.address.split(/\n|,\s*/).filter(Boolean).slice(0, 5).map((a) => `<ADDRESS>${esc(a.trim())}</ADDRESS>`).join('')}</ADDRESS.LIST>` : '',
  ].join(''));
}
const taxLedgerXml = (name: string, head: 'Central Tax' | 'State Tax' | 'Integrated Tax') =>
  ledgerXml(name, 'Duties & Taxes', `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${head}</GSTDUTYHEAD>`);

/** Customers, vendors, units, stock items with HSN and GST rate, and the ledgers the vouchers use. */
export async function tallyMasters(db: Db, shopId: string): Promise<string> {
  const org = await getOrg(db, shopId);
  const customers = await many(db, 'SELECT name, company_name, gstin, state, address, phone, email FROM customers WHERE shop_id = $1 ORDER BY company_name, name', [shopId]);
  const vendors = await many(db, 'SELECT name, gstin, state, phone, email FROM vendors WHERE shop_id = $1 ORDER BY name', [shopId]);
  const items = await many(db, `SELECT i.name, i.unit, i.hsn, i.cost, i.sp1, t.rate FROM items i JOIN tax_slabs t ON t.id = i.tax_slab_id
    WHERE i.shop_id = $1 AND NOT i.archived AND NOT i.is_group AND i.type = 'Goods' ORDER BY i.name`, [shopId]);
  const banks = await many(db, 'SELECT name FROM bank_accounts WHERE shop_id = $1', [shopId]);
  const L = TALLY_LEDGERS;
  const out: string[] = [
    ledgerXml(L.sales, 'Sales Accounts'), ledgerXml(L.purchase, 'Purchase Accounts'), ledgerXml(L.roundOff, 'Indirect Expenses'),
    ledgerXml(L.tcs, 'Duties & Taxes'), ledgerXml(L.tdsReceivable, 'Loans & Advances (Asset)'), ledgerXml(L.tdsPayable, 'Duties & Taxes'),
    taxLedgerXml(L.out.cgst, 'Central Tax'), taxLedgerXml(L.out.sgst, 'State Tax'), taxLedgerXml(L.out.igst, 'Integrated Tax'),
    taxLedgerXml(L.in.cgst, 'Central Tax'), taxLedgerXml(L.in.sgst, 'State Tax'), taxLedgerXml(L.in.igst, 'Integrated Tax'),
    ...banks.filter((b) => !/^cash/i.test(b.name)).map((b) => ledgerXml(b.name, 'Bank Accounts')),
  ];
  const seen = new Set<string>();
  for (const c of customers) {
    const name = partyName({ companyName: c.company_name, name: c.name });
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(partyXml({ name, gstin: c.gstin, state: c.state || org.state, address: c.address, phone: c.phone, email: c.email }, 'Sundry Debtors'));
  }
  for (const v of vendors) {
    if (seen.has(v.name.toLowerCase())) continue;
    seen.add(v.name.toLowerCase());
    out.push(partyXml({ name: v.name, gstin: v.gstin, state: v.state || org.state, address: '', phone: v.phone, email: v.email }, 'Sundry Creditors'));
  }
  for (const u of new Set(items.map((i) => unitOf(i.unit)))) out.push(msg(`<UNIT NAME="${esc(u)}" ACTION="Create"><NAME>${esc(u)}</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>`));
  for (const i of items) {
    const rate = Number(i.rate);
    const heads = [['Integrated Tax', rate], ['Central Tax', rate / 2], ['State Tax', rate / 2]] as const;
    out.push(msg(`<STOCKITEM NAME="${esc(i.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(i.name)}</NAME></NAME.LIST><BASEUNITS>${esc(unitOf(i.unit))}</BASEUNITS>`
      + `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>`
      + `<GSTDETAILS.LIST><APPLICABLEFROM>20170701</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE>${tag('HSNCODE', i.hsn)}<TAXABILITY>${rate > 0 ? 'Taxable' : 'Exempt'}</TAXABILITY>`
      + `<STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>${heads.map(([h, r]) => `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>${h}</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${r}</GSTRATE></RATEDETAILS.LIST>`).join('')}</STATEWISEDETAILS.LIST></GSTDETAILS.LIST>`
      + (Number(i.cost) > 0 ? `<STANDARDCOSTLIST.LIST><DATE>20170701</DATE><RATE>${amt(Number(i.cost))}/${esc(unitOf(i.unit))}</RATE></STANDARDCOSTLIST.LIST>` : '')
      + `<STANDARDPRICELIST.LIST><DATE>20170701</DATE><RATE>${amt(Number(i.sp1))}/${esc(unitOf(i.unit))}</RATE></STANDARDPRICELIST.LIST></STOCKITEM>`));
  }
  return envelope(org.company_name, 'All Masters', out.join('\n'));
}

type Entry = { ledger: string; amount: number; party?: boolean; bill?: { name: string; type: 'New Ref' | 'Agst Ref' } };
/** Tally signs: debit is negative and ISDEEMEDPOSITIVE=Yes; credit is positive. */
const ledgerEntry = (e: Entry) => {
  const debit = e.amount < 0;
  return `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>${e.party ? '<ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : ''}<AMOUNT>${amt(e.amount)}</AMOUNT>`
    + (e.bill ? `<BILLALLOCATIONS.LIST><NAME>${esc(e.bill.name)}</NAME><BILLTYPE>${e.bill.type}</BILLTYPE><AMOUNT>${amt(e.amount)}</AMOUNT></BILLALLOCATIONS.LIST>` : '') + '</LEDGERENTRIES.LIST>';
};
const voucher = (type: string, date: string, number: string, party: string, body: string, extra = '', invoice = false) =>
  msg(`<VOUCHER VCHTYPE="${type}" ACTION="Create"${invoice ? ' OBJVIEW="Invoice Voucher View"' : ''}><DATE>${tdate(date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>`
    + `<VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>${invoice ? '<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE>' : '<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>'}${extra}${body}</VOUCHER>`);

/** Sales invoices, customer receipts, purchase bills and vendor payments in a date range. */
export async function tallyVouchers(db: Db, shopId: string, from: string, to: string): Promise<{ xml: string; counts: Record<string, number> }> {
  const org = await getOrg(db, shopId);
  const L = TALLY_LEDGERS;
  const banks = new Map((await many(db, 'SELECT id, name FROM bank_accounts WHERE shop_id = $1', [shopId])).map((b) => [b.id, /^cash/i.test(b.name) ? L.cash : b.name]));
  const out: string[] = [];
  const counts = { sales: 0, receipts: 0, purchases: 0, payments: 0 };

  const invoices = await many(db, `SELECT * FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND date BETWEEN $2 AND $3 ORDER BY date, number`, [shopId, from, to]);
  for (const inv of invoices) {
    const party = inv.customer_id ? partyName(inv.customer) : L.cash;
    const total = Number(inv.total);
    let inventory = ''; let services = 0;
    for (const l of inv.lines as Array<{ name: string; type: string; unit: string; qty: number; amount: number }>) {
      if (l.type !== 'Goods') { services += Number(l.amount); continue; }
      const u = unitOf(l.unit); const a = Number(l.amount);
      inventory += `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>${amt(a / Number(l.qty))}/${esc(u)}</RATE>`
        + `<AMOUNT>${amt(a)}</AMOUNT><ACTUALQTY> ${l.qty} ${esc(u)}</ACTUALQTY><BILLEDQTY> ${l.qty} ${esc(u)}</BILLEDQTY>`
        + `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${L.sales}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(a)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
    }
    const entries: Entry[] = [{ ledger: party, amount: -total, party: true, bill: { name: inv.number, type: 'New Ref' } }];
    if (services) entries.push({ ledger: L.sales, amount: services });
    if (Number(inv.cgst)) entries.push({ ledger: L.out.cgst, amount: Number(inv.cgst) });
    if (Number(inv.sgst)) entries.push({ ledger: L.out.sgst, amount: Number(inv.sgst) });
    if (Number(inv.igst)) entries.push({ ledger: L.out.igst, amount: Number(inv.igst) });
    if (Number(inv.tcs)) entries.push({ ledger: L.tcs, amount: Number(inv.tcs) });
    if (Number(inv.round_off)) entries.push({ ledger: L.roundOff, amount: Number(inv.round_off) });
    out.push(voucher('Sales', inv.date, inv.number, party, inventory + entries.map(ledgerEntry).join(''),
      tag('PLACEOFSUPPLY', inv.place_of_supply) + tag('PARTYGSTIN', inv.customer.gstin) + tag('STATENAME', inv.customer.state) + tag('NARRATION', inv.notes), true));
    counts.sales++;
  }

  const receipts = await many(db, `SELECT p.*, i.number AS inv_number, i.customer, i.customer_id FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.shop_id = $1 AND p.date BETWEEN $2 AND $3 ORDER BY p.date, p.created_at`, [shopId, from, to]);
  for (const [n, p] of receipts.entries()) {
    const party = p.customer_id ? partyName(p.customer) : L.cash;
    const cash = (p.account_id && banks.get(p.account_id)) || (p.mode === 'Cash' ? L.cash : [...banks.values()].find((b) => b !== L.cash) ?? L.cash);
    const a = Number(p.amount); const tds = Number(p.tds_amount ?? 0);
    const entries: Entry[] = [{ ledger: party, amount: a + tds, party: true, bill: { name: p.inv_number, type: 'Agst Ref' } }, { ledger: cash, amount: -a }];
    if (tds) entries.push({ ledger: L.tdsReceivable, amount: -tds });
    if (party === L.cash && cash === L.cash) continue; // a cash sale paid in cash needs no receipt in Tally
    out.push(voucher('Receipt', p.date, `RCPT-${String(n + 1).padStart(4, '0')}`, party, entries.map(ledgerEntry).join(''), tag('NARRATION', [p.mode, p.reference].filter(Boolean).join(' · '))));
    counts.receipts++;
  }

  const bills = await many(db, `SELECT b.*, v.name AS vendor, v.state AS vstate, v.gstin AS vgstin FROM bills b JOIN vendors v ON v.id = b.vendor_id
    WHERE b.shop_id = $1 AND b.date BETWEEN $2 AND $3 ORDER BY b.date, b.number`, [shopId, from, to]);
  for (const b of bills) {
    const inter = isInterState(org.state, b.vstate || org.state);
    const tax = Number(b.tax_amount); const total = Number(b.amount);
    let inventory = ''; let ledgerOnly = Number(b.taxable_amount);
    for (const l of (b.lines ?? []) as Array<{ name: string; type: string; unit: string; qty: number; amount: number }>) {
      if (l.type !== 'Goods') continue;
      const u = unitOf(l.unit); const a = Number(l.amount);
      ledgerOnly -= a;
      inventory += `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><RATE>${amt(a / Number(l.qty))}/${esc(u)}</RATE>`
        + `<AMOUNT>${amt(-a)}</AMOUNT><ACTUALQTY> ${l.qty} ${esc(u)}</ACTUALQTY><BILLEDQTY> ${l.qty} ${esc(u)}</BILLEDQTY>`
        + `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${L.purchase}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${amt(-a)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
    }
    const entries: Entry[] = [{ ledger: b.vendor, amount: total, party: true, bill: { name: b.vendor_bill_no || b.number, type: 'New Ref' } }];
    if (Math.abs(ledgerOnly) > 0.004) entries.push({ ledger: L.purchase, amount: -ledgerOnly });
    if (tax) {
      if (inter) entries.push({ ledger: L.in.igst, amount: -tax });
      else { const half = Math.round((tax / 2) * 100) / 100; entries.push({ ledger: L.in.cgst, amount: -half }, { ledger: L.in.sgst, amount: -(tax - half) }); }
    }
    const diff = Math.round((total - Number(b.taxable_amount) - tax) * 100) / 100;
    if (diff) entries.push({ ledger: L.roundOff, amount: -diff });
    out.push(voucher('Purchase', b.date, b.number, b.vendor, inventory + entries.map(ledgerEntry).join(''), tag('REFERENCE', b.vendor_bill_no) + tag('PARTYGSTIN', b.vgstin) + tag('NARRATION', b.description), !!inventory));
    counts.purchases++;
  }

  const payments = await many(db, `SELECT p.*, b.number AS bill_number, b.vendor_bill_no, v.name AS vendor FROM bill_payments p JOIN bills b ON b.id = p.bill_id JOIN vendors v ON v.id = p.vendor_id
    WHERE p.shop_id = $1 AND p.date BETWEEN $2 AND $3 ORDER BY p.date, p.number`, [shopId, from, to]);
  for (const p of payments) {
    const bank = (p.account_id && banks.get(p.account_id)) || (p.mode === 'Cash' ? L.cash : [...banks.values()].find((b) => b !== L.cash) ?? L.cash);
    const a = Number(p.amount); const tds = Number(p.tds_amount ?? 0);
    const entries: Entry[] = [{ ledger: p.vendor, amount: -(a + tds), party: true, bill: { name: p.vendor_bill_no || p.bill_number, type: 'Agst Ref' } }, { ledger: bank, amount: a }];
    if (tds) entries.push({ ledger: L.tdsPayable, amount: tds });
    out.push(voucher('Payment', p.date, p.number, p.vendor, entries.map(ledgerEntry).join(''), tag('NARRATION', [p.mode, p.reference].filter(Boolean).join(' · '))));
    counts.payments++;
  }
  return { xml: envelope(org.company_name, 'Vouchers', out.join('\n')), counts };
}

/* ---------------- Import from Tally ---------------- */

export interface TallyParty { name: string; gstin: string; state: string; address: string; phone: string; email: string }
export interface TallyItem { name: string; unit: string; hsn: string; taxRate: number | null; cost: number | null; price: number | null; openingQty: number }
export interface TallyParsed { customers: TallyParty[]; vendors: TallyParty[]; items: TallyItem[]; other: number; company: string | null }

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? text((v as Record<string, unknown>)['#text']) : String(v)).replace(/^\u0004\s*/, '').trim();
const firstNum = (v: unknown) => { const m = text(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
/** Depth-first search for every node with this tag, wherever Tally nested it. */
function collect(node: unknown, key: string, out: Array<Record<string, any>> = []): Array<Record<string, any>> {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) out.push(...(arr(v) as Array<Record<string, any>>));
    else for (const child of arr(v)) collect(child, key, out);
  }
  return out;
}
const nameOf = (n: Record<string, any>) => text(n['@_NAME']) || text(arr(n['NAME.LIST'])[0]?.NAME && arr(arr(n['NAME.LIST'])[0].NAME)[0]) || text(n.NAME);

/** Reads Tally's "All Masters" XML (Tally.ERP 9 and TallyPrime layouts). */
export function parseTallyXml(xml: string): TallyParsed {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true, processEntities: true, htmlEntities: true }).parse(xml.replace(/&#4;/g, ''));
  const customers: TallyParty[] = []; const vendors: TallyParty[] = []; let other = 0;
  for (const l of collect(doc, 'LEDGER')) {
    const parent = text(l.PARENT).toLowerCase();
    const reg = arr(l['LEDGSTREGDETAILS.LIST']).at(-1) as Record<string, any> | undefined; // TallyPrime 3+
    const mail = arr(l['LEDMAILINGDETAILS.LIST']).at(-1) as Record<string, any> | undefined;
    const address = arr((mail ?? l)['ADDRESS.LIST']).flatMap((a: any) => arr(a?.ADDRESS)).map(text).filter(Boolean).join(', ');
    const p: TallyParty = {
      name: nameOf(l), gstin: (text(reg?.GSTIN) || text(l.PARTYGSTIN)).toUpperCase(), state: text(mail?.STATE) || text(l.LEDSTATENAME) || text(l.STATENAME),
      address, phone: text(l.LEDGERMOBILE) || text(l.LEDGERPHONE), email: text(l.EMAIL),
    };
    if (!p.name) continue;
    if (parent.includes('sundry debtor')) customers.push(p);
    else if (parent.includes('sundry creditor')) vendors.push(p);
    else other++;
  }
  const items: TallyItem[] = [];
  for (const s of collect(doc, 'STOCKITEM')) {
    const name = nameOf(s);
    if (!name) continue;
    const gst = arr(s['GSTDETAILS.LIST']).at(-1) as Record<string, any> | undefined;
    const hsnNode = arr(s['HSNDETAILS.LIST']).at(-1) as Record<string, any> | undefined;
    const rates = collect(gst ?? {}, 'RATEDETAILS.LIST');
    const igst = rates.find((r) => /integrated/i.test(text(r.GSTRATEDUTYHEAD)));
    const cgst = rates.find((r) => /central/i.test(text(r.GSTRATEDUTYHEAD)));
    const rate = igst ? firstNum(igst.GSTRATE) : cgst ? (firstNum(cgst.GSTRATE) ?? 0) * 2 : null;
    items.push({
      name, unit: text(s.BASEUNITS) || 'pcs', hsn: (text(hsnNode?.HSNCODE) || text(gst?.HSNCODE)).replace(/\D/g, '').slice(0, 8), taxRate: rate,
      cost: firstNum(arr(s['STANDARDCOSTLIST.LIST']).at(-1)?.RATE), price: firstNum(arr(s['STANDARDPRICELIST.LIST']).at(-1)?.RATE), openingQty: firstNum(s.OPENINGBALANCE) ?? 0,
    });
  }
  const company = text(collect(doc, 'STATICVARIABLES')[0]?.SVCURRENTCOMPANY) || null;
  return { customers, vendors, items, other, company };
}
