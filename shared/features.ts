/*
 * The feature catalogue: what a shop can switch on and pay for, on top of the core billing every shop gets.
 *
 * - The catalogue lives in code, because each feature says which screens and API calls it unlocks.
 *   Prices live in the database (feature_prices), so the platform owner edits them without a release.
 * - A feature can have levels (for example attendance: manual, face, biometric). Levels are ordered, and a higher
 *   level includes everything below it.
 * - Turning a feature off only hides it. Its data is never deleted, and turning it back on shows everything again.
 * - Adding a feature: add an entry here, a default price in a migration, and the screens and API it covers. The tests
 *   check that every entry is consistent.
 */

export type FeatureGroup = 'Sales' | 'Purchases' | 'Inventory' | 'Accounting' | 'Staff' | 'AI' | 'Finance';

export interface FeatureLevel { key: string; name: string; description: string }

export interface FeatureDef {
  key: string;
  name: string;
  group: FeatureGroup;
  /** One line a shop owner understands: what it does for them. */
  summary: string;
  /** What is included, in plain words, shown on the Features page. */
  includes: string[];
  levels: FeatureLevel[];
  /** false = listed for the platform owner to price, not yet offered to shops. */
  available: boolean;
  /** API paths under /api/shop this feature unlocks (tested against the start of the path). */
  api: RegExp[];
  /** App pages it unlocks. */
  pages: RegExp[];
  /** Default price per month in rupees for each level, used until the platform owner sets one. */
  defaultMonthly: Record<string, number>;
}

const one = (description: string): FeatureLevel[] => [{ key: 'standard', name: 'Standard', description }];

