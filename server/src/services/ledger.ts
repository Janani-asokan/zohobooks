import type { Db } from '../db';
import { many } from '../db';
import { r2 } from '../../../shared/calc';
import {
  BANK_CATEGORIES, LENDING_ACCOUNTS, SYSTEM_ACCOUNTS, debitNormal, type AccountDef, type AccountType, type BalanceSheet, type CashFlow, type GeneralLedger,
  type LedgerAccount, type PnlSection, type ProfitAndLoss, type TrialBalance,
} from '../../../shared/accounting';

/**
 * The general ledger is derived from the source documents every time it is read, so it can never drift
 * from invoices, bills, payments, expenses, banking and stock. Manual journals add whatever else is needed.
 *
 * Inventory is perpetual and valued at each item's cost: every stock movement posts to Inventory against
 * Cost of goods sold (sales, returns), Stock adjustments, Purchases (goods received) or Opening balance equity.
 * Vendor bills post to Purchases, so a bill for goods already received at cost nets Purchases to zero, and a bill
 * for something that never went into stock stays in Purchases as a cost.
 */

export interface Posting { account: string; debit: number; credit: number }
export interface Entry { date: string; source: string; sourceId: string | null; number: string; description: string; lines: Posting[] }

const OPENING_DATE = '2000-01-01';
const DR = (account: string, v: number): Posting => (v >= 0 ? { account, debit: r2(v), credit: 0 } : { account, debit: 0, credit: r2(-v) });
const CR = (account: string, v: number): Posting => DR(account, -v);
const party = (c: any) => c?.companyName || c?.name || 'Walk-in customer';

/** Every account the shop can post to: system accounts, banks, expense categories in use and its own accounts. */
export async function chartOfAccounts(db: Db, shopId: string): Promise<Map<string, AccountDef & { id?: string; archived?: boolean }>> {
  const map = new Map<string, AccountDef & { id?: string; archived?: boolean }>(SYSTEM_ACCOUNTS.map((a) => [a.key, a]));
  const lending = await many(db, `SELECT 1 FROM organizations WHERE shop_id = $1 AND lending_enabled UNION ALL SELECT 1 FROM lending_loans WHERE shop_id = $1 LIMIT 1`, [shopId]);
  if (lending.length) for (const a of LENDING_ACCOUNTS) map.set(a.key, a);
  const banks = await many(db, 'SELECT id, name, type FROM bank_accounts WHERE shop_id = $1 ORDER BY created_at', [shopId]);
  banks.forEach((b, i) => map.set(`bank:${b.id}`, { key: `bank:${b.id}`, code: String(1010 + i), name: b.name, type: 'asset', subtype: 'cash', description: b.type === 'Cash' ? 'Cash account' : 'Bank account', system: true, id: b.id }));
  const cats = await many(db, `SELECT DISTINCT category AS c FROM expenses WHERE shop_id = $1
    UNION SELECT DISTINCT category FROM bank_transactions WHERE shop_id = $1 AND coalesce(ref_type, '') = '' AND amount < 0`, [shopId]);
  const known = new Set(BANK_CATEGORIES.map((c) => c.name));
  const expNames = new Set<string>(BANK_CATEGORIES.filter((c) => c.account.startsWith('exp:')).map((c) => c.account.slice(4)));
  for (const r of cats) if (r.c && !known.has(r.c)) expNames.add(r.c);
  [...expNames].sort().forEach((n, i) => map.set(`exp:${n}`, { key: `exp:${n}`, code: String(6000 + i * 10), name: n, type: 'expense', subtype: 'operating', description: 'Expense category', system: true }));
  for (const a of await many(db, 'SELECT * FROM accounts WHERE shop_id = $1 ORDER BY code, name', [shopId]))
    map.set(`acc:${a.id}`, { key: `acc:${a.id}`, code: a.code, name: a.name, type: a.type, subtype: a.subtype, description: a.description, system: false, id: a.id, archived: a.archived });
  return map;
}

/** Which account a manual bank transaction posts against. */
function bankCounter(category: string, amount: number, custom: Map<string, string>) {
  const own = custom.get(category.toLowerCase());
  if (own) return own;
  const c = BANK_CATEGORIES.find((x) => x.name === category);
  if (c && !(c.account.startsWith('exp:') && amount > 0)) return c.account;
  return amount > 0 ? 'other_income' : `exp:${category || 'Other'}`;
}

