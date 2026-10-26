import {
  ArrowLeftRight, BarChart3, BrainCircuit, RefreshCw, MapPin, MapPinned, BookOpen, Boxes, Building2, ClipboardList, FileMinus, FileSignature, FileText, History, IndianRupee, Landmark, LayoutDashboard,
  NotebookPen, Package, Percent, Printer, Receipt, Repeat, Scale, ScanLine, CreditCard, SlidersHorizontal, Truck, UserRound, Users, Wallet, Warehouse, type LucideIcon,
} from 'lucide-react';

/** Icon and colour for each page title, matched on the longest route prefix. */
const ICONS: Array<[string, LucideIcon, string]> = [
  ['/app/sales/customers', UserRound, 'blush'], ['/app/sales/quotes', FileSignature, 'gold'], ['/app/sales/orders', ClipboardList, 'sage'], ['/app/sales/challans', Truck, 'gold'],
  ['/app/sales/invoices', FileText, 'rose'], ['/app/sales/payments', IndianRupee, 'sage'], ['/app/sales/credit-notes', FileMinus, 'cocoa'],
  ['/app/sales/recurring', Repeat, 'gold'], ['/app/pos', ScanLine, 'rose'],
  ['/app/purchases/vendors', Truck, 'cocoa'], ['/app/purchases/orders', ClipboardList, 'gold'], ['/app/purchases/bills', Receipt, 'rose'],
  ['/app/purchases/payments', IndianRupee, 'sage'], ['/app/purchases/expenses', Wallet, 'gold'],
  ['/app/items', Package, 'sage'], ['/app/inventory/warehouses', Warehouse, 'cocoa'], ['/app/inventory/adjustments', SlidersHorizontal, 'gold'],
  ['/app/inventory/transfers', ArrowLeftRight, 'blush'], ['/app/inventory/reorder', BrainCircuit, 'rose'], ['/app/accounting/tally', RefreshCw, 'sage'], ['/app/field/team', MapPinned, 'sage'], ['/app/field', MapPin, 'rose'], ['/app/inventory/stock-summary', Boxes, 'sage'],
  ['/app/banking', Landmark, 'cocoa'], ['/app/accounting/accounts', BookOpen, 'rose'], ['/app/accounting/journals', NotebookPen, 'gold'], ['/app/accounting/ledger', BookOpen, 'sage'],
  ['/app/reports/gst', Percent, 'gold'], ['/app/reports/balance-sheet', Scale, 'sage'], ['/app/reports', BarChart3, 'rose'],
  ['/app/organization', Building2, 'rose'], ['/app/team', Users, 'sage'], ['/app/print-settings', Printer, 'cocoa'], ['/app/billing', CreditCard, 'gold'], ['/app/audit', History, 'cocoa'],
  ['/app', LayoutDashboard, 'rose'],
];

export function pageIcon(pathname: string): { icon: LucideIcon; tone: string } | null {
  const hit = ICONS.filter(([p]) => pathname === p || pathname.startsWith(p + '/')).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? { icon: hit[1], tone: hit[2] } : null;
}
