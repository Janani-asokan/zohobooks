import { describe, expect, it } from 'vitest';
import { bankErrors, bankFromIfsc, composeBankDetails, isValidAccountNo, isValidIfsc, parseBankDetails } from './bank';

const blank = { bankAccountName: '', bankName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '', bankNote: '' };

describe('shop bank account', () => {
  it('account numbers: 9 to 18 digits, spaces and dashes ignored', () => {
    for (const v of ['50200012345678', '5020 0012 3456 78', '123456789', '123456789012345678']) expect(isValidAccountNo(v), v).toBe(true);
    for (const v of ['12345678', '1234567890123456789', 'ABC12345678', '50200O12345678', '']) expect(isValidAccountNo(v), v).toBe(false);
  });
  it('IFSC: 4 letters, 0, 6 letters/digits; lower case accepted', () => {
    for (const v of ['HDFC0001234', 'sbin0000001', 'UTIB0ABC123', ' ICIC0000123 ']) expect(isValidIfsc(v), v).toBe(true);
    for (const v of ['HDFC1001234', 'HDF00001234', 'HDFC000123', 'HDFC00012345', '12340001234', 'HDFC-001234']) expect(isValidIfsc(v), v).toBe(false);
    expect(bankFromIfsc('hdfc0001234')).toBe('HDFC Bank');
    expect(bankFromIfsc('SBIN0000001')).toBe('State Bank of India');
    expect(bankFromIfsc('ZZZZ0000001')).toBe('');
  });
  it('account number and IFSC go together, with the holder’s name, and the number typed twice must match', () => {
    expect(bankErrors({ bankAccountNo: '50200012345678', bankIfsc: '', bankAccountName: 'X' })).toHaveProperty('bankIfsc');
    expect(bankErrors({ bankAccountNo: '', bankIfsc: 'HDFC0001234', bankAccountName: 'X' })).toHaveProperty('bankAccountNo');
    expect(bankErrors({ bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankAccountName: '' })).toHaveProperty('bankAccountName');
    expect(bankErrors({ bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankAccountName: 'X' }, '50200012345679')).toHaveProperty('bankAccountNoConfirm');
    expect(bankErrors({ bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankAccountName: 'X' }, '5020 0012 3456 78')).toEqual({});
    expect(bankErrors({ bankAccountNo: '', bankIfsc: '', bankAccountName: '' })).toEqual({});
  });
  it('prints the Pay-to text from the fields', () => {
    expect(composeBankDetails({ ...blank, bankAccountName: 'Aravind Computer Store', bankName: 'HDFC Bank', bankAccountNo: '5020 0012 3456 78', bankIfsc: 'hdfc0001234', bankBranch: 'Teynampet' }))
      .toBe('A/c name: Aravind Computer Store\nHDFC Bank · A/c 50200012345678\nIFSC HDFC0001234 · Teynampet');
    expect(composeBankDetails(blank)).toBe('');
  });
  it('splits an old free-text bank box into the fields, keeping what it cannot place', () => {
    expect(parseBankDetails('HDFC Bank · A/c 50200012345678\nIFSC HDFC0001234 · Teynampet')).toMatchObject({ bankName: 'HDFC Bank', bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234', bankBranch: 'Teynampet', bankNote: '' });
    expect(parseBankDetails('Account No: 1234 5678 9012\nIFSC: SBIN0004567')).toMatchObject({ bankAccountNo: '123456789012', bankIfsc: 'SBIN0004567', bankName: 'State Bank of India' });
    expect(parseBankDetails('Pay by cheque to the shop')).toMatchObject({ bankAccountNo: '', bankIfsc: '', bankNote: 'Pay by cheque to the shop' });
    expect(parseBankDetails('')).toEqual(blank);
    // An account number without an IFSC is not split out half-way: the old text stays as it was.
    expect(parseBankDetails('SBI A/c 12345678901, pay at the counter')).toEqual({ ...blank, bankNote: 'SBI A/c 12345678901, pay at the counter' });
    expect(bankErrors(parseBankDetails('SBI A/c 12345678901, pay at the counter'))).toEqual({});
  });
});
