import type { Permission, UserRole } from '../../shared/permissions';
import type { InvoiceStatus } from '../../shared/status';

export type PriceTier = 'SP1' | 'SP2' | 'SP3';
export const TIER_LABEL: Record<PriceTier, string> = { SP1: 'Standard', SP2: 'Loyal', SP3: 'New' };

export type Me =
  | { kind: 'super'; user: { id: string; name: string; email: string } }
  | {
      kind: 'user';
      user: { id: string; name: string; email: string; role: UserRole; branchId: string | null; mustChangePassword: boolean };
      permissions: Permission[];
      orgCount: number;
      shop: { id: string; name: string; planId: string; planName: string; licenseStart: string; licenseEnd: string; licenseExpired: boolean; active: boolean; limits: { users: number; branches: number; invoicesPerMonth: number | null } };
      platform: { customerIdPrefix: string; fyStartMonth: number; autoResetInvoiceNumbering: boolean };
    };

export interface Organization {
  companyName: string; legalName: string; gstin: string; email: string; phone: string; address: string; state: string; logo: string;
  invoiceFooter: string; upiId: string; bankDetails: string; invoiceTemplate: 'classic' | 'modern' | 'compact'; compositionScheme: boolean;
  autoReminders: boolean; reminderDays: number;
}
export interface TaxSlab { id: string; name: string; rate: number; active: boolean }
export interface Branch { id: string; name: string; address: string; phone: string; isPrimary: boolean }

export interface Item {
  id: string; type: 'Goods' | 'Services'; name: string; sku: string; barcode: string; unit: string; hsn: string; cost: number | null;
  sp1: number; sp2: number; sp3: number; taxSlabId: string; taxRate: number; reorderLevel: number; trackBatches: boolean; description: string;
  stock: number; stockByBranch: Record<string, number>; createdAt: string;
  category: string; brand: string; image: string; mrp: number | null;
  trackSerials: boolean; parentId: string | null; isGroup: boolean; variantAttrs: Record<string, string>; attributes: Array<{ name: string; values: string[] }>;
}
export interface StockAdjustment {
  id: string; number: string; branchId: string; branchName: string; date: string; reason: string; mode: 'change' | 'count'; value: number; notes: string; createdBy: string; createdAt: string;
  lines: Array<{ itemId: string; name: string; unit: string; before: number; change: number; after: number; cost: number; value: number }>;
}
export interface StockTransfer {
  id: string; number: string; fromBranchId: string; fromName: string; toBranchId: string; toName: string; date: string; status: 'In transit' | 'Received' | 'Cancelled';
  notes: string; receivedAt: string | null; createdBy: string; createdAt: string;
  lines: Array<{ itemId: string; name: string; unit: string; qty: number; serials: string[] }>;
}
export interface ItemSerial { id: string; itemId: string; itemName: string; serial: string; status: 'In stock' | 'Sold' | 'In transit' | 'Written off'; branchId: string | null; branchName: string | null; invoiceId: string | null; invoiceNumber: string | null; note: string; updatedAt: string }
export interface StockSummary {
  from: string; to: string; branchId: string | null; inTransit: number;
  items: Array<{ itemId: string; name: string; sku: string; unit: string; category: string; opening: number; in: number; out: number; closing: number; sold: number; reorderLevel: number; cost: number | null; value: number | null }>;
  byCategory: Array<{ category: string; items: number; qty: number; value: number }>;
  byBranch: Array<{ branchId: string; name: string; value: number; qty: number; items: number }>;
  totals: { qty: number; value: number | null; items: number; lowStock: number };
}
export interface ItemFacets { categories: Array<{ name: string; count: number }>; brands: Array<{ name: string; count: number }>; units: string[] }

export interface Customer {
  id: string; customId: string; type: 'Individual' | 'Business'; name: string; companyName: string; gstin: string; email: string; phone: string;
  state: string; address: string; tier: PriceTier; createdAt: string; billed: number; due: number; invoiceCount: number; creditLimit: number;
}

export interface Line {
  id: string; itemId: string; name: string; type: 'Goods' | 'Services'; hsn: string; unit: string; qty: number; rate: number; tier: PriceTier;
  taxRate: number; discount: number; amount: number; batchNo?: string; serials?: string[]; batches?: Array<{ batchNo: string; qty: number; expiryDate: string | null }>;
  /** What was typed, when MRP billing or a bill discount changed the effective rate/discount. */
  enteredRate?: number; enteredDiscount?: number;
}
export interface LineInput { itemId: string; qty: number; tier: PriceTier; rate?: number; discount: number; serials?: string[] }

