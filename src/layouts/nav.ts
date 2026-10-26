import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Boxes, Landmark, BarChart3, Settings, FileText, UserRound, ClipboardList, Receipt, Wallet,
  Truck, Package, ScanLine, BookOpen, NotebookPen, History, Wallet as WalletIcon, Landmark as Bank, FileSignature, SlidersHorizontal, ArrowLeftRight, Warehouse, Repeat, IndianRupee, FileMinus, Building2, Printer, Users, Wrench, BrainCircuit, type LucideIcon,
} from 'lucide-react';
import type { NavItem } from './Sidebar';
import type { PaletteAction } from './CommandPalette';
import type { Permission } from '../../shared/permissions';

type Can = (p: Permission) => boolean;

const CHILD_ICONS: Record<string, LucideIcon> = {
  Customers: UserRound, Quotes: FileSignature, 'Sales Orders': ClipboardList, Invoices: FileText, 'Delivery Challans': Truck, 'Payments Received': IndianRupee,
  'Credit Notes': FileMinus, 'Recurring Invoices': Repeat, 'Point of Sale': ScanLine, Vendors: Truck, 'Purchase Orders': ClipboardList,
  Bills: Receipt, 'Payments Made': IndianRupee, Expenses: WalletIcon, Items: Package, Warehouses: Warehouse, 'Stock Adjustments': SlidersHorizontal,
  Transfers: ArrowLeftRight, 'Smart Reorder': BrainCircuit, 'Stock Summary': Boxes, 'Chart of Accounts': BookOpen, 'Manual Journals': NotebookPen, 'General Ledger': BookOpen, Banking: Bank,
};

/** Sidebar information architecture. Order and grouping follow how a shop actually works through a day. */
export function buildNav(can: Can): NavItem[] {
  const items: NavItem[] = [{ label: 'Dashboard', icon: LayoutDashboard, to: '/app', end: true }];
  items.push({
    label: 'Sales', icon: ShoppingCart,
    children: [
      { label: 'Customers', to: '/app/sales/customers' },
      { label: 'Quotes', to: '/app/sales/quotes' },
      { label: 'Sales Orders', to: '/app/sales/orders' },
      { label: 'Delivery Challans', to: '/app/sales/challans' },
      { label: 'Invoices', to: '/app/sales/invoices' },
      { label: 'Payments Received', to: '/app/sales/payments' },
      { label: 'Credit Notes', to: '/app/sales/credit-notes' },
      ...(can('admin') ? [{ label: 'Recurring Invoices', to: '/app/sales/recurring' }] : []),
      ...(can('sales.write') ? [{ label: 'Point of Sale', to: '/app/pos' }] : []),
    ],
  });
  if (can('purchases.read')) {
    items.push({
      label: 'Purchases', icon: ShoppingBag,
      children: [
        { label: 'Vendors', to: '/app/purchases/vendors' },
        { label: 'Purchase Orders', to: '/app/purchases/orders' },
        { label: 'Bills', to: '/app/purchases/bills' },
        { label: 'Payments Made', to: '/app/purchases/payments' },
        { label: 'Expenses', to: '/app/purchases/expenses' },
      ],
    });
  }
  items.push({
    label: 'Inventory', icon: Boxes,
    children: [
      { label: 'Items', to: '/app/items' },
      ...(can('items.write') || can('purchases.read') || can('reports.read') ? [{ label: 'Smart Reorder', to: '/app/inventory/reorder' }] : []),
      { label: 'Warehouses', to: '/app/inventory/warehouses' },
      { label: 'Stock Adjustments', to: '/app/inventory/adjustments' },
      { label: 'Transfers', to: '/app/inventory/transfers' },
      { label: 'Stock Summary', to: '/app/inventory/stock-summary' },
    ],
  });
  const accounting = [
    ...(can('accounting.read') ? [{ label: 'Chart of Accounts', to: '/app/accounting/accounts' }, { label: 'Manual Journals', to: '/app/accounting/journals' }, { label: 'General Ledger', to: '/app/accounting/ledger' }] : []),
    ...(can('banking.read') ? [{ label: 'Banking', to: '/app/banking' }] : []),
  ];
  if (accounting.length) items.push({ label: 'Accounting', icon: Landmark, children: accounting });
  if (can('reports.read')) items.push({ label: 'Reports', icon: BarChart3, to: '/app/reports' });
  if (can('admin')) items.push({ label: 'Settings', icon: Settings, to: '/app/organization' });
  else if (can('audit.read')) items.push({ label: 'Audit Log', icon: History, to: '/app/audit' });
  return items.map((it) => (it.children ? { ...it, children: it.children.map((c) => ({ ...c, icon: CHILD_ICONS[c.label] })) } : it));
}

