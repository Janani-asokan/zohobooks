/* Print settings for thermal receipts and barcode labels — shared by the API (validation, defaults) and the UI. */

export type ThermalTheme = 'compact' | 'advanced' | 'simple' | 'classic';
export type PaperSize = '2in' | '3in';

export interface ThermalSettings {
  theme: ThermalTheme;
  paper: PaperSize;
  showLogo: boolean;
  showPartyBalance: boolean;
  showItemDescription: boolean;
  showTime: boolean;
  showGstin: boolean;
  showHsn: boolean;
  showTaxBreakup: boolean;
  showSavings: boolean;
  showUpiQr: boolean;
  footer: string;
}

export const BARCODE_FIELDS = ['businessName', 'itemCode', 'itemName', 'mrp', 'sellingPrice', 'category', 'brand', 'unit'] as const;
export type BarcodeFieldKey = (typeof BARCODE_FIELDS)[number];
export const BARCODE_FIELD_LABEL: Record<BarcodeFieldKey, string> = {
  businessName: 'Business Name', itemCode: 'Item Code', itemName: 'Item Name', mrp: 'MRP', sellingPrice: 'Selling Price', category: 'Category', brand: 'Brand', unit: 'Unit',
};
export const MAX_BARCODE_FIELDS = 6;

export interface BarcodeField { key: BarcodeFieldKey; enabled: boolean; size: number; bold: boolean }

export type PrinterType = 'a4' | 'label';
export interface LabelSize { id: string; printer: PrinterType; w: number; h: number; perRow: number; rowsPerPage?: number; label: string }

/** Common label stock. Label-printer sizes print one row per "page"; A4 sizes fill a sheet. */
export const LABEL_SIZES: LabelSize[] = [
  { id: '50x25-2', printer: 'label', w: 50, h: 25, perRow: 2, label: '50 x 25mm (2 Labels/Row)' },
  { id: '50x25-1', printer: 'label', w: 50, h: 25, perRow: 1, label: '50 x 25mm (1 Label/Row)' },
  { id: '38x25-2', printer: 'label', w: 38, h: 25, perRow: 2, label: '38 x 25mm (2 Labels/Row)' },
  { id: '35x22-3', printer: 'label', w: 35, h: 22, perRow: 3, label: '35 x 22mm (3 Labels/Row)' },
  { id: '75x50-1', printer: 'label', w: 75, h: 50, perRow: 1, label: '75 x 50mm (1 Label/Row)' },
  { id: '100x50-1', printer: 'label', w: 100, h: 50, perRow: 1, label: '100 x 50mm (1 Label/Row)' },
  { id: 'a4-65', printer: 'a4', w: 38, h: 21, perRow: 5, rowsPerPage: 13, label: '38 x 21mm (65 per A4 sheet)' },
  { id: 'a4-40', printer: 'a4', w: 48, h: 25, perRow: 4, rowsPerPage: 10, label: '48 x 25mm (40 per A4 sheet)' },
  { id: 'a4-24', printer: 'a4', w: 63, h: 34, perRow: 3, rowsPerPage: 8, label: '63 x 34mm (24 per A4 sheet)' },
  { id: 'a4-12', printer: 'a4', w: 99, h: 46, perRow: 2, rowsPerPage: 6, label: '99 x 46mm (12 per A4 sheet)' },
];
export const labelSize = (id: string) => LABEL_SIZES.find((l) => l.id === id) ?? LABEL_SIZES[0]!;

export interface BarcodeSettings { printer: PrinterType; labelSize: string; fields: BarcodeField[]; barcodeHeight: number }