export interface CustomerSnapshot { customId: string; type: string; name: string; companyName: string; gstin: string; email: string; phone: string; state: string; address: string }

export interface Invoice {
  id: string; number: string | null; fy: string; customerId: string | null; customer: CustomerSnapshot; date: string; dueDate: string; branchId: string | null;
  lines: Line[]; withGst: boolean; docType: 'TAX INVOICE' | 'INVOICE' | 'BILL OF SUPPLY'; placeOfSupply: string; interState: boolean; reverseCharge: boolean;
  tcsRate: number; status: 'Draft' | 'Issued' | 'Cancelled'; paymentStatus: InvoiceStatus; subTotal: number; discount: number; taxTotal: number;
  cgst: number; sgst: number; igst: number; tcs: number; roundOff: number; total: number; amountPaid: number; amountCredited: number; balance: number;
  notes: string; source: 'app' | 'pos' | 'recurring'; salesOrderId: string | null; recurringId: string | null; publicToken: string | null;
  lastReminderAt: string | null; cancelReason: string; cancelledAt: string | null; issuedAt: string | null; createdAt: string;
  shipTo?: ShipTo | null; terms?: string;
  einvoice?: { irn: string; ackNo: string; ackDate: string; signedQr: string } | null;
  eway?: { number: string; date: string; vehicleNo: string } | null;
  billDiscount?: BillDiscount | null; pricesIncludeTax?: boolean;
}
export interface BillDiscount { kind: 'percent' | 'amount'; value: number }
export interface ShipTo { name: string; address: string; state: string; gstin: string }
export interface Payment { id: string; date: string; amount: number; tdsAmount: number; mode: string; reference: string; account: string | null; notes: string }
export interface CreditNote {
  id: string; number: string; fy: string; invoiceId: string; invoiceNumber: string; invoiceDate: string; customer: CustomerSnapshot; date: string; reason: string;
  lines: Array<Line & { lineId: string }>; withGst: boolean; interState: boolean; subTotal: number; taxTotal: number; cgst: number; sgst: number; igst: number; total: number; restock: boolean; createdAt: string;
}
export interface InvoiceDetail extends Invoice {
  payments: Payment[];
  creditNotes: CreditNote[];
  reminders: Array<{ channel: string; status: string; detail: string; at: string }>;
}
export interface PaymentRow { id: string; invoiceId: string; invoiceNumber: string; customer: string; date: string; amount: number; tdsAmount: number; mode: string; reference: string; account: string | null }

export interface SalesOrder {
  id: string; kind: 'quote' | 'order'; number: string; customerId: string; date: string; expiryDate: string; lines: Line[]; withGst: boolean;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Declined'; notes: string; total: number; invoiceId: string | null; orderId: string | null; sourceId: string | null; sourceNumber: string | null; createdAt: string;
}
export interface Recurring {
  id: string; name: string; customerId: string; frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; startDate: string; endDate: string | null; nextDate: string;
  lines: LineInput[]; withGst: boolean; termsDays: number; branchId: string | null; notes: string; autoIssue: boolean; active: boolean; lastRunAt: string | null; generated: number;
}

export interface Vendor { id: string; name: string; gstin: string; phone: string; email: string; state: string; payable: number }
export interface PurchaseLine { id: string; itemId: string; name: string; type: 'Goods' | 'Services'; unit: string; qty: number; rate: number; taxRate: number; amount: number; received: number }
export interface Bill { id: string; number: string; vendorId: string; vendorName: string; vendorBillNo: string; date: string; dueDate: string; taxableAmount: number; taxAmount: number; amount: number; amountPaid: number; balance: number; status: 'Open' | 'Overdue' | 'Partially Paid' | 'Paid'; description: string; lines: PurchaseLine[]; purchaseOrderId: string | null; stockAdded: boolean }
export interface BillPayment {
  id: string; number: string; billId: string; billNumber: string; vendorBillNo: string; vendorId: string; vendorName: string; date: string;
  amount: number; tdsAmount: number; mode: string; reference: string; accountId: string | null; accountName: string | null; notes: string;
}
export interface PurchaseOrder {
  id: string; number: string; vendorId: string; vendorName: string; branchId: string | null; date: string; expectedDate: string | null; lines: PurchaseLine[];
  status: 'Draft' | 'Issued' | 'Partially Received' | 'Received' | 'Cancelled'; subTotal: number; taxTotal: number; total: number; notes: string; billId: string | null; createdAt: string;
}
export interface Expense { id: string; date: string; category: string; description: string; vendorId: string | null; vendorName: string | null; amount: number; taxAmount: number; total: number; accountId: string | null; accountName: string | null; reference: string }
export interface BankAccount { id: string; name: string; bank: string; accountNo: string; type: 'Bank' | 'Cash' | 'Card'; openingBalance: number; balance: number }
export interface BankTxn { id: string; accountId: string; date: string; description: string; amount: number; category: string; refType: string; refId: string | null }

