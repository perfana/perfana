import { formatValueWithUnit, toUnitScale, unitLabel } from './unit-format';

describe('formatValueWithUnit', () => {
  it('converts percentunit from 0.0-1.0 to percent', () => {
    expect(formatValueWithUnit(0.9, 'percentunit')).toBe('90%');
    expect(formatValueWithUnit(0.8567, 'percentunit')).toBe('85.67%');
  });

  it('renders percent without a space, other units with one', () => {
    expect(formatValueWithUnit(99.5, 'percent')).toBe('99.5%');
    expect(formatValueWithUnit(200, 'ms')).toBe('200 ms');
  });

  it('renders unitless codes as bare numbers without .00 padding', () => {
    expect(formatValueWithUnit(70, 'short')).toBe('70');
    expect(formatValueWithUnit(70, 'none')).toBe('70');
    expect(formatValueWithUnit(70)).toBe('70');
  });

  it('falls back to the raw code for unknown units', () => {
    expect(formatValueWithUnit(3, 'furlongs')).toBe('3 furlongs');
  });

  it('handles strings, null, and garbage', () => {
    expect(formatValueWithUnit('0.9', 'percentunit')).toBe('90%');
    expect(formatValueWithUnit(null, 'ms')).toBe('-');
    expect(formatValueWithUnit(undefined, 'ms')).toBe('-');
    expect(formatValueWithUnit('', 'ms')).toBe('-');
    expect(formatValueWithUnit('not-a-number', 'ms')).toBe('-');
  });

  it('handles zero and negative values', () => {
    expect(formatValueWithUnit(0, 'ms')).toBe('0 ms');
    expect(formatValueWithUnit(-0.5, 'percentunit')).toBe('-50%');
  });

  it('keeps precision for very small values', () => {
    expect(formatValueWithUnit(0.005, 'ms')).toBe('0.005 ms');
  });
});

describe('toUnitScale', () => {
  it('lifts percentunit out of its 0.0-1.0 storage into the scale it is read in', () => {
    expect(toUnitScale(0.42, 'percentunit')).toBeCloseTo(42, 10);
    expect(toUnitScale(1, 'percentunit')).toBe(100);
    expect(toUnitScale(0, 'percentunit')).toBe(0);
    expect(toUnitScale(-0.5, 'percentunit')).toBe(-50);
  });

  it('leaves every other unit alone — they are already in display scale', () => {
    expect(toUnitScale(1200.456, 'ms')).toBe(1200.456);
    // `percent` is ALREADY 0-100; scaling it too would render 42% as 4200%.
    expect(toUnitScale(42, 'percent')).toBe(42);
    expect(toUnitScale(42, 'reqps')).toBe(42);
    expect(toUnitScale(42, 'short')).toBe(42);
    expect(toUnitScale(42, 'furlongs')).toBe(42);
    expect(toUnitScale(42)).toBe(42);
  });
});

describe('unitLabel', () => {
  it('gives a known code its display label', () => {
    expect(unitLabel('ms')).toBe('ms');
    expect(unitLabel('percent')).toBe('%');
    expect(unitLabel('percentunit')).toBe('%');
    expect(unitLabel('reqps')).toBe('req/s');
    expect(unitLabel('mbytes')).toBe('MiB');
  });

  it('says nothing for the unitless codes and for no code at all', () => {
    // The heading chip is dropped on '', so a plain number stays under a plain heading.
    expect(unitLabel('none')).toBe('');
    expect(unitLabel('short')).toBe('');
    expect(unitLabel('')).toBe('');
    expect(unitLabel(undefined)).toBe('');
    expect(unitLabel(null)).toBe('');
  });

  it('says nothing for a code the table does not know, rather than echoing it', () => {
    // This is the deliberate difference from getUnit. The table covers ~50 of Grafana's
    // ~200 codes; labelling a report column "dateTimeAsIso" reads as a real unit to a
    // customer rather than as a gap in the table.
    expect(unitLabel('dateTimeAsIso')).toBe('');
    expect(unitLabel('currencyUSD')).toBe('');
    expect(unitLabel('furlongs')).toBe('');
  });

  it('never returns markup for a panel-supplied code, so the chip has nothing to escape', () => {
    // ds_metric_statistics.unit is whatever the Grafana panel carried.
    expect(unitLabel('<img src=x onerror=alert(1)>')).toBe('');
  });
});
