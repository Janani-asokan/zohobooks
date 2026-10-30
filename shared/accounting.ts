/**
 * Chart of accounts shared by the ledger (server) and the accounting screens (client).
 *
 * Account keys:
 *   <system key>   built-in accounts below, e.g. 'ar', 'sales'
 *   bank:<uuid>    one per bank / cash account in Banking
 *   exp:<name>     one per expense category (Rent, Salaries …)
 *   acc:<uuid>     accounts the business adds itself
 */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES: Record<AccountType, Array<{ id: string; label: string }>> = {
  asset: [{ id: 'cash', label: 'Cash & bank' }, { id: 'current', label: 'Current asset' }, { id: 'fixed', label: 'Fixed asset' }],
  liability: [{ id: 'current', label: 'Current liability' }, { id: 'long_term', label: 'Long-term liability' }],
  equity: [{ id: 'equity', label: 'Equity' }],
  income: [{ id: 'operating', label: 'Operating income' }, { id: 'other', label: 'Other income' }],
  expense: [{ id: 'cogs', label: 'Cost of goods sold' }, { id: 'operating', label: 'Operating expense' }, { id: 'other', label: 'Other expense' }],
};

export interface AccountDef { key: string; code: string; name: string; type: AccountType; subtype: string; description: string; system: boolean }

const sys = (key: string, code: string, name: string, type: AccountType, subtype: string, description: string): AccountDef => ({ key, code, name, type, subtype, description, system: true });

export const SYSTEM_ACCOUNTS: AccountDef[] = [
  sys('cash', '1000', 'Undeposited cash', 'asset', 'cash', 'Receipts and payments recorded without a bank or cash account'),
  sys('ar', '1100', 'Accounts receivable', 'asset', 'current', 'What customers owe you on issued invoices'),
  sys('inventory', '1200', 'Inventory', 'asset', 'current', 'Stock on hand, valued at cost'),
  sys('itc', '1300', 'Input GST (ITC)', 'asset', 'current', 'GST paid on purchases and expenses that you can claim'),
  sys('tds_recv', '1310', 'TDS receivable', 'asset', 'current', 'Tax deducted by customers from their payments'),
  sys('ap', '2000', 'Accounts payable', 'liability', 'current', 'What you owe vendors on bills'),
  sys('gst_cgst', '2100', 'Output CGST', 'liability', 'current', 'Central GST collected on sales'),
  sys('gst_sgst', '2110', 'Output SGST', 'liability', 'current', 'State GST collected on sales'),
  sys('gst_igst', '2120', 'Output IGST', 'liability', 'current', 'Integrated GST collected on inter-state sales'),
  sys('tcs_pay', '2130', 'TCS payable', 'liability', 'current', 'Tax collected at source on sales'),
  sys('tds_pay', '2140', 'TDS payable', 'liability', 'current', 'Tax you deducted from vendor payments'),
  sys('gst_paid', '2190', 'GST paid', 'liability', 'current', 'GST paid to the government against your returns'),
  sys('loans', '2500', 'Loans', 'liability', 'long_term', 'Money borrowed from banks or others'),
  sys('opening_equity', '3000', 'Opening balance equity', 'equity', 'equity', 'Opening stock and bank balances'),
  sys('capital', '3100', 'Owner’s capital', 'equity', 'equity', 'Money the owner put into the business'),
  sys('drawings', '3200', 'Owner’s drawings', 'equity', 'equity', 'Money the owner took out of the business'),
  sys('retained', '3900', 'Retained earnings', 'equity', 'equity', 'Profit kept in the business from earlier years'),
  sys('sales', '4000', 'Sales', 'income', 'operating', 'Invoiced sales, before GST'),
  sys('returns', '4010', 'Sales returns', 'income', 'operating', 'Credit notes, before GST'),
  sys('other_income', '4100', 'Other income', 'income', 'other', 'Interest and other receipts that are not sales'),
  sys('purchases', '5000', 'Purchases', 'expense', 'cogs', 'Vendor bills, before GST. Goods received into stock move to Inventory'),
  sys('cogs', '5010', 'Cost of goods sold', 'expense', 'cogs', 'Cost of the stock sold, at item cost'),
  sys('stock_adj', '5020', 'Stock adjustments', 'expense', 'cogs', 'Damaged, lost, expired and counted-off stock'),
  sys('round_off', '5900', 'Rounding', 'expense', 'other', 'Invoice round-off'),
];

