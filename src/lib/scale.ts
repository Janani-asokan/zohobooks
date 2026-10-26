import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScale, type ScaleReading } from '../../shared/scale';

type SerialPortLike = { open: (o: { baudRate: number }) => Promise<void>; close: () => Promise<void>; readable: ReadableStream<Uint8Array> | null };
const serial = () => (typeof navigator !== 'undefined' ? (navigator as unknown as { serial?: { requestPort: () => Promise<SerialPortLike> } }).serial : undefined);
export const scaleSupported = () => !!serial();

/** Live weight from a USB/serial weighing scale (Chrome and Edge on a computer). */
export function useScale() {
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const port = useRef<SerialPortLike | null>(null);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const disconnect = useCallback(async () => {
    try { await reader.current?.cancel(); } catch { /* already closed */ }
    try { await port.current?.close(); } catch { /* already closed */ }
    reader.current = null; port.current = null; setConnected(false); setReading(null);
  }, []);

  const connect = useCallback(async (baudRate = 9600) => {
    const s = serial();
    if (!s) { setError('Connecting a scale needs Chrome or Edge on a computer.'); return; }
    setError('');
    try {
      const p = await s.requestPort();
      await p.open({ baudRate });
      port.current = p; setConnected(true);
      const r = p.readable!.getReader(); reader.current = r;
      const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/[\r\n]+/); buf = lines.pop() ?? '';
        for (const l of lines) { const w = parseScale(l); if (w) setReading(w); }
        if (buf.length > 200) buf = buf.slice(-50);
      }
    } catch (e) {
      if ((e as Error).name !== 'NotFoundError') setError((e as Error).message || 'The scale disconnected');
    } finally {
      await disconnect();
    }
  }, [disconnect]);

  useEffect(() => () => { void disconnect(); }, [disconnect]);
  return { reading, connected, error, connect, disconnect, supported: scaleSupported() };
}
