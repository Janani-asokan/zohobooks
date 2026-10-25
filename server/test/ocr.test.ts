import { describe, expect, it } from 'vitest';
import { fixRupee } from '../src/services/extract';

describe('OCR clean-up', () => {
  it('turns a misread rupee sign back into ₹ before amounts', () => {
    expect(fixRupee('Total 2 3,000.00\nGrand Total ? 3,000.00\nRate % 250.00')).toBe('Total ₹3,000.00\nGrand Total ₹3,000.00\nRate ₹250.00');
  });
  it('leaves real numbers alone', () => {
    expect(fixRupee('Qty 2 Nos\nTotal Quantity 12 Total 3,000.00')).toBe('Qty 2 Nos\nTotal Quantity 12 Total 3,000.00');
  });
});
