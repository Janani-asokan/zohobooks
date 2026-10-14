import type { Customer, Database, Invoice, Item, LineItem, Shop, Tenant } from './types';
import { addDays, toISO, uid } from './format';
import { fyLabel } from './fy';

const today = new Date();
const iso = (offsetDays: number) => toISO(new Date(today.getTime() + offsetDays * 86400000));

export const DEFAULT_TAX_SLABS = [
  { id: 'tax_0', name: 'GST Exempt', rate: 0, active: true },
  { id: 'tax_5', name: 'GST 5%', rate: 5, active: true },
  { id: 'tax_12', name: 'GST 12%', rate: 12, active: true },
  { id: 'tax_18', name: 'GST 18%', rate: 18, active: true },
  { id: 'tax_28', name: 'GST 28%', rate: 28, active: true },
];

export function emptyTenant(shop: Pick<Shop, 'shopName' | 'email' | 'phone' | 'city'>): Tenant {
  const branchId = uid('br_');
  return {
    org: {
      companyName: shop.shopName,
      legalName: shop.shopName,
      gstin: '',
      email: shop.email,
      phone: shop.phone,
      address: shop.city,
      state: 'Tamil Nadu',
      logo: '',
      invoiceFooter: 'Thank you for your business!',
    },
    items: [],
    customers: [],
    salesOrders: [],
    invoices: [],
    vendors: [],
    bills: [],
    bankAccounts: [{ id: uid('acc_'), name: 'Petty Cash', bank: 'Cash in hand', accountNo: '—', type: 'Cash', openingBalance: 0 }],
    transactions: [],
    staff: [],
    branches: [{ id: branchId, name: 'Head Office', address: shop.city, phone: shop.phone, isPrimary: true }],
    counters: { customer: 1000, salesOrder: 0, bill: 0, invoice: {} },
  };
}