/** All ledger entries dated on or before `to` (and on or after `from` when given). */
export async function ledgerEntries(db: Db, shopId: string, to: string, from?: string): Promise<Entry[]> {
  const lo = from ?? '1900-01-01';
  const args = [shopId, lo, to];
  const between = (col: string) => `${col} BETWEEN $2::date AND $3::date`;
  const out: Entry[] = [];

  for (const i of await many(db, `SELECT id, number, date, customer, sub_total, tax_total, cgst, sgst, igst, tcs, round_off, total FROM invoices
      WHERE shop_id = $1 AND status = 'Issued' AND ${between('date')}`, args)) {
    const total = Number(i.total), ro = Number(i.round_off), tcs = Number(i.tcs);
    out.push({ date: i.date, source: 'invoice', sourceId: i.id, number: i.number, description: `Invoice to ${party(i.customer)}`, lines: [
      DR('ar', total), CR('sales', total - Number(i.tax_total) - tcs - ro), CR('gst_cgst', Number(i.cgst)), CR('gst_sgst', Number(i.sgst)), CR('gst_igst', Number(i.igst)), CR('tcs_pay', tcs), CR('round_off', ro),
    ] });
  }
  for (const p of await many(db, `SELECT p.id, p.date, p.amount, p.tds_amount, p.mode, p.account_id, i.number, i.customer FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.shop_id = $1 AND ${between('p.date')}`, args)) {
    const amt = Number(p.amount), tds = Number(p.tds_amount);
    out.push({ date: p.date, source: 'payment', sourceId: p.id, number: p.number, description: `Payment from ${party(p.customer)} (${p.mode})`, lines: [
      DR(p.account_id ? `bank:${p.account_id}` : 'cash', amt), DR('tds_recv', tds), CR('ar', amt + tds),
    ] });
  }
  for (const n of await many(db, `SELECT cn.id, cn.number, cn.date, cn.tax_total, cn.cgst, cn.sgst, cn.igst, cn.total, i.customer FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
      WHERE cn.shop_id = $1 AND ${between('cn.date')}`, args)) {
    const total = Number(n.total);
    out.push({ date: n.date, source: 'credit_note', sourceId: n.id, number: n.number, description: `Credit note to ${party(n.customer)}`, lines: [
      DR('returns', total - Number(n.tax_total)), DR('gst_cgst', Number(n.cgst)), DR('gst_sgst', Number(n.sgst)), DR('gst_igst', Number(n.igst)), CR('ar', total),
    ] });
  }
  for (const b of await many(db, `SELECT b.id, b.number, b.date, b.taxable_amount, b.tax_amount, b.amount, v.name FROM bills b JOIN vendors v ON v.id = b.vendor_id
      WHERE b.shop_id = $1 AND ${between('b.date')}`, args)) {
    const amt = Number(b.amount), tax = Number(b.tax_amount);
    out.push({ date: b.date, source: 'bill', sourceId: b.id, number: b.number, description: `Bill from ${b.name}`, lines: [DR('purchases', amt - tax), DR('itc', tax), CR('ap', amt)] });
  }
  for (const p of await many(db, `SELECT p.id, p.number, p.date, p.amount, p.tds_amount, p.mode, p.account_id, v.name FROM bill_payments p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.shop_id = $1 AND ${between('p.date')}`, args)) {
    const amt = Number(p.amount), tds = Number(p.tds_amount);
    out.push({ date: p.date, source: 'bill_payment', sourceId: p.id, number: p.number, description: `Payment to ${p.name} (${p.mode})`, lines: [
      DR('ap', amt + tds), CR(p.account_id ? `bank:${p.account_id}` : 'cash', amt), CR('tds_pay', tds),
    ] });
  }
  for (const e of await many(db, `SELECT id, date, category, description, amount, tax_amount, account_id, reference FROM expenses WHERE shop_id = $1 AND ${between('date')}`, args)) {
    const amt = Number(e.amount), tax = Number(e.tax_amount);
    out.push({ date: e.date, source: 'expense', sourceId: e.id, number: e.reference, description: e.description || e.category, lines: [
      DR(`exp:${e.category}`, amt), DR('itc', tax), CR(e.account_id ? `bank:${e.account_id}` : 'cash', amt + tax),
    ] });
  }
  const custom = new Map((await many(db, 'SELECT id, name FROM accounts WHERE shop_id = $1 AND NOT archived', [shopId])).map((a) => [String(a.name).toLowerCase(), `acc:${a.id}`]));
  for (const t of await many(db, `SELECT id, account_id, date, description, amount, category FROM bank_transactions WHERE shop_id = $1 AND coalesce(ref_type, '') = '' AND ${between('date')}`, args)) {
    const amt = Number(t.amount);
    out.push({ date: t.date, source: 'bank', sourceId: t.id, number: '', description: t.description, lines: [DR(`bank:${t.account_id}`, amt), CR(bankCounter(t.category, amt, custom), amt)] });
  }
  if (lo <= OPENING_DATE && OPENING_DATE <= to)
    for (const a of await many(db, 'SELECT id, name, opening_balance FROM bank_accounts WHERE shop_id = $1 AND opening_balance <> 0', [shopId]))
      out.push({ date: OPENING_DATE, source: 'opening', sourceId: a.id, number: '', description: `Opening balance · ${a.name}`, lines: [DR(`bank:${a.id}`, Number(a.opening_balance)), CR('opening_equity', Number(a.opening_balance))] });

  // Stock movements, valued at item cost, dated by the document that caused them.
  const moves = await many(db, `
    SELECT m.reason, m.ref_type, m.ref_id, d.date, sum(m.qty_change * coalesce(it.cost, 0)) AS value, max(d.number) AS number
      FROM stock_movements m JOIN items it ON it.id = m.item_id
      CROSS JOIN LATERAL (SELECT coalesce(
        CASE m.ref_type WHEN 'invoice' THEN (SELECT date FROM invoices WHERE id = m.ref_id)
                        WHEN 'bill' THEN (SELECT date FROM bills WHERE id = m.ref_id)
                        WHEN 'stock_adjustment' THEN (SELECT date FROM stock_adjustments WHERE id = m.ref_id)
                        WHEN 'credit_note' THEN (SELECT date FROM credit_notes WHERE id = m.ref_id) END,
        CASE WHEN m.reason = 'opening' THEN $2::date END,
        (m.at AT TIME ZONE 'Asia/Kolkata')::date) AS date,
        coalesce(CASE m.ref_type WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id = m.ref_id)
                                 WHEN 'bill' THEN (SELECT number FROM bills WHERE id = m.ref_id)
                                 WHEN 'stock_adjustment' THEN (SELECT number FROM stock_adjustments WHERE id = m.ref_id)
                                 WHEN 'purchase_order' THEN (SELECT number FROM purchase_orders WHERE id = m.ref_id)
                                 WHEN 'credit_note' THEN (SELECT number FROM credit_notes WHERE id = m.ref_id) END, m.note) AS number) d
     WHERE m.shop_id = $1 AND m.reason NOT IN ('transfer_in', 'transfer_out', 'transfer_cancel') AND it.type = 'Goods'
     GROUP BY 1, 2, 3, 4`, [shopId, OPENING_DATE]);
  for (const m of moves) {
    if (m.date < lo || m.date > to) continue;
    const v = Number(m.value);
    if (Math.abs(v) < 0.005) continue;
    const counter = m.reason === 'opening' ? 'opening_equity' : m.reason === 'purchase' ? 'purchases'
      : m.reason === 'adjustment' && m.ref_type !== 'invoice' ? 'stock_adj' : 'cogs';
    const what = { opening: 'Opening stock', purchase: 'Goods received', sale: 'Cost of goods sold', sale_cancel: 'Stock returned on cancel', credit_note: 'Stock returned', adjustment: counter === 'cogs' ? 'Stock re-issued on edit' : 'Stock adjustment' }[m.reason as string] ?? 'Stock movement';
    out.push({ date: m.date, source: m.reason === 'opening' ? 'opening' : 'stock', sourceId: m.ref_id, number: m.number ?? '', description: what, lines: [DR('inventory', v), CR(counter, v)] });
  }

  // Money lending: interest is taken upfront, so a loan books the full principal as receivable, the cash handed over,
  // and the interest and fee as income. Receipts reduce principal (and late charges, which are booked when applied).
  for (const l of await many(db, `SELECT l.id, l.number, l.borrow_date, l.entered_on, l.principal, l.upfront_interest, l.processing_fee, l.net_disbursed,
      l.account_id, l.existing_loan, l.already_repaid, b.name FROM lending_loans l JOIN borrowers b ON b.id = l.borrower_id
      WHERE l.shop_id = $1 AND (CASE WHEN l.existing_loan THEN l.entered_on ELSE l.borrow_date END) BETWEEN $2::date AND $3::date`, args)) {
    if (l.existing_loan) {
      const owed = Number(l.principal) - Number(l.already_repaid);
      out.push({ date: l.entered_on, source: 'loan', sourceId: l.id, number: l.number, description: `Existing loan brought in · ${l.name}`, lines: [DR('loan_recv', owed), CR('opening_equity', owed)] });
    } else {
      out.push({ date: l.borrow_date, source: 'loan', sourceId: l.id, number: l.number, description: `Loan given to ${l.name}`, lines: [
        DR('loan_recv', Number(l.principal)), CR(l.account_id ? `bank:${l.account_id}` : 'cash', Number(l.net_disbursed)), CR('lending_interest', Number(l.upfront_interest)), CR('lending_fees', Number(l.processing_fee)),
      ] });
    }
  }
  for (const p of await many(db, `SELECT p.id, p.receipt_no, p.date, p.amount, p.principal_part, p.penalty_part, p.mode, p.account_id, l.number, b.name
      FROM lending_payments p JOIN lending_loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id
      WHERE p.shop_id = $1 AND p.status = 'Posted' AND p.kind <> 'Opening balance' AND ${between('p.date')}`, args))
    out.push({ date: p.date, source: 'loan_receipt', sourceId: p.id, number: p.receipt_no, description: `Loan receipt from ${p.name} (${p.number}, ${p.mode})`, lines: [
      DR(p.account_id ? `bank:${p.account_id}` : 'cash', Number(p.amount)), CR('loan_recv', Number(p.principal_part)), CR('penalty_recv', Number(p.penalty_part)),
    ] });
  for (const c of await many(db, `SELECT c.id, c.kind, c.amount, c.date, l.number FROM lending_charges c JOIN lending_loans l ON l.id = c.loan_id
      WHERE c.shop_id = $1 AND ${between('c.date')}`, args)) {
    const v = Number(c.amount) * (c.kind === 'Penalty waiver' ? -1 : 1);
    out.push({ date: c.date, source: 'loan_charge', sourceId: c.id, number: c.number, description: `${c.kind} · ${c.number}`, lines: [DR('penalty_recv', v), CR('lending_penalty', v)] });
  }

  for (const j of await many(db, `SELECT id, number, date, reference, notes, lines FROM journals WHERE shop_id = $1 AND ${between('date')}`, args))
    out.push({ date: j.date, source: 'journal', sourceId: j.id, number: j.number, description: j.notes || j.reference || 'Manual journal', lines: (j.lines as any[]).map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit) })) });

  for (const e of out) e.lines = e.lines.filter((l) => l.debit > 0 || l.credit > 0);
  return out.filter((e) => e.lines.length).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Net debit (debit − credit) per account. */
