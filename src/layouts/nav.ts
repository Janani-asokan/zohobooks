import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Boxes, Landmark, BarChart3, Settings, FileText, UserRound, ClipboardList, Receipt, Wallet,
  Truck, Package, ScanLine, FileSignature, Repeat, IndianRupee, FileMinus, Building2, Printer, Users, Wrench, type LucideIcon,
} from 'lucide-react';
import type { NavItem } from './Sidebar';
import type { PaletteAction } from './CommandPalette';
import type { Permission } from '../../shared/permissions';

type Can = (p: Permission) => boolean;

/** Sidebar information architecture. Order and grouping follow how a shop actually works through a day. */
export function buildNav(can: Can): NavItem[] {
  const items: NavItem[] = [{ label: 'Dashboard', icon: LayoutDashboard, to: '/app', end: true }];
  items.push({
    label: 'Sales', icon: ShoppingCart,
    children: [
      { label: 'Customers', to: '/app/sales/customers' },
      { label: 'Quotes', to: '/app/sales/quotes' },
      { label: 'Sales Orders', to: '/app/sales/orders' },
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
        { label: 'Expenses', to: '/app/purchases/expenses' },
      ],
    });
  }
  items.push({ label: 'Inventory', icon: Boxes, children: [{ label: 'Items', to: '/app/items' }] });
  if (can('banking.read')) items.push({ label: 'Accounting', icon: Landmark, children: [{ label: 'Banking', to: '/app/banking' }] });
  if (can('reports.read')) items.push({ label: 'Reports', icon: BarChart3, to: '/app/reports' });
  if (can('admin')) items.push({ label: 'Settings', icon: Settings, to: '/app/organization' });
  return items;
}

export interface CreateLink { label: string; icon: LucideIcon; to: string; keys?: string }

/** "+ New" menu, grouped like the sidebar. */
export function buildCreate(can: Can): Array<{ title: string; links: CreateLink[] }> {
  const cols = [
    { title: 'Sales', links: [
      can('sales.write') && { label: 'Invoice', icon: FileText, to: '/app/sales/invoices/new', keys: 'N' },
      can('sales.write') && { label: 'Quote', icon: FileSignature, to: '/app/sales/quotes?new=1' },
      can('sales.write') && { label: 'Sales order', icon: ClipboardList, to: '/app/sales/orders?new=1' },
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
  add(can('purchases.read'), 'Go to', 'Expenses', Wallet, '/app/purchases/expenses');
  add(true, 'Go to', 'Items', Package, '/app/items', 'inventory products catalogue stock');
  add(true, 'Go to', 'Low stock', Boxes, '/app/items?tab=stock', 'reorder expiry batches alerts');
  add(can('banking.read'), 'Go to', 'Banking', Landmark, '/app/banking', 'cash bank accounts');
  add(can('reports.read'), 'Go to', 'Reports', BarChart3, '/app/reports', 'gstr-1 gstr-3b profit loss hsn');
  add(can('admin'), 'Settings', 'Organisation profile', Building2, '/app/organization', 'logo gstin upi address');
  add(can('admin'), 'Settings', 'Print settings', Printer, '/app/print-settings', 'invoice template thermal barcode label');
  add(can('admin'), 'Settings', 'Users & roles', Users, '/app/team', 'staff team branch warehouse');
  return out;
}
