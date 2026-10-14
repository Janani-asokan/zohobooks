export type Role = 'SuperAdmin' | 'CustomerAdmin';

export interface Session {
  role: Role;
  name: string;
  email: string;
  /** Present only for CustomerAdmin sessions — the tenant they belong to. */
  shopId?: string;
}

/* ------------------------------------------------------------------ */
/* Platform (Super Admin) scope — never contains shop financial data.  */
/* ------------------------------------------------------------------ */

export interface TaxSlab {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

export interface PlatformConfig {
  customerIdPrefix: string;
  fyStartMonth: number; // 4 = April
  autoResetInvoiceNumbering: boolean;
  taxSlabs: TaxSlab[];
}

export type LicensePlan = 'Trial' | '1 Year' | '2 Years' | '3 Years';

export interface Shop {
  id: string;
  shopName: string;
  ownerName: string;
  email: string;
  password: string;
  phone: string;
  city: string;
  plan: LicensePlan;
  licenseStart: string; // ISO date
  licenseEnd: string; // ISO date
  subscriptionFee: number; // SaaS revenue, not shop revenue
  active: boolean;
  createdAt: string;
}

export interface SuperAdminUser {
  name: string;
  email: string;
  password: string;
}

/* ------------------------------------------------------------------ */
/* Tenant (Shop) scope                                                 */
/* ------------------------------------------------------------------ */

export interface Organization {
  companyName: string;
  legalName: string;
  gstin: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  logo: string; // data URL
  invoiceFooter: string;
}

export type PriceTier = 'SP1' | 'SP2' | 'SP3';
export const TIER_LABEL: Record<PriceTier, string> = { SP1: 'Standard', SP2: 'Loyal', SP3: 'New' };

export interface Item {
  id: string;
  type: 'Goods' | 'Services';
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  hsn: string;
  cost: number;
  sp1: number;
  sp2: number;
  sp3: number;
  taxSlabId: string;
  stock: number;
  description: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  customId: string; // e.g. ACS-1582
  type: 'Individual' | 'Business';
  name: string;
  companyName: string;
  gstin: string;
  email: string;
  phone: string;
  state: string;
  address: string;
  tier: PriceTier;
  createdAt: string;
}

export interface LineItem {
  id: string;
  itemId: string;
  name: string;
  qty: number;
  rate: number;
  tier: PriceTier;
  taxRate: number;
  discount: number; // percent
}

export type SalesOrderStatus = 'Draft' | 'Sent' | 'Accepted';

export interface SalesOrder {
  id: string;
  number: string;
  customerId: string;
  date: string;
  expiryDate: string;
  lines: LineItem[];
  withGst: boolean;
  status: SalesOrderStatus;
  notes: string;
}

export type InvoiceStatus = 'Draft' | 'Unpaid' | 'Paid' | 'Overdue';

export interface Invoice {
  id: string;
  number: string;
  fy: string;
  customerId: string;
  date: string;
  dueDate: string;
  lines: LineItem[];
  withGst: boolean;
  status: InvoiceStatus;
  notes: string;
  branchId: string;
  salesOrderId?: string;
}

export interface Vendor {
  id: string;
  name: string;
  gstin: string;
  phone: string;
  email: string;
}

export interface Bill {
  id: string;
  number: string;
  vendorId: string;
  date: string;
  dueDate: string;
  amount: number;
  status: 'Open' | 'Paid';
  description: string;
}

export interface BankAccount {
  id: string;
  name: string;
  bank: string;
  accountNo: string;
  type: 'Bank' | 'Cash' | 'Card';
  openingBalance: number;
}

export interface BankTxn {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number; // + deposit, - withdrawal
  category: string;
}

export type StaffRole = 'Manager' | 'Accountant' | 'Sales Staff' | 'Viewer';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  branchId: string;
  active: boolean;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  isPrimary: boolean;
}

export interface Tenant {
  org: Organization;
  items: Item[];
  customers: Customer[];
  salesOrders: SalesOrder[];
  invoices: Invoice[];
  vendors: Vendor[];
  bills: Bill[];
  bankAccounts: BankAccount[];
  transactions: BankTxn[];
  staff: StaffMember[];
  branches: Branch[];
  counters: {
    customer: number;
    salesOrder: number;
    bill: number;
    /** keyed by FY label (e.g. "2026-27") when auto-reset is on, or "all" when off */
    invoice: Record<string, number>;
  };
}

export interface Database {
  version: number;
  superAdmin: SuperAdminUser;
  platform: PlatformConfig;
  shops: Shop[];
  tenants: Record<string, Tenant>;
}