function demoTenant(): Tenant {
  const t = emptyTenant({ shopName: 'Aravind Computer Store', email: 'owner@shop.com', phone: '+91 98400 12345', city: 'Chennai' });
  t.org = {
    ...t.org,
    legalName: 'Aravind Computer Store Pvt. Ltd.',
    gstin: '33AABCA1234F1Z5',
    address: '42, Anna Salai, Teynampet\nChennai, Tamil Nadu 600018',
    state: 'Tamil Nadu',
  };
  t.branches.push({ id: 'br_vel', name: 'Velachery Branch', address: '12, 100 Feet Road, Velachery, Chennai', phone: '+91 98400 54321', isPrimary: false });

  const mk = (p: Partial<Item> & Pick<Item, 'name' | 'cost' | 'sp1' | 'sp2' | 'sp3' | 'taxSlabId'>): Item => ({
    id: uid('it_'),
    type: 'Goods',
    sku: '',
    barcode: '',
    unit: 'pcs',
    hsn: '',
    stock: 0,
    description: '',
    createdAt: iso(-60),
    ...p,
  });
  t.items = [
    mk({ name: 'Logitech M331 Silent Mouse', sku: 'LOG-M331', barcode: '5099206066861', hsn: '8471', cost: 850, sp1: 1199, sp2: 1099, sp3: 1149, taxSlabId: 'tax_18', stock: 42 }),
    mk({ name: 'HP 680 Ink Cartridge (Black)', sku: 'HP-680B', barcode: '0888793164524', hsn: '8443', cost: 620, sp1: 849, sp2: 799, sp3: 829, taxSlabId: 'tax_18', stock: 65 }),
    mk({ name: 'SanDisk 64GB Pen Drive', sku: 'SD-64U3', barcode: '0619659161323', hsn: '8523', cost: 390, sp1: 599, sp2: 549, sp3: 569, taxSlabId: 'tax_18', stock: 120 }),
    mk({ name: 'A4 Copier Paper (500 sheets)', sku: 'PAP-A4-75', barcode: '8901057510011', hsn: '4802', cost: 240, sp1: 320, sp2: 295, sp3: 310, taxSlabId: 'tax_12', stock: 300, unit: 'ream' }),
    mk({ name: 'Dell 24" FHD Monitor', sku: 'DEL-E2423', barcode: '5397184654321', hsn: '8528', cost: 9800, sp1: 12499, sp2: 11899, sp3: 12199, taxSlabId: 'tax_28', stock: 8 }),
    mk({ name: 'USB-C Charging Cable 1m', sku: 'CAB-UC1M', barcode: '8906000123457', hsn: '8544', cost: 90, sp1: 199, sp2: 169, sp3: 179, taxSlabId: 'tax_5', stock: 210 }),
    mk({ type: 'Services', name: 'Laptop Servicing (General)', sku: 'SRV-LAP', hsn: '9987', unit: 'job', cost: 300, sp1: 799, sp2: 699, sp3: 749, taxSlabId: 'tax_18' }),
    mk({ type: 'Services', name: 'OS Installation & Setup', sku: 'SRV-OS', hsn: '9987', unit: 'job', cost: 150, sp1: 499, sp2: 449, sp3: 479, taxSlabId: 'tax_18' }),
    mk({ type: 'Services', name: 'Annual Maintenance Contract', sku: 'SRV-AMC', hsn: '9987', unit: 'year', cost: 2500, sp1: 5999, sp2: 5499, sp3: 5799, taxSlabId: 'tax_18' }),
  ];

  const customers: Array<Omit<Customer, 'id' | 'customId' | 'createdAt'>> = [
    { type: 'Business', name: 'Priya Raman', companyName: 'Nila Textiles', gstin: '33AAFCN5678K1Z2', email: 'accounts@nilatextiles.in', phone: '+91 94440 11223', state: 'Tamil Nadu', address: 'T. Nagar, Chennai', tier: 'SP2' },
    { type: 'Individual', name: 'Karthik Subramanian', companyName: '', gstin: '', email: 'karthik.s@gmail.com', phone: '+91 98765 43210', state: 'Tamil Nadu', address: 'Adyar, Chennai', tier: 'SP1' },
    { type: 'Business', name: 'Rahul Menon', companyName: 'Menon Associates', gstin: '32AAKFM4321P1Z9', email: 'rahul@menonassoc.com', phone: '+91 90480 77881', state: 'Kerala', address: 'MG Road, Kochi', tier: 'SP1' },
    { type: 'Individual', name: 'Divya Lakshmi', companyName: '', gstin: '', email: 'divya.l@outlook.com', phone: '+91 99620 33445', state: 'Tamil Nadu', address: 'Velachery, Chennai', tier: 'SP3' },
    { type: 'Business', name: 'Sanjay Gupta', companyName: 'BrightPath Academy', gstin: '33AAGCB9988L1Z1', email: 'admin@brightpath.edu.in', phone: '+91 97910 66554', state: 'Tamil Nadu', address: 'Anna Nagar, Chennai', tier: 'SP2' },
  ];
  t.counters.customer = 1581;
  t.customers = customers.map((c, i) => {
    t.counters.customer += 1;
    return { ...c, id: uid('cu_'), customId: `ACS-${t.counters.customer}`, createdAt: iso(-50 + i * 6) };
  });

  const line = (item: Item, qty: number, tier: Customer['tier']): LineItem => ({
    id: uid('ln_'),
    itemId: item.id,
    name: item.name,
    qty,
    tier,
    rate: tier === 'SP1' ? item.sp1 : tier === 'SP2' ? item.sp2 : item.sp3,
    taxRate: Number(item.taxSlabId.replace('tax_', '')),
    discount: 0,
  });

  const plan: Array<[number, number[], number[], Invoice['status']]> = [
    [0, [0, 3], [5, 10], 'Paid'],
    [1, [6], [1], 'Paid'],
    [2, [4, 0], [2, 2], 'Unpaid'],
    [4, [3, 2], [20, 15], 'Paid'],
    [3, [7, 5], [1, 2], 'Unpaid'],
    [0, [8], [1], 'Paid'],
    [1, [2, 5], [2, 3], 'Unpaid'],
  ];
  t.invoices = plan.map(([ci, its, qtys, status], i) => {
    const c = t.customers[ci]!;
    const date = iso(-165 + i * 26);
    const fy = fyLabel(date);
    const n = (t.counters.invoice[fy] = (t.counters.invoice[fy] ?? 0) + 1);
    return {
      id: uid('inv_'),
      number: `INV-${fy}-${String(n).padStart(4, '0')}`,
      fy,
      customerId: c.id,
      date,
      dueDate: addDays(date, 15),
      lines: its.map((ix, k) => line(t.items[ix]!, qtys[k]!, c.tier)),
      withGst: c.type === 'Business' || i % 2 === 0,
      status,
      notes: '',
      branchId: t.branches[i % 2]!.id,
    };
  });

  t.salesOrders = [
    { id: uid('so_'), number: 'SO-0001', customerId: t.customers[4]!.id, date: iso(-6), expiryDate: iso(24), lines: [line(t.items[4]!, 5, 'SP2')], withGst: true, status: 'Accepted', notes: 'Lab upgrade' },
    { id: uid('so_'), number: 'SO-0002', customerId: t.customers[2]!.id, date: iso(-3), expiryDate: iso(27), lines: [line(t.items[8]!, 1, 'SP1')], withGst: true, status: 'Sent', notes: '' },
    { id: uid('so_'), number: 'SO-0003', customerId: t.customers[1]!.id, date: iso(-1), expiryDate: iso(29), lines: [line(t.items[0]!, 2, 'SP1'), line(t.items[5]!, 4, 'SP1')], withGst: false, status: 'Draft', notes: '' },
  ];
  t.counters.salesOrder = 3;

  t.vendors = [
    { id: 'v1', name: 'Redington India Ltd.', gstin: '33AABCR1234D1Z8', phone: '+91 44 4224 3353', email: 'orders@redington.in' },
    { id: 'v2', name: 'Ingram Micro India', gstin: '27AAACI2345E1Z3', phone: '+91 22 6888 8888', email: 'sales@ingrammicro.in' },
    { id: 'v3', name: 'Chennai Paper Mart', gstin: '33AAFFC7788Q1Z6', phone: '+91 98410 22110', email: 'cpm@papermart.in' },
  ];
  t.bills = [
    { id: uid('bl_'), number: 'BILL-0001', vendorId: 'v1', date: iso(-35), dueDate: iso(-5), amount: 98000, status: 'Paid', description: 'Monitors ×10' },
    { id: uid('bl_'), number: 'BILL-0002', vendorId: 'v2', date: iso(-20), dueDate: iso(10), amount: 46500, status: 'Open', description: 'Peripherals restock' },
    { id: uid('bl_'), number: 'BILL-0003', vendorId: 'v3', date: iso(-8), dueDate: iso(22), amount: 24000, status: 'Open', description: 'A4 paper ×100 reams' },
  ];
  t.counters.bill = 3;

  t.bankAccounts = [
    { id: 'acc_hdfc', name: 'HDFC Current A/c', bank: 'HDFC Bank', accountNo: 'XXXX XXXX 4821', type: 'Bank', openingBalance: 250000 },
    { id: 'acc_cash', name: 'Petty Cash', bank: 'Cash in hand', accountNo: '—', type: 'Cash', openingBalance: 15000 },
  ];
  t.transactions = [
    { id: uid('tx_'), accountId: 'acc_hdfc', date: iso(-34), description: 'Payment to Redington India', amount: -98000, category: 'Vendor Payment' },
    { id: uid('tx_'), accountId: 'acc_hdfc', date: iso(-30), description: 'Nila Textiles — INV payment', amount: 7322, category: 'Customer Receipt' },
    { id: uid('tx_'), accountId: 'acc_hdfc', date: iso(-25), description: 'Shop rent — October', amount: -35000, category: 'Rent' },
    { id: uid('tx_'), accountId: 'acc_cash', date: iso(-12), description: 'Counter sales', amount: 8450, category: 'Sales' },
    { id: uid('tx_'), accountId: 'acc_hdfc', date: iso(-9), description: 'Electricity bill', amount: -6240, category: 'Utilities' },
    { id: uid('tx_'), accountId: 'acc_cash', date: iso(-4), description: 'Tea & refreshments', amount: -620, category: 'Office Expense' },
  ];

  t.staff = [
    { id: uid('st_'), name: 'Meena Krishnan', email: 'meena@aravindstore.in', role: 'Manager', branchId: t.branches[0]!.id, active: true },
    { id: uid('st_'), name: 'Vignesh R', email: 'vignesh@aravindstore.in', role: 'Sales Staff', branchId: 'br_vel', active: true },
    { id: uid('st_'), name: 'Anitha S', email: 'anitha@aravindstore.in', role: 'Accountant', branchId: t.branches[0]!.id, active: true },
  ];
  return t;
}