export interface CreateLink { label: string; icon: LucideIcon; to: string; keys?: string }

/** "+ New" menu, grouped like the sidebar. */
export function buildCreate(can: Can): Array<{ title: string; links: CreateLink[] }> {
  const cols = [
    { title: 'Sales', links: [
      can('sales.write') && { label: 'Invoice', icon: FileText, to: '/app/sales/invoices/new', keys: 'N' },
      can('sales.write') && { label: 'Quote', icon: FileSignature, to: '/app/sales/quotes?new=1' },
      can('sales.write') && { label: 'Sales order', icon: ClipboardList, to: '/app/sales/orders?new=1' },
      can('sales.write') && { label: 'Delivery challan', icon: Truck, to: '/app/sales/challans?new=1' },
      can('customers.write') && { label: 'Customer', icon: UserRound, to: '/app/sales/customers?new=1' },
      can('sales.write') && { label: 'POS sale', icon: ScanLine, to: '/app/pos' },
    ] },
    { title: 'Purchases', links: [
      can('purchases.write') && { label: 'Bill', icon: Receipt, to: '/app/purchases/bills?new=1' },
      can('purchases.write') && { label: 'Purchase order', icon: ClipboardList, to: '/app/purchases/orders?new=1' },
      can('purchases.write') && { label: 'Vendor', icon: Truck, to: '/app/purchases/vendors?new=1' },
      can('purchases.write') && { label: 'Expense', icon: Wallet, to: '/app/purchases/expenses?new=1' },
    ] },
    { title: 'Inventory', links: [
      can('items.write') && { label: 'Item', icon: Package, to: '/app/items/new' },
      can('items.write') && { label: 'Service', icon: Wrench, to: '/app/items/new?type=Services' },
      can('items.write') && { label: 'Stock adjustment', icon: SlidersHorizontal, to: '/app/inventory/adjustments?new=1' },
      can('items.write') && { label: 'Transfer', icon: ArrowLeftRight, to: '/app/inventory/transfers?new=1' },
    ] },
  ];
  return cols.map((c) => ({ ...c, links: c.links.filter(Boolean) as CreateLink[] })).filter((c) => c.links.length);
}

