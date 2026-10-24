import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { config } from '../config';
import { HttpError } from '../http';
import { emptyExtract, parseDocumentText, type Extracted, type ExtractKind, type ExtractResult } from '../../../shared/extract';

export const UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** data:<mime>;base64,<data> → bytes, with type and size checks. */
export function decodeDataUrl(dataUrl: string): { mime: UploadType; bytes: Buffer } {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Upload a PDF, PNG, JPG or WebP file', 'bad_file');
  const mime = (m[1] === 'image/jpg' ? 'image/jpeg' : m[1]) as UploadType;
  if (!UPLOAD_TYPES.includes(mime)) throw new HttpError(400, 'Upload a PDF, PNG, JPG or WebP file', 'bad_file');
  const bytes = Buffer.from(m[2]!.replace(/\s/g, ''), 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files must be 10 MB or smaller', 'too_large');
  // Magic bytes, so a renamed file can't pose as a PDF or image.
  const sig = bytes.subarray(0, 12);
  const ok = mime === 'application/pdf' ? sig.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/png' ? sig[0] === 0x89 && sig.subarray(1, 4).toString() === 'PNG'
    : mime === 'image/jpeg' ? sig[0] === 0xff && sig[1] === 0xd8
    : sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP';
  if (!ok) throw new HttpError(400, 'That file doesn’t look like a real PDF or image', 'bad_file');
  return { mime, bytes };
}

/* ---------------- Text from PDFs and photos (offline) ---------------- */

/** Text of a PDF's pages, with items on the same baseline joined into one line. */
export async function pdfText(bytes: Buffer, maxPages = 10): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, standardFontDataUrl: fonts }).promise;
  const out: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; s: string }>>();
      for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
        if (!it.str || !it.transform) continue;
        const y = Math.round(it.transform[5]! / 3) * 3;
        const row = rows.get(y) ?? [];
        row.push({ x: it.transform[4]!, s: it.str });
        rows.set(y, row);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  } finally {
    await doc.destroy();
  }
  return out.filter(Boolean).join('\n');
}

let ocrWorker: Promise<import('tesseract.js').Worker> | null = null;
/** OCR with the English model shipped in node_modules, so no download is needed at run time. */
export async function imageText(bytes: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  // Resolve from the app root: works for tsx in development and the esbuild bundle in production.
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  ocrWorker ??= createWorker('eng', 1, { langPath, gzip: true, cachePath: path.join(os.tmpdir(), 'tesseract-cache') }).catch((e) => { ocrWorker = null; throw e; });
  const w = await ocrWorker;
  const { data } = await w.recognize(bytes);
  return data.text;
}

/* ---------------- AI extraction (when an Anthropic API key is configured) ---------------- */

const nstr = z.string().nullable();
const nnum = z.number().nullable();
const ExtractSchema = z.object({
  documentType: z.enum(['invoice', 'bill', 'quotation', 'purchase_order', 'receipt', 'product', 'price_list', 'gst_certificate', 'business_card', 'other']),
  party: z.object({ name: nstr, companyName: nstr, gstin: nstr, phone: nstr, email: nstr, address: nstr, state: nstr }),
  documentNumber: nstr, date: nstr, dueDate: nstr,
  subtotal: nnum, taxTotal: nnum, cgst: nnum, sgst: nnum, igst: nnum, total: nnum,
  lines: z.array(z.object({
    name: z.string(), description: nstr, sku: nstr, barcode: nstr, hsn: nstr, qty: nnum, unit: nstr, rate: nnum, mrp: nnum,
    sellingPrice: nnum, costPrice: nnum, discountPercent: nnum, taxRate: nnum, amount: nnum, brand: nstr, category: nstr,
  })),
  notes: nstr,
});

