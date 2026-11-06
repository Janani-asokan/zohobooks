import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { GeneratorSettings } from '../../../shared/barcode';
import type { Item } from '@/api/types';
import {
  PRINTER_PRESETS, STOCK_PRESETS, autoTemplate, type ImposeOptions, type JobLine, type LabelData, type LabelTemplateBody, type PrinterSettings, type StockGeometry,
} from '../../../shared/labelEngine';
import type { BarcodeSettings } from '../../../shared/printSettings';

export interface LabelStockRow { id: string; name: string; geometry: StockGeometry; preset?: boolean }
export interface PrinterRow { id: string; name: string; settings: PrinterSettings; branchId: string | null; branchName?: string | null; canRestore: boolean; preset?: boolean }
export interface TemplateRow { id: string; name: string; draft: LabelTemplateBody; version: number; isDefault: boolean; categories: string[]; published: LabelTemplateBody | null; dirty: boolean; updatedAt: string }
export interface LabelSetup { stocks: LabelStockRow[]; printers: PrinterRow[]; templates: TemplateRow[]; generator: GeneratorSettings; can: { manage: boolean; admin: boolean } }
export interface JobRow {
  id: string; source: { type: string; id: string | null; label: string }; templateId: string | null; templateVersion: number; templateName: string | null;
  template: LabelTemplateBody; stock: StockGeometry; printerId: string | null; printerName: string | null; printer: PrinterSettings; options: Partial<ImposeOptions> & Record<string, unknown>;
  status: 'ready' | 'sending' | 'sent' | 'printed' | 'partial' | 'failed'; total: number; sent: number; printed: number; createdBy: string | null; createdAt: string;
  lines?: Array<{ itemId: string | null; batch: string; qty: number; data: LabelData }>;
}
export const LABEL_KEYS = { setup: ['labelSetup'], jobs: ['labelJobs'], barcodes: ['labelBarcodes'] } as const;
export const useLabelSetup = () => useQuery({ queryKey: LABEL_KEYS.setup, queryFn: () => api.get<LabelSetup>('/shop/label/setup') });
export const useLabelJobs = () => useQuery({ queryKey: LABEL_KEYS.jobs, queryFn: () => api.get<JobRow[]>('/shop/label/jobs?limit=200') });

/** Built-in stock presets plus the shop's own. */
export const allStocks = (setup?: LabelSetup): LabelStockRow[] => [
  ...STOCK_PRESETS.map((p) => ({ id: `preset:${p.id}`, name: p.name, geometry: p.stock, preset: true })),
  ...(setup?.stocks ?? []),
];
/** Built-in printer types plus the shop's profiles. */
export const allPrinters = (setup?: LabelSetup): PrinterRow[] => [
  ...(setup?.printers ?? []),
  ...PRINTER_PRESETS.map((p) => ({ id: `preset:${p.id}`, name: p.name, settings: p.settings, branchId: null, canRestore: false, preset: true })),
];

/* ---------- This computer (spec: printer profiles are per workstation) ---------- */
const DEV = 'c360.labels.device';
interface Device { printerId?: string; stockId?: string; templateId?: string }
export const device = (): Device => { try { return JSON.parse(localStorage.getItem(DEV) ?? '{}') as Device; } catch { return {}; } };
export const setDevice = (p: Partial<Device>) => { try { localStorage.setItem(DEV, JSON.stringify({ ...device(), ...p })); } catch { /* private mode */ } };

/** The data a label prints for an item (the same fields the server snapshots). */
export function labelDataFor(it: Pick<Item, 'name' | 'sku' | 'barcode' | 'sp1' | 'mrp' | 'unit' | 'brand' | 'category'>, company: string, extra: { batch?: string; expiry?: string; location?: string } = {}): LabelData {
  return { name: it.name, sku: it.sku, barcode: it.barcode, price: it.sp1 ?? null, mrp: it.mrp ?? null, batch: extra.batch ?? '', expiry: extra.expiry ?? '', unit: it.unit ?? '', brand: it.brand ?? '', category: it.category ?? '', location: extra.location ?? '', company };
}
export const SAMPLE_DATA: LabelData = { name: 'Logitech M331 Silent Mouse', sku: 'LOG-M331', barcode: '5099206066861', price: 1199, mrp: 1495, batch: 'B2611', expiry: '2027-06-30', unit: 'pcs', brand: 'Logitech', category: 'Computer Accessories', location: 'Rack A2', company: 'Your Shop' };

/** The starting template for a size, from the label fields in Print settings (so the look carries over). */
export function autoFromSettings(w: number, h: number, s: BarcodeSettings): LabelTemplateBody {
  const on = (k: string) => s.fields.find((f) => f.key === k && f.enabled);
  const pick = (k: string) => { const f = on(k); return f ? { size: f.size, bold: f.bold } : undefined; };
  return autoTemplate(w, h, {
    company: pick('businessName'), sku: on('itemCode') ? { size: 18, bold: false } : undefined, name: pick('itemName'), mrp: pick('mrp'), price: pick('sellingPrice'),
    category: pick('category'), brand: pick('brand'), unit: pick('unit'),
  }, s.barcodeHeight);
}
/** The template for a line: the category's default, then the shop's default, then the chosen one. */
export function templateFor(templates: TemplateRow[], category: string): TemplateRow | undefined {
  return templates.find((t) => t.published && t.categories.includes(category)) ?? templates.find((t) => t.published && t.isDefault);
}
export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export type { JobLine };
