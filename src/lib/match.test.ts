import { describe, expect, it } from 'vitest';
import { matchItem, matchParty } from './match';
import { emptyLine, emptyParty } from '../../shared/extract';

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, sku: '', barcode: '', hsn: '', ...extra }) as never;

describe('matching documents to records', () => {
  it('matches items by code, then by name with model numbers agreeing', () => {
    const items = [item('a', 'HP 680 Ink Cartridge (Black)', { hsn: '8443' }), item('b', 'Logitech M331 Silent Mouse', { sku: 'LOG-M331' }), item('c', 'A4 Copier Paper (500 sheets)')];
    expect(matchItem(items, { ...emptyLine('Mouse'), sku: 'log-m331' })?.id).toBe('b');
    expect(matchItem(items, emptyLine('Logitech M331 Silent Mouse Black'))?.id).toBe('b');
    expect(matchItem(items, emptyLine('HP 682 Black Ink'))).toBeNull();
    expect(matchItem(items, emptyLine('HP 680 Black Ink'))?.id).toBe('a');
    expect(matchItem(items, emptyLine('A4 copier paper'))?.id).toBe('c');
    expect(matchItem(items, emptyLine('Stapler'))).toBeNull();
  });
  it('matches parties by GSTIN, then by name ignoring Pvt Ltd', () => {
    const list = [{ id: 'r', name: 'Redington India Ltd.', gstin: '33AABCR1234D1Z8' }, { id: 'n', name: 'Priya', companyName: 'Nila Textiles', gstin: '' }];
    expect(matchParty(list, { ...emptyParty(), gstin: '33aabcr1234d1z8' })?.id).toBe('r');
    expect(matchParty(list, { ...emptyParty(), companyName: 'Redington (India) Limited' })?.id).toBe('r');
    expect(matchParty(list, { ...emptyParty(), companyName: 'Nila Textiles Pvt Ltd' })?.id).toBe('n');
    expect(matchParty(list, { ...emptyParty(), companyName: 'Chennai Paper Mart' })).toBeNull();
  });
});
