export const ACCEPT_UPLOADS = 'application/pdf,image/png,image/jpeg,image/webp';
export const MAX_UPLOAD_MB = 10;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });

/**
 * File → data URL for upload. Large photos (phone cameras) are scaled to 2000px and re-encoded as JPEG,
 * which keeps them readable for OCR while cutting the upload from ~5 MB to a few hundred KB.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const okType = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  if (!okType) throw new Error('Upload a PDF, PNG, JPG or WebP file');
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024 && file.type === 'application/pdf') throw new Error(`PDFs must be ${MAX_UPLOAD_MB} MB or smaller`);
  if (!file.type.startsWith('image/') || file.size < 1.5 * 1024 * 1024) return readAsDataUrl(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