export const FEATURES: FeatureDef[] = [
  {
    key: 'quotes_orders', name: 'Quotes, orders & challans', group: 'Sales',
    summary: 'Send quotes, take orders and send goods with a delivery challan before you bill.',
    includes: ['Quotes that turn into orders or invoices in one tap', 'Sales orders', 'Delivery challans'],
    levels: one('All three documents'), available: true,
    api: [/^\/sales-orders(\/|$)/, /^\/delivery-challans(\/|$)/],
    pages: [/^\/app\/sales\/(quotes|orders|challans)(\/|$)/],
    defaultMonthly: { standard: 99 },
  },
  {
    key: 'recurring', name: 'Recurring invoices', group: 'Sales',
    summary: 'Bills that raise themselves every week or month, for rent, AMC or subscriptions.',
    includes: ['Weekly, monthly or yearly profiles', 'Invoices created automatically on the day'],
    levels: one('Unlimited profiles'), available: true,
    api: [/^\/recurring(\/|$)/], pages: [/^\/app\/sales\/recurring(\/|$)/],
    defaultMonthly: { standard: 49 },
  },
  {
    key: 'pos', name: 'Counter billing (POS)', group: 'Sales',
    summary: 'Fast counter billing with barcode scanner, weighing scale and thermal receipts.',
    includes: ['Touch and barcode billing', 'Weighing scale reading', '58mm and 80mm thermal receipts', 'Split payments'],
    levels: one('One counter screen per staff login'), available: true,
    api: [/^\/pos(\/|$)/], pages: [/^\/app\/pos(\/|$)/],
    defaultMonthly: { standard: 199 },
  },
  {
    key: 'purchases', name: 'Purchases & expenses', group: 'Purchases',
    summary: 'Record what you buy and spend, and know what you owe each supplier.',
    includes: ['Vendors and vendor statements', 'Purchase orders', 'Bills that add stock', 'Payments made', 'Expenses', 'Payables ageing'],
    levels: one('All purchase documents'), available: true,
    api: [/^\/(vendors|purchase-orders|bills|bill-payments|expenses|payables-ageing)(\/|$)/],
    pages: [/^\/app\/purchases(\/|$)/, /^\/app\/reports\/payables(\/|$)/],
    defaultMonthly: { standard: 149 },
  },
  {
    key: 'inventory_plus', name: 'Advanced inventory', group: 'Inventory',
    summary: 'More than one godown, stock counts, transfers and smart reorder suggestions.',
    includes: ['Warehouses and stock transfers', 'Stock adjustments and counts', 'Stock summary', 'Smart reorder and dead-stock alerts'],
    levels: one('All advanced stock tools'), available: true,
    api: [/^\/stock\/(adjustments|transfers?|insights|summary)(\/|$)/],
    pages: [/^\/app\/inventory\/(warehouses|adjustments|transfers|stock-summary|reorder)(\/|$)/],
    defaultMonthly: { standard: 149 },
  },
  {
    key: 'accounting', name: 'Full accounting', group: 'Accounting',
    summary: 'Chart of accounts, journals, ledger, trial balance, balance sheet and cash flow.',
    includes: ['Chart of accounts', 'Manual journals', 'General ledger', 'Trial balance', 'Balance sheet', 'Cash flow'],
    levels: one('All accounting books and reports'), available: true,
    api: [/^\/accounting\//, /^\/reports\/(balance-sheet|cash-flow)(\/|$)/],
    pages: [/^\/app\/accounting\/(accounts|journals|ledger)(\/|$)/, /^\/app\/reports\/(trial-balance|balance-sheet|cash-flow)(\/|$)/],
    defaultMonthly: { standard: 199 },
  },
  {
    key: 'tally', name: 'Tally export & data import', group: 'Accounting',
    summary: 'Send your books to your auditor in Tally, or bring data in from Tally and spreadsheets.',
    includes: ['Tally masters and vouchers export', 'Import from Tally and Excel with automatic column matching'],
    levels: one('Export and import'), available: true,
    api: [/^\/tally\//, /^\/data-import(\/|$)/], pages: [/^\/app\/accounting\/tally(\/|$)/],
    defaultMonthly: { standard: 99 },
  },
  {
    key: 'field', name: 'Field sales team', group: 'Staff',
    summary: 'See where your salesmen visit, with check-ins, a map of the day and order taking on the road.',
    includes: ['Day start and end', 'Shop visits with GPS check-in', 'Team map', 'Daily visit summary'],
    levels: one('All field staff'), available: true,
    api: [/^\/field\//, /^\/ai\/field-summary(\/|$)/], pages: [/^\/app\/field(\/|$)/],
    defaultMonthly: { standard: 199 },
  },
  {
    key: 'attendance', name: 'Staff attendance', group: 'Staff',
    summary: 'Know who came to work and when, and pay salaries on correct days.',
    includes: ['Daily attendance', 'Monthly attendance report'],
    levels: [
      { key: 'manual', name: 'Manual entry', description: 'The owner or manager marks attendance' },
      { key: 'face', name: 'Face recognition', description: 'Staff mark attendance with a selfie on the shop phone' },
      { key: 'biometric', name: 'Biometric device', description: 'Attendance comes from a fingerprint machine' },
    ],
    available: false, api: [], pages: [],
    defaultMonthly: { manual: 99, face: 199, biometric: 299 },
  },
  {
    key: 'ai', name: 'AI assistant', group: 'AI',
    summary: 'Ask questions about your business, read bills from a photo and get daily advice.',
    includes: ['Ask AI about sales, dues and stock', 'Smart reader for bills and price lists', 'Type or speak a bill', 'Morning briefing and health score', 'AI payment reminders'],
    levels: one('All AI tools'), available: true,
    // Core keeps the health score and the plain-words daily plan; they use AI only when the shop has this feature.
    api: [/^\/ai\/(?!status$|briefing$)/], pages: [],
    defaultMonthly: { standard: 299 },
  },
  {
    key: 'microfinance', name: 'Microfinance management', group: 'Finance',
    summary: 'Give daily, weekly and monthly loans, collect instalments and track dues and defaulters.',
    includes: ['Borrowers with KYC', 'Loan book with EMI schedules', 'Collector app and receipts', 'Dues, alerts and reports', 'Entries in your books'],
    levels: one('All lending tools'), available: true,
    api: [/^\/lending\//], pages: [/^\/app\/microfinance(\/|$)/],
    defaultMonthly: { standard: 499 },
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export type FeatureKey = (typeof FEATURES)[number]['key'];
export const featureByKey = (key: string) => FEATURES.find((f) => f.key === key);

/** A shop's features: feature key → level key. Only active ones are present. */
export type Entitlements = Record<string, string>;

/** True when the shop has the feature at `minLevel` or above (any level when not given). */
export function hasFeature(ent: Entitlements, key: string, minLevel?: string) {
  const level = ent[key];
  if (!level) return false;
  if (!minLevel) return true;
  const f = featureByKey(key);
  const order = f?.levels.map((l) => l.key) ?? [];
  return order.indexOf(level) >= order.indexOf(minLevel);
}

/** The feature that an API path (relative to /api/shop) needs, if any. Core paths return undefined. */
export const featureForApi = (path: string) => FEATURES.find((f) => f.api.some((re) => re.test(path)));
/** The feature that an app page needs, if any. */
export const featureForPage = (pathname: string) => FEATURES.find((f) => f.pages.some((re) => re.test(pathname)));

export const yearlyFromMonthly = (m: number) => m * 10; // two months free when paying for a year