const KIND_HINT: Record<ExtractKind, string> = {
  item: 'The user is adding ONE product or service to their catalogue. Put it in lines[0] with every detail you can see (name, brand, category, SKU, barcode, HSN, unit, MRP, selling price, cost price, GST rate, description). For a product photo with no text, describe the product: a clear name, brand if visible, and category.',
  items: 'The user is importing a price list or catalogue. Return one line per product.',
  bill: 'This is a bill from a vendor (a purchase). party is the SELLER/supplier, not the buyer.',
  expense: 'This is a receipt or bill for a business expense. party is the merchant.',
  customer: 'The user is adding a CUSTOMER from a document such as a GST certificate, visiting card, letterhead or an invoice addressed to them. party is that business or person.',
  vendor: 'The user is adding a VENDOR/supplier from a document such as a GST certificate, visiting card or their invoice. party is that supplier.',
  invoice: 'The user is making a sales invoice from a customer purchase order or enquiry. party is the CUSTOMER (the buyer).',
  order: 'The user is making a quote or sales order from a customer enquiry or purchase order. party is the CUSTOMER (the buyer).',
};

const SYSTEM = `You read Indian business documents (tax invoices, bills, quotations, purchase orders, receipts, GST certificates, visiting cards, product labels, price lists) and return their contents as structured data.
Rules:
- Copy values exactly as printed; never invent data. Use null for anything not present.
- Amounts are plain numbers in rupees (₹30,000 → 30000; "30k" → 30000; "1.5 lakh" → 150000). No currency symbols or commas.
- Dates are YYYY-MM-DD. Indian documents write the day first (05/04/2026 is 5 April 2026).
- GSTIN is the 15-character code. state is the Indian state name for the party.
- taxRate is the GST percentage (e.g. 18). rate is the unit price before tax; amount is the line amount as printed.
- The shop using this app is the other side of the document; never return the shop's own details as the party.`;

let client: Anthropic | null = null;
export const aiEnabled = () => !!config.ai.apiKey;

async function aiExtract(bytes: Buffer, mime: UploadType, kind: ExtractKind, shop: { name: string; gstin: string }): Promise<Extracted> {
  client ??= new Anthropic({ apiKey: config.ai.apiKey, timeout: 90_000, maxRetries: 1 });
  const data = bytes.toString('base64');
  const file: Anthropic.Beta.BetaContentBlockParam = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const response = await client.beta.messages.parse({
    model: config.ai.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(ExtractSchema) },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [file, { type: 'text', text: `${KIND_HINT[kind]}\nThe shop using this app is "${shop.name}"${shop.gstin ? ` (GSTIN ${shop.gstin})` : ''}.` }],
    }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'This document couldn’t be read automatically. Fill the form by hand.', 'extract_refused');
  if (!response.parsed_output) throw new Error(`No structured output (stop_reason ${response.stop_reason})`);
  return response.parsed_output as Extracted;
}

/* ---------------- Entry point ---------------- */

export async function extractDocument(dataUrl: string, kind: ExtractKind, shop: { name: string; gstin: string }): Promise<ExtractResult> {
  const { mime, bytes } = decodeDataUrl(dataUrl);
  const warnings: string[] = [];

  if (aiEnabled()) {
    try {
      const data = await aiExtract(bytes, mime, kind, shop);
      if (data.party.gstin && data.party.gstin.toUpperCase() === shop.gstin.toUpperCase()) data.party = { ...emptyExtract().party };
      return { data, method: 'ai', confidence: 0.9, warnings, textPreview: '' };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('[extract] AI extraction failed, using offline reader:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message);
      warnings.push('The smart reader was unavailable, so a basic text reader was used. Please check the values.');
    }
  }

  let text = '';
  let method: ExtractResult['method'] = 'pdf-text';
  if (mime === 'application/pdf') {
    text = await pdfText(bytes).catch(() => '');
    if (text.replace(/\s/g, '').length < 20) warnings.push('This PDF looks scanned (no text layer). Upload a photo of the page instead, or set up the smart reader for scanned files.');
  } else {
    method = 'ocr';
    text = await imageText(bytes).catch((e) => { console.error('[extract] OCR failed:', (e as Error).message); return ''; });
    if (text.replace(/\s/g, '').length < 10) warnings.push(kind === 'item' ? 'No text found in the photo. It has been used as the product image; fill in the details.' : 'No readable text found in the photo. Try a sharper, well-lit picture.');
  }
  const { data, confidence } = parseDocumentText(text, kind, shop.gstin);
  return { data, method, confidence, warnings, textPreview: text.slice(0, 1500) };
}
