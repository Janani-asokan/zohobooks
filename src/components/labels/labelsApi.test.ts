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
  it('a new shop starts on the 2-up standard 50 × 25', () => {
    expect(sameGeom(stockFromSettings(ps), STOCK_PRESETS.find((x) => x.id === '4in-50x25x2')!.stock)).toBe(true);
  });
});
