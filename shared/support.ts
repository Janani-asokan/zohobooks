/**
 * Customer support call-back slots. The platform sets the support days, hours, slot length, how many calls one slot
 * can take, and how far ahead shops can book. Slots are in India time (IST, UTC+05:30, no daylight saving).
 */
export interface SupportSettings {
  /** ISO weekdays with support: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** "HH:MM", IST. The last slot ends at `end`. */
  start: string; end: string;
  slotMinutes: number;
  /** Call-backs one slot can take (one per staff member on the phones). */
  capacity: number;
  /** How many days ahead a slot can be booked. */
  bookingDays: number;
}
export const DEFAULT_SUPPORT: SupportSettings = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00', slotMinutes: 30, capacity: 2, bookingDays: 14 };
/** A slot must be at least this far away when booked, so staff see it coming. */
export const MIN_NOTICE_MIN = 60;

export const SUPPORT_TOPICS = [
  { key: 'billing', label: 'Billing & invoices' },
  { key: 'printing', label: 'Printing, labels & barcodes' },
  { key: 'gst', label: 'GST & reports' },
  { key: 'stock', label: 'Stock & items' },
  { key: 'account', label: 'Account, plan & payment' },
  { key: 'other', label: 'Something else' },
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]['key'];
export const topicLabel = (k: string) => SUPPORT_TOPICS.find((t) => t.key === k)?.label ?? k;

const IST_MIN = 330;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m!; };
/** IST calendar date ("YYYY-MM-DD") of an instant. */
export const istDate = (t: Date) => new Date(t.getTime() + IST_MIN * 60_000).toISOString().slice(0, 10);
/** The instant of an IST date + minutes after midnight. */
const istInstant = (date: string, minuteOfDay: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 0, minuteOfDay) - IST_MIN * 60_000);
};
/** ISO weekday (1 = Monday) of an IST date. */
const isoWeekday = (date: string) => { const [y, m, d] = date.split('-').map(Number); const w = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); return w === 0 ? 7 : w; };
/** "10:30 am", IST. */
export const istTime = (t: Date | string) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
export const istDay = (t: Date | string) => new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export interface SlotDay { date: string; slots: Array<{ start: string; left: number }> }

/**
 * Every bookable slot from now until `bookingDays` ahead, with how many places are left. `booked` counts scheduled
 * call-backs per slot start (ISO string). Full slots and slots closer than MIN_NOTICE_MIN are left out.
 */
export function supportSlots(s: SupportSettings, booked: Map<string, number>, now = new Date()): SlotDay[] {
  const out: SlotDay[] = [];
  const first = istDate(now);
  const startMin = mins(s.start), endMin = mins(s.end);
  const earliest = now.getTime() + MIN_NOTICE_MIN * 60_000;
  for (let i = 0; i <= s.bookingDays; i++) {
    const date = istDate(new Date(istInstant(first, 12 * 60).getTime() + i * 86_400_000));
    if (!s.days.includes(isoWeekday(date))) continue;
    const slots: SlotDay['slots'] = [];
    for (let m = startMin; m + s.slotMinutes <= endMin; m += s.slotMinutes) {
      const t = istInstant(date, m);
      if (t.getTime() < earliest) continue;
      const start = t.toISOString();
      const left = s.capacity - (booked.get(start) ?? 0);
      if (left > 0) slots.push({ start, left });
    }
    if (slots.length) out.push({ date, slots });
  }
  return out;
}

/** Whether an instant is a real slot under the settings (on a support day, inside hours, on the slot grid). */
export function isSlot(s: SupportSettings, t: Date): boolean {
  const date = istDate(t);
  if (!s.days.includes(isoWeekday(date))) return false;
  const m = Math.round((t.getTime() - istInstant(date, 0).getTime()) / 60_000);
  const startMin = mins(s.start), endMin = mins(s.end);
  return t.getUTCSeconds() === 0 && t.getUTCMilliseconds() === 0 && m >= startMin && m + s.slotMinutes <= endMin && (m - startMin) % s.slotMinutes === 0;
}

/** Live chat with the support team (polling). */
export const LIVE = {
  /** A chat nobody picks up in this long ends with an offer of a call-back. */
  waitMinutes: 5,
  /** An agent counts as online while their console has polled within this many seconds. */
  agentOnlineSeconds: 120,
  /** How often the open chat checks for new messages. */
  pollSeconds: 3,
  /** Messages one side may send per minute. */
  perMinute: 20,
} as const;

/** Whether support is open at this moment (India time). */
export function supportOpenAt(s: SupportSettings, now = new Date()) {
  const ist = new Date(now.getTime() + IST_MIN * 60_000);
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dow = ((ist.getUTCDay() + 6) % 7) + 1;
  return s.days.includes(dow) && m >= mins(s.start) && m < mins(s.end);
}

/* ---------- WhatsApp support ---------- */

/**
 * A WhatsApp number as wa.me wants it: digits only, with the country code. A 10-digit Indian mobile gets 91 in front;
 * an 11-digit number starting with 0 drops the 0. Anything else that isn't 11–15 digits is not a number ('').
 */
export function waDigits(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d) ? `91${d}` : '';
  return d.length >= 11 && d.length <= 15 ? d : '';
}

/** The message WhatsApp opens with, so the team knows who is writing and why without asking. */
export function whatsappSupportText(x: { shopName: string; userName: string; question?: string }) {
  const q = (x.question ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
  return [`Hi Corpus360 support, I need help.`, `Shop: ${x.shopName}`, `Name: ${x.userName}`, q ? `About: ${q}` : ''].filter(Boolean).join('\n');
}

export const waLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

/* ---------- Sales or customer care ---------- */

/**
 * Who Help connects you to. A shop on a paid plan whose license is current gets customer care (live chat, call-backs,
 * WhatsApp support). Visitors, trial shops and shops whose license ran out are connected to the sales team instead.
 */
export const isPaidShop = (s: { planId: string; licenseExpired: boolean }) => s.planId !== 'trial' && !s.licenseExpired;

/** The sales contact, falling back to the support contact for anything the platform hasn't set. */
export const salesContact = (c: { salesPhone?: string; salesEmail?: string; salesWhatsapp?: string; phone?: string; email?: string; whatsapp?: string }) => ({
  phone: c.salesPhone || c.phone || '',
  email: c.salesEmail || c.email || '',
  whatsapp: waDigits(c.salesWhatsapp || c.whatsapp || ''),
});

export const LEAD_SOURCES = ['landing', 'login', 'signup', 'legal', 'app'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** The message WhatsApp opens with when someone taps "WhatsApp sales". */
export function whatsappSalesText(x: { shopName?: string; name?: string; renew?: boolean }) {
  const lines = [x.renew ? 'Hi Corpus360, I’d like to choose a plan for my shop.' : 'Hi Corpus360, I’d like to know more about Corpus360 Lite for my business.'];
  if (x.shopName) lines.push(`Shop: ${x.shopName}`);
  if (x.name) lines.push(`Name: ${x.name}`);
  return lines.join('\n');
}
