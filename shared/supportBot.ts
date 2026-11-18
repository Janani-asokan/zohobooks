/**
 * The help bot's understanding: plain rules, no AI, so it works for every shop at no cost. It recognises questions
 * about the shop's own data (stock, an invoice, what a customer owes, overdue bills, low stock, today's sales), asks
 * for a person, or matches a how-to answer. The server looks the data up (routes/shop/support.ts).
 */

export type Intent =
  | { kind: 'human' }
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'invoice'; number: string }
  | { kind: 'low_stock' }
  | { kind: 'stock'; query: string }
  | { kind: 'dues'; who: string }
  | { kind: 'overdue' }
  | { kind: 'sales_today' }
  | { kind: 'howto'; id: string }
  | { kind: 'unknown' };

export interface HowTo { id: string; title: string; keywords: string[]; answer: string; link?: { label: string; to: string } }

/** Short answers to the questions shops ask most, each with the screen to go to. */
export const HOWTO: HowTo[] = [
  { id: 'new_invoice', title: 'Make an invoice', keywords: ['create invoice', 'new invoice', 'make invoice', 'make bill', 'new bill', 'raise invoice', 'generate invoice', 'billing'],
    answer: 'Sales → Invoices → New invoice. Pick the customer, type the item name and press Enter, type the quantity and press Enter. Press Enter in the empty item box when done to issue it.', link: { label: 'New invoice', to: '/app/sales/invoices/new' } },
  { id: 'pos', title: 'Counter billing (POS)', keywords: ['pos', 'counter', 'scan', 'barcode billing', 'quick bill', 'retail bill'],
    answer: 'Point of Sale: scan or type items, press Enter on the empty box to go to payment, Enter again to finish. It keeps billing when the internet drops.', link: { label: 'Open POS', to: '/app/pos' } },
  { id: 'payment', title: 'Record a payment', keywords: ['payment received', 'record payment', 'receive payment', 'customer paid', 'collect money', 'mark paid'],
    answer: 'Open the invoice and press Record payment, or go to Sales → Payments Received → New. Part payments are fine.', link: { label: 'Payments received', to: '/app/sales/payments' } },
  { id: 'cancel_invoice', title: 'Cancel or change an invoice', keywords: ['cancel invoice', 'delete invoice', 'edit invoice', 'wrong invoice', 'change invoice', 'modify bill'],
    answer: 'Open the invoice: Edit works until a payment is recorded; Cancel puts the stock back. After a payment, issue a credit note instead.', link: { label: 'Invoices', to: '/app/sales/invoices' } },
  { id: 'credit_note', title: 'Returns and credit notes', keywords: ['return', 'credit note', 'refund', 'sales return', 'goods returned'],
    answer: 'Sales → Credit Notes → New, pick the invoice and the items returned. The stock comes back and the customer’s balance goes down.', link: { label: 'Credit notes', to: '/app/sales/credit-notes' } },
  { id: 'add_item', title: 'Add an item', keywords: ['add item', 'new item', 'add product', 'new product', 'create item'],
    answer: 'Items → New item. Type the name; the HSN, GST rate and unit are suggested. Enter opening stock and which branch holds it.', link: { label: 'New item', to: '/app/items/new' } },
  { id: 'stock_adjust', title: 'Correct stock', keywords: ['adjust stock', 'stock correction', 'stock count', 'wrong stock', 'damaged stock', 'negative stock'],
    answer: 'Inventory → Stock Adjustments → New. Choose “Enter counted quantity” to set what is on the shelf; the difference is recorded with a reason.', link: { label: 'Stock adjustments', to: '/app/inventory/adjustments' } },
  { id: 'transfer', title: 'Send stock to another branch', keywords: ['transfer', 'move stock', 'send stock', 'branch stock', 'stock to branch', 'warehouse transfer'],
    answer: 'Inventory → Transfers → New transfer. Stock leaves your branch at once and is added at the other branch when its manager enters the code emailed to them.', link: { label: 'Transfers', to: '/app/inventory/transfers' } },
  { id: 'receipt_code', title: 'Receipt code for a transfer', keywords: ['receipt code', 'otp', 'code not received', 'transfer code', 'verify transfer', 'receive transfer'],
    answer: 'The code goes to the destination branch’s manager. Open the transfer (Transfers → To receive) and press Resend code; it works for 15 minutes and 3 tries. The owner can receive without a code by giving a reason.', link: { label: 'To receive', to: '/app/inventory/transfers?tab=receive' } },
  { id: 'not_enough_stock', title: 'Bill blocked: not enough stock', keywords: ['not enough stock', 'insufficient stock', 'cannot bill', 'stock block', 'sell anyway'],
    answer: 'A branch can sell only what it holds. Record the purchase bill or transfer the stock to that branch first. The owner can sell anyway with a reason.', link: { label: 'Purchase bills', to: '/app/purchases/bills' } },
  { id: 'purchase', title: 'Enter a purchase bill', keywords: ['purchase', 'purchase bill', 'vendor bill', 'supplier bill', 'stock in', 'goods received'],
    answer: 'Purchases → Bills → New bill. You can upload a photo or PDF of the vendor’s bill to fill it in. Itemised bills add the stock.', link: { label: 'New bill', to: '/app/purchases/bills?new=1' } },
  { id: 'gst_return', title: 'GST returns', keywords: ['gstr', 'gst return', 'gstr1', 'gstr-1', 'gstr3b', 'gstr-3b', 'gst report', 'tax report', 'gst filing'],
    answer: 'Reports → GST returns shows GSTR-1 and GSTR-3B for the month, ready to export for your CA or the GST portal.', link: { label: 'GST reports', to: '/app/reports/gst' } },
  { id: 'eway', title: 'E-way bill', keywords: ['eway', 'e-way', 'e way bill', 'vehicle number'],
    answer: 'Open the invoice and add the e-way bill and vehicle number in the transport details; they print on the invoice. An e-way bill is needed when goods worth over ₹50,000 move.', link: { label: 'Invoices', to: '/app/sales/invoices' } },
  { id: 'printer', title: 'Printer and paper size', keywords: ['print', 'printer', 'thermal', 'receipt size', 'a4', 'paper size', 'print problem', 'printing'],
    answer: 'Settings → Print settings: choose A4 or a thermal roll (58 or 80 mm) and the layout. In the printer’s own settings, set the same paper size.', link: { label: 'Print settings', to: '/app/print-settings' } },
  { id: 'labels', title: 'Barcode labels', keywords: ['label', 'barcode label', 'sticker', 'print barcode', 'tsc', 'label printer'],
    answer: 'Inventory → Barcode labels. Pick items (or a purchase bill) and the label size, check the preview, then print.', link: { label: 'Barcode labels', to: '/app/items/labels' } },
  { id: 'staff', title: 'Add staff', keywords: ['add staff', 'add user', 'new user', 'employee login', 'staff login', 'roles', 'permission'],
    answer: 'Settings → Users, roles & branches → Add staff. Choose the role; each role sees only what it needs.', link: { label: 'Users & roles', to: '/app/team' } },
  { id: 'password', title: 'Password', keywords: ['password', 'forgot password', 'reset password', 'change password', 'login problem', 'cannot login'],
    answer: 'Use “Forgot password” on the sign-in page to get a reset link by email. Staff can ask the owner to set a new one in Users & roles.', link: { label: 'Users & roles', to: '/app/team' } },
  { id: 'customer', title: 'Add a customer', keywords: ['add customer', 'new customer', 'customer gstin', 'edit customer'],
    answer: 'Sales → Customers → New customer, or the + next to the customer box on an invoice. Add the GSTIN for business customers.', link: { label: 'Customers', to: '/app/sales/customers' } },
  { id: 'reminder', title: 'Payment reminders', keywords: ['reminder', 'remind customer', 'whatsapp reminder', 'follow up payment'],
    answer: 'Open an overdue invoice and send a reminder by WhatsApp or email. Automatic reminders can be switched on in the Business profile.', link: { label: 'Overdue invoices', to: '/app/sales/invoices?status=Overdue' } },
  { id: 'offline', title: 'Billing without internet', keywords: ['offline', 'no internet', 'internet down', 'network problem'],
    answer: 'POS keeps billing offline: bills are kept on the device and sent when the internet is back. Other screens need the internet.', link: { label: 'Open POS', to: '/app/pos' } },
  { id: 'plan', title: 'Plan, renewal and payment', keywords: ['renew', 'subscription', 'plan', 'licence expired', 'license expired', 'upgrade', 'pay for software'],
    answer: 'Settings → Billing shows your plan and when it ends, and lets you renew or upgrade online.', link: { label: 'Billing', to: '/app/billing' } },
  { id: 'backup', title: 'Data and backups', keywords: ['backup', 'export data', 'download data', 'excel export', 'tally'],
    answer: 'Your data is backed up on the server every day. Lists have Export to Excel or PDF, and Accounting → Tally & Import exports to Tally.', link: { label: 'Tally & Import', to: '/app/accounting/tally' } },
  { id: 'warehouse_licence', title: 'Warehouse licences', keywords: ['fssai', 'licence', 'license', 'fire noc', 'bond licence', 'permit expiry'],
    answer: 'Inventory → Warehouse licences keeps FSSAI and other permits with reminders before expiry; a blocked licence stops invoices until renewed.', link: { label: 'Warehouse licences', to: '/app/licenses' } },
  { id: 'branch_price', title: 'Different price at a branch', keywords: ['branch price', 'seasonal price', 'location price', 'price rule', 'price at branch'],
    answer: 'Transfers → Branch pricing: location rules (always at a branch) and seasonal rules (between dates). Billing at that branch then fills in its price.', link: { label: 'Branch pricing', to: '/app/inventory/pricing' } },
];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s/-]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['what', 'is', 'the', 'of', 'for', 'a', 'an', 'my', 'me', 'how', 'many', 'much', 'do', 'we', 'i', 'have', 'has', 'in', 'stock', 'available', 'left', 'show',
  'tell', 'check', 'qty', 'quantity', 'units', 'pcs', 'please', 'pls', 'are', 'there', 'at', 'hand', 'on', 'any', 'balance', 'current', 'can', 'you', 'item', 'product', 'kitna', 'hai']);

