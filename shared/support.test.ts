import { describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT, isSlot, istTime, supportSlots } from './support';

// Tuesday 17 Nov 2026, 09:00 IST = 03:30 UTC.
const tuesday9am = new Date('2026-11-17T03:30:00Z');

describe('support call-back slots (IST)', () => {
  it('offers Monday–Saturday 10:00–18:00 in 30-minute slots, at least an hour ahead', () => {
    const days = supportSlots(DEFAULT_SUPPORT, new Map(), tuesday9am);
    expect(days[0]!.date).toBe('2026-11-17');
    expect(istTime(days[0]!.slots[0]!.start)).toMatch(/^10:00\s?am$/i);
    expect(days[0]!.slots).toHaveLength(16); // 10:00 … 17:30
    expect(istTime(days[0]!.slots.at(-1)!.start)).toMatch(/^5:30\s?pm$/i);
    expect(days.some((d) => new Date(d.date + 'T12:00:00Z').getUTCDay() === 0)).toBe(false); // no Sundays
  });
  it('drops slots within the hour and full slots, and counts places left', () => {
    const at1015 = new Date('2026-11-17T04:45:00Z'); // 10:15 IST
    const first = supportSlots(DEFAULT_SUPPORT, new Map(), at1015)[0]!.slots[0]!;
    expect(istTime(first.start)).toMatch(/^11:30\s?am$/i);
    const full = new Map([[first.start, 2]]);
    expect(supportSlots(DEFAULT_SUPPORT, full, at1015)[0]!.slots[0]!.start).not.toBe(first.start);
    expect(supportSlots(DEFAULT_SUPPORT, new Map([[first.start, 1]]), at1015)[0]!.slots[0]!.left).toBe(1);
  });
  it('only accepts real slots: support day, inside hours, on the grid', () => {
    expect(isSlot(DEFAULT_SUPPORT, new Date('2026-11-17T04:30:00Z'))).toBe(true);  // Tue 10:00 IST
    expect(isSlot(DEFAULT_SUPPORT, new Date('2026-11-17T04:40:00Z'))).toBe(false); // 10:10, off the grid
    expect(isSlot(DEFAULT_SUPPORT, new Date('2026-11-17T12:30:00Z'))).toBe(false); // 18:00, closed
    expect(isSlot(DEFAULT_SUPPORT, new Date('2026-11-22T04:30:00Z'))).toBe(false); // Sunday
  });
});

describe('WhatsApp support', () => {
  it('turns typed numbers into what wa.me wants: digits with the country code', async () => {
    const { waDigits } = await import('./support');
    expect(waDigits('98400 12345')).toBe('919840012345');
    expect(waDigits('+91 98400-12345')).toBe('919840012345');
    expect(waDigits('098400 12345')).toBe('919840012345');
    expect(waDigits('+971 50 123 4567')).toBe('971501234567');
    expect(waDigits('12345')).toBe('');
    expect(waDigits('0441234567')).toBe(''); // a 10-digit landline is not a WhatsApp mobile
    expect(waDigits('')).toBe('');
  });

  it('writes a message that says who is asking and why, and links to it', async () => {
    const { waLink, whatsappSupportText } = await import('./support');
    const t = whatsappSupportText({ shopName: 'Aravind Computer Store', userName: 'Aravind', question: '  printer   not printing  ' });
    expect(t).toBe('Hi Corpus360 support, I need help.\nShop: Aravind Computer Store\nName: Aravind\nAbout: printer not printing');
    expect(whatsappSupportText({ shopName: 'S', userName: 'U' })).not.toContain('About');
    expect(waLink('919840012345', 'a b&c')).toBe('https://wa.me/919840012345?text=a%20b%26c');
  });
});