/** Command palette actions: everything in the sidebar plus the create shortcuts. */
export function buildActions(can: Can): PaletteAction[] {
  const out: PaletteAction[] = [];
  const add = (cond: boolean, group: string, label: string, icon: LucideIcon, to: string, keywords = '', meta?: string) => cond && out.push({ group, label, icon, to, keywords, meta });
  add(can('sales.write'), 'Create', 'New invoice', FileText, '/app/sales/invoices/new', 'bill sale gst', 'N');
  add(can('customers.write'), 'Create', 'New customer', UserRound, '/app/sales/customers?new=1', 'client party');
  add(can('items.write'), 'Create', 'New item', Package, '/app/items/new', 'product goods sku');
  add(can('sales.write'), 'Create', 'New quote', FileSignature, '/app/sales/quotes?new=1', 'estimate quotation proforma');
  add(can('sales.write'), 'Create', 'New sales order', ClipboardList, '/app/sales/orders?new=1', 'order booking');
  add(can('purchases.write'), 'Create', 'New bill', Receipt, '/app/purchases/bills?new=1', 'purchase vendor payable');
  add(can('purchases.write'), 'Create', 'New purchase order', ClipboardList, '/app/purchases/orders?new=1', 'po restock');
  add(can('purchases.write'), 'Create', 'Record expense', Wallet, '/app/purchases/expenses?new=1', 'rent salary electricity');
  add(can('sales.write'), 'Create', 'POS sale', ScanLine, '/app/pos', 'counter retail scan');
  add(true, 'Go to', 'Dashboard', LayoutDashboard, '/app', 'home overview');
  add(true, 'Go to', 'Customers', UserRound, '/app/sales/customers');
  add(true, 'Go to', 'Quotes', FileSignature, '/app/sales/quotes', 'estimates quotations');
  add(true, 'Go to', 'Sales orders', ClipboardList, '/app/sales/orders');
  add(true, 'Go to', 'Invoices', FileText, '/app/sales/invoices');
  add(true, 'Go to', 'Payments received', IndianRupee, '/app/sales/payments', 'collections receipts');
  add(true, 'Go to', 'Credit notes', FileMinus, '/app/sales/credit-notes', 'returns refund');
  add(can('admin'), 'Go to', 'Recurring invoices', Repeat, '/app/sales/recurring', 'subscription monthly');
  add(can('purchases.read'), 'Go to', 'Vendors', Truck, '/app/purchases/vendors', 'suppliers');
  add(can('purchases.read'), 'Go to', 'Purchase orders', ClipboardList, '/app/purchases/orders', 'po');
  add(can('purchases.read'), 'Go to', 'Bills', Receipt, '/app/purchases/bills', 'payables');
  add(can('purchases.read'), 'Go to', 'Payments made', IndianRupee, '/app/purchases/payments', 'vendor payments payables ageing');
  add(can('purchases.read'), 'Go to', 'Expenses', Wallet, '/app/purchases/expenses');
  add(true, 'Go to', 'Items', Package, '/app/items', 'inventory products catalogue stock');
  add(true, 'Go to', 'Warehouses', Warehouse, '/app/inventory/warehouses', 'branches godown store locations');
  add(true, 'Go to', 'Stock adjustments', SlidersHorizontal, '/app/inventory/adjustments', 'stock count damaged expired write off');
  add(true, 'Go to', 'Transfers', ArrowLeftRight, '/app/inventory/transfers', 'move stock between branches in transit');
  add(can('items.write') || can('purchases.read'), 'Go to', 'Smart Reorder', BrainCircuit, '/app/inventory/reorder', 'reorder low stock purchase suggestions dead stock expiry AI');
  add(true, 'Go to', 'Delivery Challans', Truck, '/app/sales/challans', 'dispatch delivery order tracking vehicle');
  add(true, 'Go to', 'Stock summary', Boxes, '/app/inventory/stock-summary', 'inventory valuation closing stock report');
  add(can('items.write'), 'Create', 'Record stock count', SlidersHorizontal, '/app/inventory/adjustments?new=1&mode=count', 'physical count audit');
  add(true, 'Go to', 'Low stock', Boxes, '/app/items?tab=stock', 'reorder expiry batches alerts');
  add(can('banking.read'), 'Go to', 'Banking', Landmark, '/app/banking', 'cash bank accounts');
  add(can('reports.read'), 'Go to', 'Reports', BarChart3, '/app/reports', 'all reports export pdf excel');
  add(can('reports.read'), 'Reports', 'Profit & Loss', BarChart3, '/app/reports/profit-loss', 'pnl income statement profit loss');
  add(can('reports.read'), 'Reports', 'Balance Sheet', BarChart3, '/app/reports/balance-sheet', 'assets liabilities equity');
  add(can('reports.read'), 'Reports', 'Cash Flow', BarChart3, '/app/reports/cash-flow', 'cash bank money in out');
  add(can('reports.read'), 'Reports', 'Sales by Customer', BarChart3, '/app/reports/sales-by-customer', 'top customers');
  add(can('reports.read'), 'Reports', 'Sales by Item', BarChart3, '/app/reports/sales-by-item', 'best sellers products');
  add(can('reports.read'), 'Reports', 'Receivables Ageing', BarChart3, '/app/reports/receivables', 'outstanding overdue aging');
  add(can('reports.read') && can('purchases.read'), 'Reports', 'Payables Ageing', BarChart3, '/app/reports/payables', 'vendor outstanding aging');
  add(can('reports.read'), 'Reports', 'GST returns', BarChart3, '/app/reports/gst', 'gstr-1 gstr-3b hsn');
  add(can('accounting.read'), 'Reports', 'Trial Balance', BarChart3, '/app/reports/trial-balance', 'debit credit');
  add(can('accounting.read'), 'Go to', 'Chart of accounts', BookOpen, '/app/accounting/accounts', 'ledger accounts coa');
  add(can('accounting.read'), 'Go to', 'Manual journals', NotebookPen, '/app/accounting/journals', 'journal entry jv adjustment');
  add(can('accounting.read'), 'Go to', 'General ledger', BookOpen, '/app/accounting/ledger', 'account statement');
  add(can('accounting.write'), 'Create', 'New journal entry', NotebookPen, '/app/accounting/journals?new=1', 'jv manual');
  add(can('audit.read'), 'Settings', 'Audit log', History, '/app/audit', 'activity changes who history');
  add(can('admin'), 'Settings', 'Organisation profile', Building2, '/app/organization', 'logo gstin upi address');
  add(can('admin'), 'Settings', 'Print settings', Printer, '/app/print-settings', 'invoice template thermal barcode label');
  add(can('admin'), 'Settings', 'Users & roles', Users, '/app/team', 'staff team branch warehouse');
  return out;
}
