import { describe, expect, it } from 'vitest';
import { cleanPath } from './analytics';

describe('analytics cleanPath', () => {
  it('keeps the page, drops ids, tokens and queries', () => {
    expect(cleanPath('/app/sales/invoices/9f1c2b3a-1234-4abc-8def-0123456789ab')).toBe('/app/sales/invoices/:id');
    expect(cleanPath('/app/items/9f1c2b3a-1234-4abc-8def-0123456789ab/edit')).toBe('/app/items/:id/edit');
    expect(cleanPath('/share/a1b2c3d4e5f6a7b8c9d0e1f2')).toBe('/share/:token');
    expect(cleanPath('/reset-password?token=secret')).toBe('/reset-password');
    expect(cleanPath('/invoices/42/print')).toBe('/invoices/:id/print');
    expect(cleanPath('/app/reports/gst')).toBe('/app/reports/gst');
    expect(cleanPath('/')).toBe('/');
  });
});