const shopRows: Array<[string, string, string, string, Shop['plan'], number, number, boolean]> = [
  // shopName, owner, email, city, plan, startOffsetDays, fee, active
  ['Aravind Computer Store', 'Aravind Kumar', 'owner@shop.com', 'Chennai', '1 Year', -120, 11999, true],
  ['Sri Balaji Textiles', 'Balaji Venkatesh', 'balaji@sbtextiles.in', 'Coimbatore', '1 Year', -350, 11999, true],
  ['Green Leaf Organics', 'Fatima Sheikh', 'fatima@greenleaf.co.in', 'Bengaluru', '2 Years', -200, 21999, true],
  ['Metro Hardware Hub', 'Joseph Mathew', 'joseph@metrohw.in', 'Kochi', '1 Year', -358, 11999, true],
  ['Lotus Pharmacy', 'Dr. Kavitha Rao', 'kavitha@lotuspharma.in', 'Hyderabad', '3 Years', -400, 29999, true],
  ['Urban Threads Boutique', 'Neha Kapoor', 'neha@urbanthreads.in', 'Pune', 'Trial', -10, 0, true],
  ['Sai Mobile World', 'Sai Prasad', 'sai@saimobile.in', 'Vijayawada', '1 Year', -12, 11999, true],
  ['Annapoorna Sweets', 'Lakshmi Narayanan', 'contact@annapoorna.in', 'Madurai', '1 Year', -390, 11999, false],
  ['BlueWave Electronics', 'Arjun Reddy', 'arjun@bluewave.in', 'Visakhapatnam', '1 Year', -5, 11999, true],
  ['Classic Furniture Co.', 'Harpreet Singh', 'harpreet@classicfurn.in', 'Ludhiana', '2 Years', -600, 21999, true],
  ['Coastal Fresh Seafood', 'Ramesh Pai', 'ramesh@coastalfresh.in', 'Mangaluru', '1 Year', -2, 11999, true],
  ['Shree Ganesh Stationers', 'Ganesh Iyer', 'ganesh@sgstationers.in', 'Mumbai', '1 Year', -340, 11999, true],
];

