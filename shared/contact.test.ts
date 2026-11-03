import { describe, expect, it } from 'vitest';
import { isValidEmailOrEmpty, normalizeEmail, normalizeVendorPhone } from './contact';

describe('email addresses', () => {
  it('accepts real addresses and empty', () => {
    for (const e of ['accounts@supplier.in', 'Ravi.K+bills@mail.co.in', 'sales-1@abc-traders.com', 'x_y@gmail.com', '']) expect(isValidEmailOrEmpty(e), e).toBe(true);
    expect(normalizeEmail(' Accounts@Supplier.IN ')).toBe('accounts@supplier.in');
  });
  it('refuses random text and broken addresses', () => {
    for (const e of ['abc123', 'abc@', '@abc.com', 'a@b', 'a@b.c', 'a..b@x.com', '.a@x.com', 'a.@x.com', 'a b@x.com', 'a@x..com', 'a@-x.com', 'a@x-.com', 'a@x.c0m', 'asdf@asdf@x.com', 'qwerty12345!@#'])
      expect(normalizeEmail(e), e).toBeNull();
  });
});

describe('vendor phone numbers', () => {
  it('keeps mobiles in one format', () => {
    for (const p of ['9876543210', '+91 98765 43210', '098765-43210']) expect(normalizeVendorPhone(p)).toBe('+91 98765 43210');
  });
  it('accepts landlines with STD code and toll-free numbers', () => {
    expect(normalizeVendorPhone('0422 2345678')).toBe('04222345678');
    expect(normalizeVendorPhone('044-23456789')).toBe('04423456789');
    expect(normalizeVendorPhone('+91 422 2345678')).toBe('04222345678');
    expect(normalizeVendorPhone('(0265) 2345678')).toBe('02652345678');
    expect(normalizeVendorPhone('1800 123 4567')).toBe('18001234567');
    expect(normalizeVendorPhone('')).toBe('');
  });
  it('refuses random text, short or long numbers, and other countries', () => {
    for (const p of ['abc123xyz', 'phone', '12345', '98765', '987654321012', '0422 23456', '+1 415 555 0100', '+44 20 7946 0958', '0000000000', '1234567890', '98765abcde'])
      expect(normalizeVendorPhone(p), p).toBeNull();
  });
});
