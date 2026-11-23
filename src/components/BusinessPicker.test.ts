import { describe, expect, it } from 'vitest';
import { pathAfterSwitch } from './BusinessPicker';

describe('switching business keeps you on the same screen', () => {
  it('lists and new-bill screens stay; a single record goes back to its list', () => {
    expect(pathAfterSwitch('/app/sales/invoices/new')).toBe('/app/sales/invoices/new');
    expect(pathAfterSwitch('/app/pos')).toBe('/app/pos');
    expect(pathAfterSwitch('/app/sales/invoices/3e9bc5be-12b3-4322-82ca-81ff7a71b8b5')).toBe('/app/sales/invoices');
    expect(pathAfterSwitch('/app/sales/invoices/3e9bc5be-12b3-4322-82ca-81ff7a71b8b5/edit')).toBe('/app/sales/invoices');
  });
});