export const PLAN_DAYS: Record<Shop['plan'], number> = { Trial: 14, '1 Year': 365, '2 Years': 730, '3 Years': 1095 };

export function seedDatabase(): Database {
  const shops: Shop[] = shopRows.map(([shopName, ownerName, email, city, plan, start, fee, active], i) => {
    const licenseStart = iso(start);
    return {
      id: i === 0 ? 'shop_demo' : uid('shop_'),
      shopName,
      ownerName,
      email,
      password: i === 0 ? 'owner123' : 'welcome123',
      phone: `+91 9${String(840012345 + i * 7919123).slice(0, 4)} ${String(10000 + i * 4111).slice(0, 5)}`,
      city,
      plan,
      licenseStart,
      licenseEnd: addDays(licenseStart, PLAN_DAYS[plan]),
      subscriptionFee: fee,
      active,
      createdAt: licenseStart,
    };
  });
  const tenants: Record<string, Tenant> = {};
  for (const s of shops) tenants[s.id] = s.id === 'shop_demo' ? demoTenant() : emptyTenant(s);
  return {
    version: 1,
    superAdmin: { name: 'Platform Admin', email: 'admin@ledgerly.in', password: 'admin123' },
    platform: { customerIdPrefix: 'ACS', fyStartMonth: 4, autoResetInvoiceNumbering: true, taxSlabs: DEFAULT_TAX_SLABS },
    shops,
    tenants,
  };
}
