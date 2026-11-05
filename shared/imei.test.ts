import { describe, expect, it } from 'vitest';
import { extractImeis, isImei, luhnOk } from './imei';

describe('IMEI numbers', () => {
  it('a real IMEI passes its check digit; a mistyped one does not', () => {
    expect(isImei('490154203237518')).toBe(true);   // the standard example IMEI
    expect(isImei('490154203237519')).toBe(false);  // last digit wrong
    expect(isImei('49015420323751')).toBe(false);   // 14 digits
    expect(isImei('8901234567890')).toBe(false);    // a 13-digit EAN
    expect(luhnOk('79927398713')).toBe(true);
  });
  it('reads every IMEI from a box QR code or label text, once each', () => {
    expect(extractImeis('IMEI1:490154203237518 IMEI2:356938035643809 SN:R58N12345')).toEqual(['490154203237518', '356938035643809']);
    expect(extractImeis('490154203237518')).toEqual(['490154203237518']);
    expect(extractImeis('8901234567890')).toEqual([]);
    expect(extractImeis('IMEI 490154203237519')).toEqual([]); // bad check digit: not an IMEI
    expect(extractImeis('490154203237518,490154203237518')).toEqual(['490154203237518']);
  });
});
