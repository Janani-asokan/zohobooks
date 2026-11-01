/*
 * Business templates: a one-click starter for a type of business. Picking one switches on the add-ons that trade
 * needs, adds the item fields and units it uses, sets the receipt paper and loads common items.
 *
 * Templates are plain data. Adding a business type means adding an entry here: no code changes. Applying a
 * template only adds; it never deletes or overwrites a shop's items, fields, units or features.
 *
 * GST rates on the sample items are the usual rates at release; prices are examples to change on the first day.
 * Both are shown to the owner with that note, and must be checked with the shop's CA for their own goods.
 */

export type ItemFieldType = 'text' | 'number' | 'select';
export interface ItemField {
  key: string;
  label: string;
  type: ItemFieldType;
  options?: string[];
  /** Shown after a number, e.g. "g" or "%". */
  suffix?: string;
  help?: string;
}

/** A shop-level registration the trade needs, e.g. a drug licence number. */
export interface TradeDetail { key: string; label: string; help?: string }

export interface SampleItem {
  name: string;
  unit: string;
  hsn: string;
  gst: 0 | 3 | 5 | 18;
  price: number;
  category: string;
  /** Trade field values, by field key. */
  extra?: Record<string, string | number>;
  trackSerials?: boolean;
}

export interface BusinessTemplate {
  key: string;
  name: string;
  /** One line in the owner's words. */
  summary: string;
  /** The day-to-day problems this setup handles, shown before applying. */
  helps: string[];
  /** Add-on feature keys (shared/features.ts) a new shop of this type tries first. */
  features: string[];
  itemFields: ItemField[];
  units: string[];
  defaultUnit: string;
  tradeDetails: TradeDetail[];
  /** Receipt paper for the counter printer. */
  thermalPaper: '2in' | '3in';
  /** GST rate a new item starts with, when the trade has one usual rate (e.g. 0% for fresh vegetables). */
  defaultGst?: 0 | 3 | 5 | 18;
  /** New items track batches and expiry (medicines) by default. */
  trackBatches?: boolean;
  /** Prices change every day (vegetables, gold, steel): the Today's rates screen is offered. */
  dailyRates?: boolean;
  samples: SampleItem[];
}

const localName: ItemField = { key: 'localName', label: 'Name in local language', type: 'text', help: 'Printed with the name, e.g. தக்காளி or टमाटर' };