function totals(entries: Entry[]) {
  const t = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) t.set(l.account, (t.get(l.account) ?? 0) + l.debit - l.credit);
  return t;
}

/** Balance in the account's natural direction (assets and expenses: debit − credit). */
const natural = (type: AccountType, net: number) => r2(debitNormal(type) ? net : -net);

function accountOf(coa: Map<string, AccountDef>, key: string): AccountDef {
  return coa.get(key) ?? (key.startsWith('exp:') ? { key, code: '6999', name: key.slice(4), type: 'expense', subtype: 'operating', description: '', system: true }
    : { key, code: '', name: 'Unknown account', type: 'asset', subtype: 'current', description: '', system: false });
}

export async function accountsWithBalances(db: Db, shopId: string, asOf: string): Promise<LedgerAccount[]> {
  const coa = await chartOfAccounts(db, shopId);
  const t = totals(await ledgerEntries(db, shopId, asOf));
  for (const k of t.keys()) if (!coa.has(k)) coa.set(k, accountOf(coa, k));
  return [...coa.values()].map((a) => ({ ...a, balance: natural(a.type, t.get(a.key) ?? 0) }));
}

export async function trialBalance(db: Db, shopId: string, asOf: string): Promise<TrialBalance> {
  const accts = await accountsWithBalances(db, shopId, asOf);
  const rows = accts.map((a) => {
    const net = debitNormal(a.type) ? a.balance : -a.balance;
    return { key: a.key, code: a.code, name: a.name, type: a.type, debit: net > 0 ? r2(net) : 0, credit: net < 0 ? r2(-net) : 0 };
  }).filter((r) => r.debit || r.credit).sort((a, b) => a.code.localeCompare(b.code));
  return { asOf, rows, totalDebit: r2(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: r2(rows.reduce((s, r) => s + r.credit, 0)) };
}

export async function generalLedger(db: Db, shopId: string, key: string, from: string, to: string): Promise<GeneralLedger> {
  const coa = await chartOfAccounts(db, shopId);
  const a = accountOf(coa, key);
  const sign = debitNormal(a.type) ? 1 : -1;
  const before = await ledgerEntries(db, shopId, prevDay(from));
  const opening = r2(sign * (totals(before).get(key) ?? 0));
  let bal = opening, td = 0, tc = 0;
  const rows = [];
  for (const e of await ledgerEntries(db, shopId, to, from))
    for (const l of e.lines) {
      if (l.account !== key) continue;
      bal = r2(bal + sign * (l.debit - l.credit)); td += l.debit; tc += l.credit;
      rows.push({ date: e.date, source: e.source, sourceId: e.sourceId, number: e.number, description: e.description, debit: l.debit, credit: l.credit, balance: bal });
    }
  return { account: { ...a, balance: bal }, from, to, opening, rows, closing: bal, totalDebit: r2(td), totalCredit: r2(tc) };
}

export const prevDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

const section = (label: string, rows: Array<{ key: string; name: string; amount: number }>): PnlSection => {
  const kept = rows.filter((r) => Math.abs(r.amount) >= 0.005).sort((a, b) => b.amount - a.amount);
  return { label, rows: kept, total: r2(kept.reduce((s, r) => s + r.amount, 0)) };
};

export async function profitAndLoss(db: Db, shopId: string, from: string, to: string): Promise<ProfitAndLoss> {
  const coa = await chartOfAccounts(db, shopId);
  const entries = await ledgerEntries(db, shopId, to, from);
  const t = totals(entries);
  const pick = (type: AccountType, test: (a: AccountDef) => boolean) =>
    [...t.entries()].map(([k, v]) => ({ a: accountOf(coa, k), v })).filter(({ a }) => a.type === type && test(a)).map(({ a, v }) => ({ key: a.key, name: a.name, amount: natural(a.type, v) }));
  const income = section('Operating income', pick('income', (a) => a.subtype !== 'other'));
  const otherIncome = section('Other income', pick('income', (a) => a.subtype === 'other'));
  const cogs = section('Cost of goods sold', pick('expense', (a) => a.subtype === 'cogs'));
  const expenses = section('Operating expenses', pick('expense', (a) => a.subtype === 'operating' || !a.subtype));
  const otherExpenses = section('Other expenses', pick('expense', (a) => a.subtype === 'other'));
  const grossProfit = r2(income.total - cogs.total);
  const netProfit = r2(grossProfit - expenses.total + otherIncome.total - otherExpenses.total);

  const months = new Map<string, { income: number; expenses: number }>();
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = nextMonth(d)) months.set(d, { income: 0, expenses: 0 });
  for (const e of entries) {
    const m = months.get(e.date.slice(0, 7));
    if (!m) continue;
    for (const l of e.lines) {
      const a = accountOf(coa, l.account);
      if (a.type === 'income') m.income += l.credit - l.debit;
      else if (a.type === 'expense') m.expenses += l.debit - l.credit;
    }
  }
  return {
    from, to, income, cogs, grossProfit, expenses, otherIncome, otherExpenses, netProfit,
    monthly: [...months.entries()].map(([month, v]) => ({ month, income: r2(v.income), expenses: r2(v.expenses), profit: r2(v.income - v.expenses) })),
  };
}

