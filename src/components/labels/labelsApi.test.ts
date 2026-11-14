import { describe, expect, it } from 'vitest';
import { sameGeom, settingsWithStock, stockFromSettings, turnFromSettings } from './labelsApi';
import { STOCK_PRESETS } from '../../../shared/labelEngine';
import { layoutProblems } from '../../../shared/labelLayout';
import { withPrintDefaults } from '../../../shared/printSettings';

describe('the shop’s default label stock', () => {
  const ps = withPrintDefaults(undefined);
  it('saves every built-in roll and A4 stock and reads it back exactly (so it shows by name on every device)', () => {
    for (const p of STOCK_PRESETS.filter((x) => x.stock.sheet !== 'letter' && x.stock.media === 'die-cut')) {
      const saved = settingsWithStock(ps, p.stock);
      expect(layoutProblems(saved.barcode.layout!), p.id).toEqual([]);
      expect(sameGeom(stockFromSettings(saved), p.stock), p.id).toBe(true);
    }
  });
  it('the 2-up standard 50 × 25 keeps its 4-inch roll, gap and turn', () => {
    const p = STOCK_PRESETS.find((x) => x.id === '4in-50x25x2')!.stock;
    const saved = settingsWithStock(ps, p, 90);
    expect(saved.barcode.layout).toMatchObject({ stock: 'roll', w: 50, h: 25, across: 2, rollMm: 104, gapY: 3, rotate: 90 });
    expect(saved.barcode.labelSize).toBe('50x25-2');
    expect(stockFromSettings(saved).rowGap).toBe(3);
    expect(turnFromSettings(saved)).toBe(90);
  });
  it('a new shop starts on the 3-inch roll, 2-up 38 × 25 (the TVS LP 46 Lite’s roll)', () => {
    expect(sameGeom(stockFromSettings(ps), STOCK_PRESETS.find((x) => x.id === '3in-38x25x2')!.stock)).toBe(true);
  });
  it('a shop that saved the 2-up 50 × 25 keeps it', () => {
    const old = withPrintDefaults({ barcode: { printer: 'label', labelSize: '50x25-2' } });
    expect(sameGeom(stockFromSettings(old), STOCK_PRESETS.find((x) => x.id === '4in-50x25x2')!.stock)).toBe(true);
  });
});

describe('label gaps survive being saved as the shop’s stock', () => {
  const ps = withPrintDefaults(undefined);
  const base = STOCK_PRESETS.find((x) => x.id === '3in-38x25x2')!.stock;
  it('keeps a no-gap roll at 0 mm between rows (older layouts without media still read as 3 mm)', () => {
    const back = stockFromSettings(settingsWithStock(ps, { ...base, gutter: 0, rowGap: 0, media: 'continuous' }));
    expect(back.rowGap).toBe(0); expect(back.gutter).toBe(0); expect(back.media).toBe('continuous');
    const old = settingsWithStock(ps, { ...base, rowGap: 0 }); delete old.barcode.layout!.media;
    expect(stockFromSettings(old).rowGap).toBe(3);
  });
  it('keeps a custom gap between labels across and between rows', () => {
    const back = stockFromSettings(settingsWithStock(ps, { ...base, gutter: 1.5, rowGap: 2.5 }));
    expect([back.gutter, back.rowGap, back.media]).toEqual([1.5, 2.5, 'die-cut']);
  });
});