/** The words that name an item, after the question words are taken out. */
export const itemWords = (q: string) => norm(q).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

export function bestHowTo(text: string): HowTo | null {
  const words = new Set(norm(text).split(' '));
  // A keyword phrase counts when all its words are in the question, in any order ("record a payment" ⊇ "record payment").
  const has = (k: string) => norm(k).split(' ').every((w) => words.has(w) || [...words].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x))));
  let best: { h: HowTo; score: number } | null = null;
  for (const h of HOWTO) {
    const score = h.keywords.reduce((s, k) => s + (has(k) ? k.split(' ').length + 1 : 0), 0);
    if (score > (best?.score ?? 0)) best = { h, score };
  }
  return best && best.score >= 2 ? best.h : null;
}

export function understand(text: string): Intent {
  const raw = text.trim();
  const t = norm(raw);
  if (!t) return { kind: 'unknown' };
  if (/\b(agent|human|person|executive|customer care|support team|call me|callback|call back|talk to|speak to|connect me|not solved|not resolved)\b/.test(t)) return { kind: 'human' };
  const inv = /\b([A-Z]{2,6}[-/]\d{2,4}[-/]?\d{0,2}[-/]\d{1,6}|[A-Z]{2,6}-\d{3,6})\b/i.exec(raw);
  if (inv && /\b(inv|invoice|bill|si|pos)/i.test(raw)) return { kind: 'invoice', number: inv[1]!.toUpperCase() };
  if (inv && /^[A-Z]{2,6}[-/]/i.test(inv[1]!)) return { kind: 'invoice', number: inv[1]!.toUpperCase() };
  if (/\b(low (on )?stock|short on stock|reorder|running out|out of stock|finishing)\b/.test(t)) return { kind: 'low_stock' };
  if (/\b(sales|sold|collection|business)\b.*\btoday|\btoday.*\b(sales|sold|collection)\b|\btodays sales\b/.test(t)) return { kind: 'sales_today' };
  const dues = /\b(?:how much (?:does|did|is)?\s*)?(.+?)\s+(?:owes?|has to pay|pending amount|outstanding|due)\b/.exec(t) ?? /\b(?:outstanding|dues?|balance|pending) (?:of|from|for)\s+(.+)$/.exec(t);
  if (dues && dues[1] && !/^(what|how|which|who|any|all|total|my)$/.test(dues[1].trim())) return { kind: 'dues', who: dues[1].replace(/^(how much|what is|whats)\s+/, '').trim() };
  if (/\b(overdue|unpaid|not paid|pending payments?|pending invoices|receivables|who owes)\b/.test(t)) return { kind: 'overdue' };
  const how = bestHowTo(raw);
  const stockAsk = /\b(stock|how many|available|in hand|quantity|qty|kitna|left)\b/.test(t);
  if (stockAsk && itemWords(raw).length && !(how && how.id !== 'stock_adjust' && /\b(how (do|to|can)|where)\b/.test(t))) return { kind: 'stock', query: itemWords(raw).join(' ') };
  if (how) return { kind: 'howto', id: how.id };
  if (/^(hi|hello|hey|hii|namaste|vanakkam|good (morning|afternoon|evening))\b/.test(t)) return { kind: 'greeting' };
  if (/\b(thanks|thank you|thankyou|solved|got it|ok thanks|done)\b/.test(t)) return { kind: 'thanks' };
  return { kind: 'unknown' };
}

/** Starter questions shown as chips. */
export const STARTERS = ['Stock of HP 680 ink', 'Which bills are overdue?', 'What is low on stock?', 'How do I record a payment?', 'Transfer code not received', 'Talk to a person'];