const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

export function fyStartFor(date: string, fyStartMonth: number) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return `${m >= fyStartMonth ? y : y - 1}-${String(fyStartMonth).padStart(2, '0')}-01`;
}

export async function balanceSheet(db: Db, shopId: string, asOf: string, fyStartMonth: number): Promise<BalanceSheet> {
  const accts = await accountsWithBalances(db, shopId, asOf);
  const fyStart = fyStartFor(asOf, fyStartMonth);
  const prior = totals(await ledgerEntries(db, shopId, prevDay(fyStart)));
  const coa = new Map(accts.map((a) => [a.key, a]));
  let priorProfit = 0;
  for (const [k, v] of prior) { const a = accountOf(coa, k); if (a.type === 'income' || a.type === 'expense') priorProfit -= v; }
  let allProfit = 0;
  for (const a of accts) if (a.type === 'income') allProfit += a.balance; else if (a.type === 'expense') allProfit -= a.balance;
  const rows = (type: AccountType, sub?: string) => accts.filter((a) => a.type === type && (!sub || a.subtype === sub)).map((a) => ({ key: a.key, name: a.name, amount: a.balance }));
  const assets = [section('Cash & bank', rows('asset', 'cash')), section('Current assets', rows('asset', 'current')), section('Fixed assets', rows('asset', 'fixed'))];
  const liabilities = [section('Current liabilities', rows('liability', 'current')), section('Long-term liabilities', rows('liability', 'long_term'))];
  const eq = rows('equity').map((r) => (r.key === 'retained' ? { ...r, amount: r2(r.amount + priorProfit) } : r));
  if (!eq.some((r) => r.key === 'retained')) eq.push({ key: 'retained', name: 'Retained earnings', amount: r2(priorProfit) });
  eq.push({ key: 'current_profit', name: 'Profit for the current year', amount: r2(allProfit - priorProfit) });
  const equity = section('Equity', eq);
  const totalAssets = r2(assets.reduce((s, x) => s + x.total, 0));
  const totalLiabilities = r2(liabilities.reduce((s, x) => s + x.total, 0));
  return { asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity: equity.total, balanced: Math.abs(totalAssets - totalLiabilities - equity.total) < 0.05 };
}

