import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Organization } from '@/api/types';

/** UPI deep link (NPCI spec) — any UPI app can scan it. */
export const upiLink = (org: Pick<Organization, 'upiId' | 'companyName'>, amount: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(org.upiId)}&pn=${encodeURIComponent(org.companyName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

/** QR code as a data URL. `ready` turns true once the code is drawn (or there is nothing to draw). */
export function useQrState(text: string | null) {
  const [state, setState] = useState<{ text: string | null; src: string }>({ text: null, src: '' });
  useEffect(() => {
    if (!text) return setState({ text, src: '' });
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((d) => alive && setState({ text, src: d }))
      .catch(() => alive && setState({ text, src: '' }));
    return () => { alive = false; };
  }, [text]);
  return { src: state.text === text ? state.src : '', ready: !text || state.text === text };
}

export const useQr = (text: string | null) => useQrState(text).src;