export interface StaffUser { id: string; name: string; email: string; role: UserRole; branchId: string | null; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null; linked?: boolean }
export interface AuditEntry { id: number; actor: string; actorType?: string; action: string; entity: string; entityId: string; details: Record<string, unknown>; ip: string; at: string }
export interface Notification { kind: string; tone: 'red' | 'amber' | 'blue'; text: string; link: string }

export interface Dashboard {
  fy: string; receivable: number; overdue: number; overdueCount: number; openCount: number; fySales: number; todaySales: number; lowStock: number;
  monthly: Array<{ month: string; invoiced: number; collected: number }>; topItems: Array<{ name: string; amount: number }>;
  thisMonthSales: number; lastMonthSales: number; lastMonthToDate: number;
  payable: number | null; payableOverdue: number | null; payableOverdueCount: number | null;
  cash: Array<{ id: string; name: string; type: string; balance: number }> | null;
  overdueList: Array<{ id: string; number: string; customer: string; dueDate: string; balance: number; days: number }>;
  lowStockList: Array<{ id: string; name: string; unit: string; stock: number; reorderLevel: number }>;
}

/* ---- platform ---- */
export interface Shop {
  id: string; shopName: string; ownerName: string; email: string; phone: string; city: string; planId: string; planName: string;
  licenseStart: string; licenseEnd: string; active: boolean; revenue: number; users: number; createdAt: string;
}
export interface Plan { id: string; name: string; pricePerYear: number; trialDays: number | null; maxUsers: number; maxBranches: number; maxInvoicesPerMonth: number | null }
export interface PlatformConfig { customerIdPrefix: string; fyStartMonth: number; autoResetInvoiceNumbering: boolean; taxSlabs: TaxSlab[] }

export type { InvoiceStatus };

export type { BalanceSheet, CashFlow, GeneralLedger, Journal, LedgerAccount, ProfitAndLoss, TrialBalance } from '../../shared/accounting';
export interface OrgSummary { id: string; name: string; role: UserRole; gstin: string; state: string; active: boolean; licenseExpired: boolean; current: boolean; home: boolean }
export interface RoleSetting { role: UserRole; permissions: Permission[]; defaults: Permission[]; customized: boolean; updatedAt: string | null; members: number }
export interface AuditPage { rows: AuditEntry[]; nextCursor: string | null; facets: { entities: Array<{ value: string; count: number }>; actors: Array<{ value: string; count: number }> } | null }
export interface SalesBy {
  from: string; to: string;
  byCustomer: Array<{ id: string; name: string; gstin: string; count: number; net: number; tax: number; total: number; due: number }>;
  byItem: Array<{ itemId: string; name: string; hsn: string; unit: string; qty: number; amount: number; invoices: number; cost: number | null; profit: number | null }>;
}
export interface Ageing {
  kind: 'receivable' | 'payable'; asOf: string; buckets: string[]; total: number; totals: number[];
  parties: Array<{ id: string; name: string; buckets: number[]; total: number; documents: number }>;
  documents: Array<{ id: string; number: string; party: string; date: string; dueDate: string | null; balance: number; bucket: string; daysOverdue: number }>;
}

export type ChallanStatus = 'Packed' | 'Dispatched' | 'Delivered' | 'Invoiced' | 'Cancelled';
export interface DeliveryChallan {
  id: string; number: string; customerId: string; customer: CustomerSnapshot; date: string; purpose: 'Supply' | 'Job work' | 'On approval' | 'Sales return' | 'Other';
  salesOrderId: string | null; salesOrderNumber: string | null; invoiceId: string | null; invoiceNumber: string | null;
  lines: Array<{ itemId: string; name: string; hsn: string; unit: string; qty: number; rate: number }>; value: number; status: ChallanStatus;
  transporter: string; vehicleNo: string; lrNo: string; receivedBy: string; notes: string; dispatchedAt: string | null; deliveredAt: string | null; createdAt: string;
}
