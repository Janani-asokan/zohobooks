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
}
export interface ItemFacets { categories: Array<{ name: string; count: number }>; brands: Array<{ name: string; count: number }>; units: string[] }

export interface Customer {
  id: string; customId: string; type: 'Individual' | 'Business'; name: string; companyName: string; gstin: string; email: string; phone: string;
  state: string; address: string; tier: PriceTier; createdAt: string; billed: number; due: number; invoiceCount: number;
}

export interface Line {
  id: string; itemId: string; name: string; type: 'Goods' | 'Services'; hsn: string; unit: string; qty: number; rate: number; tier: PriceTier;
  taxRate: number; discount: number; amount: number; batchNo?: string; batches?: Array<{ batchNo: string; qty: number; expiryDate: string | null }>;
}
export interface LineInput { itemId: string; qty: number; tier: PriceTier; rate?: number; discount: number }

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
}
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

export interface SalesOrder { id: string; number: string; customerId: string; date: string; expiryDate: string; lines: Line[]; withGst: boolean; status: 'Draft' | 'Sent' | 'Accepted'; notes: string; total: number; invoiceId: string | null; createdAt: string }
export interface Recurring {
  id: string; name: string; customerId: string; frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; startDate: string; endDate: string | null; nextDate: string;
  lines: LineInput[]; withGst: boolean; termsDays: number; branchId: string | null; notes: string; autoIssue: boolean; active: boolean; lastRunAt: string | null; generated: number;
}

export interface Vendor { id: string; name: string; gstin: string; phone: string; email: string; state: string; payable: number }
export interface PurchaseLine { id: string; itemId: string; name: string; type: 'Goods' | 'Services'; unit: string; qty: number; rate: number; taxRate: number; amount: number; received: number }
export interface Bill { id: string; number: string; vendorId: string; vendorName: string; vendorBillNo: string; date: string; dueDate: string; taxableAmount: number; taxAmount: number; amount: number; status: 'Open' | 'Paid'; description: string; lines: PurchaseLine[]; purchaseOrderId: string | null; stockAdded: boolean }
export interface PurchaseOrder {
  id: string; number: string; vendorId: string; vendorName: string; branchId: string | null; date: string; expectedDate: string | null; lines: PurchaseLine[];
  status: 'Draft' | 'Issued' | 'Partially Received' | 'Received' | 'Cancelled'; subTotal: number; taxTotal: number; total: number; notes: string; billId: string | null; createdAt: string;
}
export interface Expense { id: string; date: string; category: string; description: string; vendorId: string | null; vendorName: string | null; amount: number; taxAmount: number; total: number; accountId: string | null; accountName: string | null; reference: string }
export interface BankAccount { id: string; name: string; bank: string; accountNo: string; type: 'Bank' | 'Cash' | 'Card'; openingBalance: number; balance: number }
export interface BankTxn { id: string; accountId: string; date: string; description: string; amount: number; category: string; refType: string; refId: string | null }

export interface StaffUser { id: string; name: string; email: string; role: UserRole; branchId: string | null; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null }
export interface AuditEntry { id: number; actor: string; actorType?: string; action: string; entity: string; entityId: string; details: Record<string, unknown>; ip: string; at: string }
export interface Notification { kind: string; tone: 'red' | 'amber' | 'blue'; text: string; link: string }

export interface Dashboard {
  fy: string; receivable: number; overdue: number; overdueCount: number; openCount: number; fySales: number; todaySales: number; lowStock: number;
  monthly: Array<{ month: string; invoiced: number; collected: number }>; topItems: Array<{ name: string; amount: number }>;
}

/* ---- platform ---- */
export interface Shop {
  id: string; shopName: string; ownerName: string; email: string; phone: string; city: string; planId: string; planName: string;
  licenseStart: string; licenseEnd: string; active: boolean; revenue: number; users: number; createdAt: string;
}
export interface Plan { id: string; name: string; pricePerYear: number; trialDays: number | null; maxUsers: number; maxBranches: number; maxInvoicesPerMonth: number | null }
export interface PlatformConfig { customerIdPrefix: string; fyStartMonth: number; autoResetInvoiceNumbering: boolean; taxSlabs: TaxSlab[] }

export type { InvoiceStatus };
