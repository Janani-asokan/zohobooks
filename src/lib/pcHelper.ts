/**
 * Corpus360 Print Helper (website on a Windows PC): a small program on the shop's computer that takes label jobs from
 * this website and sends them to the label printer as a RAW job, in the printer's own language (TSPL / ZPL). The
 * printer is told the exact label size, so no Windows paper size is needed and nothing prints on A4 or sideways.
 * It listens only on this computer (127.0.0.1) and only answers the Corpus360 website.
 */
export const HELPER_URL = 'http://127.0.0.1:17361';
export const HELPER_DOWNLOAD = '/downloads/Corpus360PrintHelper.exe';

export interface HelperPrinter { name: string; default: boolean }
export interface HelperStatus { version: string; printers: HelperPrinter[] }

/** Is the helper running on this computer? null when it isn't (or the browser blocked the request). */
export async function helperStatus(timeoutMs = 1500): Promise<HelperStatus | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${HELPER_URL}/status`, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { app?: string; version?: string; printers?: HelperPrinter[] };
    return j.app === 'corpus360-print-helper' ? { version: j.version ?? '', printers: j.printers ?? [] } : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** The printer most likely to be the label printer: TVS / TSC / Zebra / "Bar Code Printer …", else the default. */
export function likelyLabelPrinter(list: HelperPrinter[]): string {
  const label = list.find((p) => /tvs|lp ?46|tt0\d\d|bar ?code|barcode|label|tsc|zebra|xprinter|gprinter|godex|honeywell|argox|citizen|snbc|hprt/i.test(p.name));
  return (label ?? list.find((p) => p.default) ?? list[0])?.name ?? '';
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

export async function helperPrint(printer: string, bytes: Uint8Array, name = 'Corpus360 labels') {
  let res: Response;
  try {
    res = await fetch(`${HELPER_URL}/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ printer, name, data: b64(bytes) }) });
  } catch {
    throw new Error('The Corpus360 Print Helper is not running on this computer. Start it (double-click Corpus360PrintHelper.exe), or choose “Print window” under Send labels.');
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `The print helper answered ${res.status}`);
}
