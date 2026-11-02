import { describe, expect, it } from 'vitest';
import { mobileDigits, normalizeMobile } from './phone';

describe('customer mobile numbers', () => {
  it('are optional', () => {
    expect(normalizeMobile('')).toBe('');
    expect(normalizeMobile('   ')).toBe('');
    expect(normalizeMobile(undefined)).toBe('');
  });
  it('accept a 10-digit mobile written the usual ways, and save it one way', () => {
    for (const v of ['9876543210', '98765 43210', '+91 98765 43210', '+919876543210', '919876543210', '09876543210', '98765-43210', '(+91) 98765 43210'])
      expect(normalizeMobile(v)).toBe('+91 98765 43210');
  });
  it('refuse more or fewer digits, letters, landlines and other countries', () => {
    for (const v of ['98765432101', '987654321', '1234567890', '5876543210', '98765abcde', '+1 415 555 0100', '+44 7700 900123', '0422 2345678', '9876543210 9876543210', '++91 98765 43210x'])
      expect(normalizeMobile(v), v).toBeNull();
  });
  it('gives the 10 digits for matching', () => {
    expect(mobileDigits('+91 94440 11223')).toBe('9444011223');
  });
});
