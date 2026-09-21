/**
 * Unit tests for the add-slo slo-formatters (the edit-slo twin has its own copy of
 * the same functions; both dialogs render the threshold chip from getUnitChipLabel).
 *
 * Tests:
 * - getUnitChipLabel: the trend evaluate type pins the chip to %/h; other types are unit-driven
 * - EVALUATE_TYPE_OPTIONS / EVALUATE_TYPE_LABELS / EVALUATE_TYPE_DESCRIPTIONS: carry the trend entry
 */

import {
  getUnitChipLabel,
  EVALUATE_TYPE_OPTIONS,
  EVALUATE_TYPE_LABELS,
  EVALUATE_TYPE_DESCRIPTIONS,
} from '../slo-formatters';

describe('getUnitChipLabel (add-slo)', () => {
  it('should return %/h for a trend SLO regardless of the panel unit or the typed value, and stay unit-driven otherwise', () => {
    const msPanel = { yAxesFormat: 'ms' } as unknown as Parameters<typeof getUnitChipLabel>[1];
    expect(getUnitChipLabel('', msPanel, 'trend')).toBe('%/h');
    expect(getUnitChipLabel('500ms', msPanel, 'trend')).toBe('%/h');
    expect(getUnitChipLabel('12', null, 'trend')).toBe('%/h');
    // Without the type, or with any other type, the chip still comes from the value/panel unit.
    expect(getUnitChipLabel('500', null)).toBeNull();
    expect(getUnitChipLabel('500', null, 'avg')).toBeNull();
    expect(getUnitChipLabel('500ms', null, 'avg')).toBeTruthy();

    // The dropdown, its label map and its description map all carry the entry the chip keys on.
    const trendOption = EVALUATE_TYPE_OPTIONS.find((o) => o.value === 'trend');
    expect(trendOption).toMatchObject({ value: 'trend', label: 'Trend' });
    expect(EVALUATE_TYPE_LABELS.trend).toBe('Trend');
    expect(EVALUATE_TYPE_DESCRIPTIONS.trend).toBe(trendOption?.description);
  });
});