/** Direct-method cash flow: every movement in cash and bank accounts, classified by what it was for. */
export async function cashFlow(db: Db, shopId: string, from: string, to: string): Promise<CashFlow> {
  const coa = await chartOfAccounts(db, shopId);
  const isCash = (k: string) => k === 'cash' || k.startsWith('bank:');
  const cashKeys = [...coa.keys()].filter(isCash);
  const before = totals(await ledgerEntries(db, shopId, prevDay(from)));
  const entries = await ledgerEntries(db, shopId, to, from);
  const after = new Map(before);
  const buckets = new Map<string, Map<string, number>>([['Operating activities', new Map()], ['Investing activities', new Map()], ['Financing activities', new Map()]]);
  const add = (sec: string, label: string, v: number) => { const m = buckets.get(sec)!; m.set(label, (m.get(label) ?? 0) + v); };
  for (const e of entries) {
    let net = 0;
    for (const l of e.lines) if (isCash(l.account)) { net += l.debit - l.credit; after.set(l.account, (after.get(l.account) ?? 0) + l.debit - l.credit); }
    if (Math.abs(net) < 0.005) continue;
    const others = e.lines.filter((l) => !isCash(l.account)).map((l) => accountOf(coa, l.account));
    if (!others.length) continue; // transfer between own cash and bank accounts
    const main = others[0]!;
    if (e.source === 'payment') add('Operating activities', 'Receipts from customers', net);
    else if (e.source === 'bill_payment') add('Operating activities', 'Payments to vendors', net);
    else if (e.source === 'expense') add('Operating activities', 'Operating expenses', net);
    else if (e.source === 'opening') add('Financing activities', 'Opening balances', net);
    else if (main.type === 'asset' && main.subtype === 'fixed') add('Investing activities', main.name, net);
    else if (main.type === 'equity' || (main.type === 'liability' && main.subtype === 'long_term')) add('Financing activities', main.name, net);
    else if (main.key.startsWith('gst_') || main.key.endsWith('_pay')) add('Operating activities', 'Taxes paid', net);
    else if (main.type === 'income') add('Operating activities', net >= 0 ? 'Other receipts' : 'Refunds', net);
    else add('Operating activities', main.type === 'expense' ? 'Operating expenses' : main.name, net);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const opening = r2(cashKeys.reduce((s, k) => s + (before.get(k) ?? 0), 0));
  const sections = [...buckets.entries()].map(([label, m]) => ({ label, rows: [...m.entries()].map(([l, v]) => ({ label: l, amount: r2(v) })).sort((a, b) => b.amount - a.amount), total: r2(sum(m)) }));
  return {
    from, to, opening, closing: r2(cashKeys.reduce((s, k) => s + (after.get(k) ?? 0), 0)), sections,
    byAccount: cashKeys.map((k) => ({ key: k, name: coa.get(k)!.name, opening: r2(before.get(k) ?? 0), closing: r2(after.get(k) ?? 0) })).filter((a) => a.opening || a.closing),
  };
}