/* ---------------- A4 / A5 tax invoice ---------------- */
export type InvoiceTemplate = 'standard' | 'modern' | 'compact';
export type InvoicePaper = 'a4' | 'a5';
export const INVOICE_FIELDS = ['logo', 'hsn', 'unit', 'discount', 'taxBreakup', 'amountInWords', 'bankDetails', 'upiQr', 'terms', 'notes', 'signature', 'shipTo', 'placeOfSupply', 'eInvoice'] as const;
export type InvoiceFieldKey = (typeof INVOICE_FIELDS)[number];
export const INVOICE_FIELD_LABEL: Record<InvoiceFieldKey, string> = {
  logo: 'Logo', hsn: 'HSN / SAC column', unit: 'Unit column', discount: 'Discount column', taxBreakup: 'Tax breakup by rate', amountInWords: 'Amount in words',
  bankDetails: 'Bank details', upiQr: 'UPI QR code', terms: 'Terms and conditions', notes: 'Customer notes', signature: 'Authorised signatory',
  shipTo: 'Ship-to address', placeOfSupply: 'Place of supply', eInvoice: 'E-invoice IRN and QR',
};
export interface InvoicePrintSettings {
  template: InvoiceTemplate;
  paper: InvoicePaper;
  /** Hex colour used for the title and rules. Everything else prints in black for B/W printers. */
  color: string;
  fields: Record<InvoiceFieldKey, boolean>;
  terms: string;
  signatoryLabel: string;
  /** Signature or stamp image (data URL). */
  signatureImage: string;
}

export interface PrintSettings { thermal: ThermalSettings; barcode: BarcodeSettings; invoice: InvoicePrintSettings }

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  thermal: {
    theme: 'compact', paper: '3in', showLogo: true, showPartyBalance: false, showItemDescription: true, showTime: false,
    showGstin: true, showHsn: false, showTaxBreakup: true, showSavings: true, showUpiQr: false, footer: '',
  },
  barcode: {
    printer: 'label',
    labelSize: '50x25-2',
    barcodeHeight: 40,
    fields: [
      { key: 'businessName', enabled: true, size: 22, bold: true },
      { key: 'itemCode', enabled: true, size: 22, bold: false },
      { key: 'itemName', enabled: true, size: 22, bold: false },
      { key: 'mrp', enabled: true, size: 22, bold: false },
      { key: 'sellingPrice', enabled: true, size: 22, bold: false },
      { key: 'category', enabled: false, size: 18, bold: false },
      { key: 'brand', enabled: false, size: 18, bold: false },
      { key: 'unit', enabled: false, size: 18, bold: false },
    ],
  },
  invoice: {
    template: 'standard', paper: 'a4', color: '#1F3A5F',
    fields: Object.fromEntries(INVOICE_FIELDS.map((k) => [k, true])) as Record<InvoiceFieldKey, boolean>,
    terms: 'Goods once sold will not be taken back.\nInterest at 18% p.a. is charged on payments received after the due date.\nSubject to local jurisdiction.',
    signatoryLabel: 'Authorised Signatory',
    signatureImage: '',
  },
};

/** Fill in anything missing (older saved settings, new fields) from the defaults. */
export function withPrintDefaults(saved: unknown): PrintSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<PrintSettings>;
  const d = DEFAULT_PRINT_SETTINGS;
  const savedFields = Array.isArray(s.barcode?.fields) ? s.barcode!.fields : [];
  const fields = [
    ...savedFields.filter((f) => BARCODE_FIELDS.includes(f.key)),
    ...d.barcode.fields.filter((f) => !savedFields.some((x) => x.key === f.key)),
  ];
  return {
    thermal: { ...d.thermal, ...(s.thermal ?? {}) },
    barcode: { ...d.barcode, ...(s.barcode ?? {}), fields },
    invoice: { ...d.invoice, ...(s.invoice ?? {}), fields: { ...d.invoice.fields, ...(s.invoice?.fields ?? {}) } },
  };
}

/** Printable width of the paper roll in mm (2″ = 58mm roll, 3″ = 80mm roll). */
export const paperWidthMm = (p: PaperSize) => (p === '2in' ? 48 : 72);

/** Font size setting → millimetres on the label (22 ≈ 2.9mm ≈ 8pt). */
export const labelFontMm = (size: number) => Math.round(size * 0.13 * 100) / 100;