export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
  {
    key: 'general', name: 'General business',
    summary: 'Any shop or trade: GST invoices, customers, stock and reports.',
    helps: ['Standard GST tax invoice', 'Customers and dues', 'Stock with low-stock alerts'],
    features: ['quotes_orders', 'purchases'],
    itemFields: [], units: [], defaultUnit: 'pcs', tradeDetails: [], thermalPaper: '3in', samples: [],
  },
  {
    key: 'vegetables', name: 'Fruits & vegetables',
    summary: 'Sell by weight, change rates every morning, bill fast without barcodes.',
    helps: ['Rates change daily: update every price on one screen each morning', 'Sell by kg, gram, bunch, piece or dozen',
      'Loose items with no barcode: pick from names, with the local name shown', 'Regular hotels and caterers on credit (khata)',
      'Fresh produce has no GST, so bills are a bill of supply', 'Small 58mm receipts'],
    features: ['pos', 'purchases'],
    itemFields: [localName], units: ['kg', 'g', 'bunch', 'pcs', 'dozen'], defaultUnit: 'kg', tradeDetails: [], defaultGst: 0, thermalPaper: '2in', dailyRates: true,
    samples: [
      { name: 'Tomato', unit: 'kg', hsn: '0702', gst: 0, price: 30, category: 'Vegetables', extra: { localName: 'தக்காளி' } },
      { name: 'Onion', unit: 'kg', hsn: '0703', gst: 0, price: 40, category: 'Vegetables', extra: { localName: 'வெங்காயம்' } },
      { name: 'Potato', unit: 'kg', hsn: '0701', gst: 0, price: 35, category: 'Vegetables', extra: { localName: 'உருளைக்கிழங்கு' } },
      { name: 'Carrot', unit: 'kg', hsn: '0706', gst: 0, price: 50, category: 'Vegetables', extra: { localName: 'கேரட்' } },
      { name: 'Beans', unit: 'kg', hsn: '0708', gst: 0, price: 60, category: 'Vegetables', extra: { localName: 'பீன்ஸ்' } },
      { name: 'Brinjal', unit: 'kg', hsn: '0709', gst: 0, price: 40, category: 'Vegetables', extra: { localName: 'கத்தரிக்காய்' } },
      { name: 'Ladies finger', unit: 'kg', hsn: '0709', gst: 0, price: 50, category: 'Vegetables', extra: { localName: 'வெண்டைக்காய்' } },
      { name: 'Cabbage', unit: 'kg', hsn: '0704', gst: 0, price: 30, category: 'Vegetables', extra: { localName: 'முட்டைக்கோஸ்' } },
      { name: 'Cauliflower', unit: 'pcs', hsn: '0704', gst: 0, price: 40, category: 'Vegetables', extra: { localName: 'காலிஃபிளவர்' } },
      { name: 'Green chilli', unit: 'kg', hsn: '0709', gst: 0, price: 60, category: 'Vegetables', extra: { localName: 'பச்சை மிளகாய்' } },
      { name: 'Ginger', unit: 'kg', hsn: '0910', gst: 0, price: 120, category: 'Vegetables', extra: { localName: 'இஞ்சி' } },
      { name: 'Garlic', unit: 'kg', hsn: '0703', gst: 0, price: 160, category: 'Vegetables', extra: { localName: 'பூண்டு' } },
      { name: 'Beetroot', unit: 'kg', hsn: '0706', gst: 0, price: 40, category: 'Vegetables', extra: { localName: 'பீட்ரூட்' } },
      { name: 'Cucumber', unit: 'kg', hsn: '0707', gst: 0, price: 40, category: 'Vegetables', extra: { localName: 'வெள்ளரிக்காய்' } },
      { name: 'Coriander leaves', unit: 'bunch', hsn: '0709', gst: 0, price: 10, category: 'Greens', extra: { localName: 'கொத்தமல்லி' } },
      { name: 'Curry leaves', unit: 'bunch', hsn: '0709', gst: 0, price: 5, category: 'Greens', extra: { localName: 'கறிவேப்பிலை' } },
      { name: 'Banana', unit: 'dozen', hsn: '0803', gst: 0, price: 50, category: 'Fruits', extra: { localName: 'வாழைப்பழம்' } },
      { name: 'Apple', unit: 'kg', hsn: '0808', gst: 0, price: 180, category: 'Fruits', extra: { localName: 'ஆப்பிள்' } },
      { name: 'Coconut', unit: 'pcs', hsn: '0801', gst: 0, price: 30, category: 'Fruits', extra: { localName: 'தேங்காய்' } },
    ],
  },
  {
    key: 'kirana', name: 'Kirana / general store',
    summary: 'Quick billing, credit for regulars (khata) and loose items by weight.',
    helps: ['Loose rice, dal and atta by weight', 'Credit book for regular customers', 'Fast counter billing on a small printer'],
    features: ['pos', 'purchases'],
    itemFields: [localName], units: ['kg', 'g', 'ltr', 'pcs', 'pack'], defaultUnit: 'pcs', tradeDetails: [], thermalPaper: '2in',
    samples: [
      { name: 'Rice (loose)', unit: 'kg', hsn: '1006', gst: 0, price: 55, category: 'Grains' },
      { name: 'Toor dal (loose)', unit: 'kg', hsn: '0713', gst: 0, price: 140, category: 'Pulses' },
      { name: 'Wheat atta (loose)', unit: 'kg', hsn: '1101', gst: 0, price: 45, category: 'Grains' },
      { name: 'Sugar', unit: 'kg', hsn: '1701', gst: 5, price: 45, category: 'Essentials' },
      { name: 'Salt 1 kg', unit: 'pack', hsn: '2501', gst: 0, price: 28, category: 'Essentials' },
      { name: 'Sunflower oil 1 L', unit: 'pack', hsn: '1512', gst: 5, price: 150, category: 'Oils' },
      { name: 'Tea powder 250 g', unit: 'pack', hsn: '0902', gst: 5, price: 140, category: 'Beverages' },
    ],
  },
  {
    key: 'supermarket', name: 'Supermarket',
    summary: 'Barcode billing at several counters, weighing-scale items and MRP savings on the bill.',
    helps: ['Scan barcodes at the counter', 'Loose items weighed on the scale', '“You saved ₹X” against MRP on the receipt', 'Stock across godowns'],
    features: ['pos', 'purchases', 'inventory_plus'],
    itemFields: [], units: ['kg', 'g', 'ltr', 'ml', 'pcs', 'pack'], defaultUnit: 'pcs', tradeDetails: [], thermalPaper: '3in',
    samples: [
      { name: 'Basmati rice 5 kg', unit: 'pack', hsn: '1006', gst: 5, price: 650, category: 'Grains' },
      { name: 'Sunflower oil 1 L', unit: 'pack', hsn: '1512', gst: 5, price: 150, category: 'Oils' },
      { name: 'Sugar 1 kg', unit: 'pack', hsn: '1701', gst: 5, price: 48, category: 'Essentials' },
      { name: 'Tea powder 500 g', unit: 'pack', hsn: '0902', gst: 5, price: 270, category: 'Beverages' },
    ],
  },
  {
    key: 'pharmacy', name: 'Medical store / pharmacy',
    summary: 'Batch and expiry on every medicine, schedule drugs and your drug licence on the bill.',
    helps: ['Batch and expiry tracked, with alerts before medicines expire', 'Schedule H, H1 and X marked on each medicine', 'Manufacturer and composition on each item', 'Drug licence number kept with your profile'],
    features: ['pos', 'purchases', 'inventory_plus'],
    itemFields: [
      { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { key: 'composition', label: 'Composition / salt', type: 'text', help: 'e.g. Paracetamol 500 mg' },
      { key: 'schedule', label: 'Schedule', type: 'select', options: ['None', 'H', 'H1', 'X'] },
      { key: 'pack', label: 'Pack', type: 'text', help: 'e.g. 10 tablets' },
    ],
    units: ['strip', 'pcs', 'bottle', 'box', 'tube'], defaultUnit: 'strip',
    tradeDetails: [{ key: 'drugLicence', label: 'Drug licence number(s)', help: 'Form 20 / 21' }],
    thermalPaper: '3in', trackBatches: true, samples: [],
  },
  {
    key: 'jewellery', name: 'Gold & silver jewellery',
    summary: 'Purity, gross and net weight, making charge, wastage and HUID on every piece.',
    helps: ['Purity and weights on each piece', 'Making charge and wastage', 'HUID for hallmarked jewellery', 'Update today’s gold and silver rate on one screen', '3% GST'],
    features: ['purchases', 'quotes_orders'],
    itemFields: [
      { key: 'metal', label: 'Metal', type: 'select', options: ['Gold', 'Silver', 'Platinum'] },
      { key: 'purity', label: 'Purity', type: 'select', options: ['24K', '22K', '18K', '14K', '925 silver', '999 silver'] },
      { key: 'grossWeight', label: 'Gross weight', type: 'number', suffix: 'g' },
      { key: 'stoneWeight', label: 'Stone weight', type: 'number', suffix: 'g' },
      { key: 'netWeight', label: 'Net weight', type: 'number', suffix: 'g' },
      { key: 'makingCharge', label: 'Making charge', type: 'number', suffix: '%' },
      { key: 'wastage', label: 'Wastage', type: 'number', suffix: '%' },
      { key: 'huid', label: 'HUID', type: 'text', help: '6-character hallmark ID' },
    ],
    units: ['g', 'pcs'], defaultUnit: 'g',
    tradeDetails: [{ key: 'bisRegistration', label: 'BIS hallmarking registration number' }],
    defaultGst: 3, thermalPaper: '3in', dailyRates: true, samples: [],
  },
  {
    key: 'steel', name: 'Steel & TMT bars',
    summary: 'Grade, size and weight on each item, rate per kg or ton, and transport on the bill.',
    helps: ['Grade, diameter and length on each bar', 'Sell by kg, ton, piece or bundle', 'Quotes for contractors before the order', 'Update today’s steel rate on one screen'],
    features: ['purchases', 'quotes_orders', 'inventory_plus'],
    itemFields: [
      { key: 'grade', label: 'Grade', type: 'select', options: ['Fe415', 'Fe500', 'Fe500D', 'Fe550', 'Fe550D'] },
      { key: 'diameter', label: 'Diameter', type: 'number', suffix: 'mm' },
      { key: 'length', label: 'Length', type: 'number', suffix: 'm' },
      { key: 'weightPerPiece', label: 'Weight per piece', type: 'number', suffix: 'kg' },
    ],
    units: ['kg', 'ton', 'pcs', 'bundle'], defaultUnit: 'kg', tradeDetails: [], defaultGst: 18, thermalPaper: '3in', dailyRates: true,
    samples: [
      { name: 'TMT bar Fe500D 8 mm', unit: 'kg', hsn: '7214', gst: 18, price: 62, category: 'TMT bars', extra: { grade: 'Fe500D', diameter: 8, length: 12 } },
      { name: 'TMT bar Fe500D 10 mm', unit: 'kg', hsn: '7214', gst: 18, price: 61, category: 'TMT bars', extra: { grade: 'Fe500D', diameter: 10, length: 12 } },
      { name: 'TMT bar Fe500D 12 mm', unit: 'kg', hsn: '7214', gst: 18, price: 60, category: 'TMT bars', extra: { grade: 'Fe500D', diameter: 12, length: 12 } },
      { name: 'Binding wire', unit: 'kg', hsn: '7217', gst: 18, price: 80, category: 'Wire' },
    ],
  },
  {
    key: 'hardware', name: 'Hardware & sanitaryware',
    summary: 'A big catalogue in many units, quotes for contractors and credit for regular buyers.',
    helps: ['Sell the same item by piece, box or metre', 'Size and material on each item', 'Quotes and credit for contractors'],
    features: ['purchases', 'quotes_orders', 'inventory_plus'],
    itemFields: [
      { key: 'size', label: 'Size', type: 'text', help: 'e.g. 1 inch, 6 mm' },
      { key: 'material', label: 'Material', type: 'text', help: 'e.g. PVC, brass, MS' },
    ],
    units: ['pcs', 'box', 'mtr', 'kg', 'set', 'ltr'], defaultUnit: 'pcs', tradeDetails: [], defaultGst: 18, thermalPaper: '3in',
    samples: [
      { name: 'PVC pipe 1 inch (3 m length)', unit: 'pcs', hsn: '3917', gst: 18, price: 220, category: 'Plumbing', extra: { size: '1 inch', material: 'PVC' } },
      { name: 'Brass wall tap', unit: 'pcs', hsn: '8481', gst: 18, price: 450, category: 'Plumbing', extra: { material: 'Brass' } },
      { name: 'Claw hammer 500 g', unit: 'pcs', hsn: '8205', gst: 18, price: 300, category: 'Tools' },
      { name: 'Screwdriver set', unit: 'set', hsn: '8205', gst: 18, price: 350, category: 'Tools' },
    ],
  },
  {
    key: 'garments', name: 'Garments & readymade',
    summary: 'Size and colour for every style, barcode tags and an exchange policy on the bill.',
    helps: ['Size × colour for each style', 'Barcode tags for every piece', 'Exchange policy on the receipt', 'GST by price: 5% up to ₹2,500 a piece, 18% above'],
    features: ['pos', 'purchases', 'inventory_plus'],
    itemFields: [
      { key: 'fabric', label: 'Fabric', type: 'text', help: 'e.g. Cotton, Linen' },
      { key: 'fit', label: 'Fit', type: 'select', options: ['Regular', 'Slim', 'Relaxed'] },
    ],
    units: ['pcs', 'set', 'pair'], defaultUnit: 'pcs', tradeDetails: [], defaultGst: 5, thermalPaper: '3in',
    samples: [
      { name: 'Cotton shirt', unit: 'pcs', hsn: '6205', gst: 5, price: 799, category: 'Men', extra: { fabric: 'Cotton', fit: 'Regular' } },
      { name: 'Round-neck T-shirt', unit: 'pcs', hsn: '6109', gst: 5, price: 399, category: 'Men', extra: { fabric: 'Cotton', fit: 'Regular' } },
      { name: 'Denim jeans', unit: 'pcs', hsn: '6203', gst: 5, price: 1299, category: 'Men', extra: { fabric: 'Denim', fit: 'Slim' } },
    ],
  },
  {
    key: 'mobiles', name: 'Mobile phones & accessories',
    summary: 'IMEI on every phone, warranty dates and fast accessory billing.',
    helps: ['IMEI / serial number recorded on every phone sold', 'Warranty period on each item', 'Accessories billed fast at the counter'],
    features: ['pos', 'purchases'],
    itemFields: [
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'warrantyMonths', label: 'Warranty', type: 'number', suffix: 'months' },
    ],
    units: ['pcs'], defaultUnit: 'pcs', tradeDetails: [], defaultGst: 18, thermalPaper: '3in',
    samples: [
      { name: 'Smartphone (sample model)', unit: 'pcs', hsn: '8517', gst: 18, price: 14999, category: 'Phones', extra: { warrantyMonths: 12 }, trackSerials: true },
      { name: 'Charger 25 W USB-C', unit: 'pcs', hsn: '8504', gst: 18, price: 999, category: 'Accessories', extra: { warrantyMonths: 6 } },
      { name: 'Wired earphones', unit: 'pcs', hsn: '8518', gst: 18, price: 499, category: 'Accessories', extra: { warrantyMonths: 6 } },
      { name: 'Tempered glass', unit: 'pcs', hsn: '7007', gst: 18, price: 199, category: 'Accessories' },
    ],
  },
];

export const templateByKey = (key: string) => BUSINESS_TEMPLATES.find((t) => t.key === key);

/** Checks and cleans an item's trade field values against the shop's field definitions. Unknown keys are dropped. */
export function cleanExtra(fields: ItemField[], extra: Record<string, unknown> | undefined): { value: Record<string, string | number>; errors: Record<string, string> } {
  const value: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = extra?.[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n) || n < 0) errors[f.key] = `${f.label} must be a number`;
      else value[f.key] = Math.round(n * 1000) / 1000;
    } else {
      const s = String(v).trim().slice(0, 120);
      if (f.type === 'select' && f.options && !f.options.includes(s)) errors[f.key] = `Choose a ${f.label.toLowerCase()} from the list`;
      else if (s) value[f.key] = s;
    }
  }
  return { value, errors };
}
