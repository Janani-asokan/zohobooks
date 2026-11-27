import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquareText, Send } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Field, Modal } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

export const useSmsStatus = () => useQuery({ queryKey: ['sms-status'], queryFn: () => api.get<{ on: boolean; leftToday: number }>('/shop/sms/status'), staleTime: 60_000, retry: false });

const tenDigits = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d; };

/**
 * Send a bill by SMS (MSG91, DLT-approved template): the customer gets the bill number, amount and a link to view
 * and download it. The number is filled from the customer; shown only when SMS is switched on for the platform.
 */
export function SendSmsDialog({ invoiceId, number, phone, open, onClose }: { invoiceId: string; number: string; phone?: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const status = useSmsStatus().data;
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTo(tenDigits(phone ?? '')); setErr(''); } }, [open, phone]);
  const valid = /^[6-9]\d{9}$/.test(tenDigits(to));
  const send = async () => {
    if (!valid) return setErr('Enter a 10-digit Indian mobile number');
    setBusy(true); setErr('');
    try {
      await api.post(`/shop/invoices/${invoiceId}/sms`, { phone: to });
      toast('success', 'SMS sent', `${number} went to +91 ${tenDigits(to)}. They can open and download the bill from the link.`);
      qc.invalidateQueries({ queryKey: ['sms-status'] });
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Couldn’t send. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Send bill by SMS" subtitle={`${number}: the customer gets the amount and a link to view and download the bill.`}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !valid || status?.leftToday === 0} onClick={() => void send()}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send SMS</button></>}>
      <Field label="Mobile number" error={err} hint={status ? `${status.leftToday} SMS left today` : undefined}>
        <div className="input-group">
          <span className="lead">+91</span>
          <input className="input" inputMode="tel" autoFocus maxLength={14} value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} placeholder="98765 43210" />
        </div>
      </Field>
    </Modal>
  );
}

/** "Send SMS" menu row or button; hidden when SMS isn't switched on. */
export function SendSmsButton({ invoiceId, number, phone, className = 'btn btn-secondary', onOpen }: { invoiceId: string; number: string; phone?: string; className?: string; onOpen?: () => void }) {
  const on = useSmsStatus().data?.on;
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => { onOpen?.(); setOpen(true); }}><MessageSquareText size={16} /> Send SMS</button>
      <SendSmsDialog invoiceId={invoiceId} number={number} phone={phone} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