/** Money-lending accounts, added to the chart only for businesses that use the lending module. */
export const LENDING_ACCOUNTS: AccountDef[] = [
  sys('loan_recv', '1400', 'Loans given', 'asset', 'current', 'Principal still owed by borrowers'),
  sys('penalty_recv', '1410', 'Late charges receivable', 'asset', 'current', 'Late charges not yet collected'),
  sys('lending_interest', '4200', 'Interest income (lending)', 'income', 'operating', 'Interest taken upfront when a loan is given'),
  sys('lending_fees', '4210', 'Loan processing fees', 'income', 'operating', 'Processing fees on loans given'),
  sys('lending_penalty', '4220', 'Late charges income', 'income', 'operating', 'Late charges applied to defaulting loans'),
];

/** Banking categories and the account each one posts against. */
export const BANK_CATEGORIES: Array<{ name: string; account: string; dir: 'in' | 'out' | 'both' }> = [
  { name: 'Sales', account: 'sales', dir: 'in' },
  { name: 'Customer Receipt', account: 'ar', dir: 'in' },
  { name: 'Other Income', account: 'other_income', dir: 'in' },
  { name: 'Owner Contribution', account: 'capital', dir: 'in' },
  { name: 'Loan Received', account: 'loans', dir: 'in' },
  { name: 'Vendor Payment', account: 'ap', dir: 'out' },
  { name: 'Rent', account: 'exp:Rent', dir: 'out' },
  { name: 'Salaries', account: 'exp:Salaries', dir: 'out' },
  { name: 'Utilities', account: 'exp:Utilities', dir: 'out' },
  { name: 'Office Expense', account: 'exp:Office Expense', dir: 'out' },
  { name: 'Bank Charges', account: 'exp:Bank Charges', dir: 'out' },
  { name: 'GST Payment', account: 'gst_paid', dir: 'out' },
  { name: 'Owner Drawings', account: 'drawings', dir: 'out' },
  { name: 'Loan Repayment', account: 'loans', dir: 'out' },
  { name: 'Other', account: 'exp:Other', dir: 'both' },
];

/** Debit-normal accounts grow with debits; the rest with credits. */
export const debitNormal = (t: AccountType) => t === 'asset' || t === 'expense';

export const TYPE_LABEL: Record<AccountType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

export interface LedgerAccount extends AccountDef { balance: number; archived?: boolean; id?: string }

export interface JournalLine { account: string; debit: number; credit: number; description?: string }
export interface Journal { id: string; number: string; date: string; reference: string; notes: string; lines: Array<JournalLine & { accountName: string }>; total: number; createdBy: string; createdAt: string }

export interface LedgerRow { date: string; source: string; sourceId: string | null; number: string; description: string; debit: number; credit: number; balance: number }
export interface GeneralLedger { account: LedgerAccount; from: string; to: string; opening: number; rows: LedgerRow[]; closing: number; totalDebit: number; totalCredit: number }

export interface TrialBalance { asOf: string; rows: Array<{ key: string; code: string; name: string; type: AccountType; debit: number; credit: number }>; totalDebit: number; totalCredit: number }

export interface PnlSection { label: string; rows: Array<{ key: string; name: string; amount: number }>; total: number }
export interface ProfitAndLoss {
  from: string; to: string;
  income: PnlSection; cogs: PnlSection; grossProfit: number; expenses: PnlSection; otherIncome: PnlSection; otherExpenses: PnlSection; netProfit: number;
  monthly: Array<{ month: string; income: number; expenses: number; profit: number }>;
}
export interface BalanceSheet {
  asOf: string;
  assets: Array<PnlSection>; liabilities: Array<PnlSection>; equity: PnlSection;
  totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean;
}
export interface CashFlow {
  from: string; to: string; opening: number; closing: number;
  sections: Array<{ label: string; rows: Array<{ label: string; amount: number }>; total: number }>;
  byAccount: Array<{ key: string; name: string; opening: number; closing: number }>;
}
