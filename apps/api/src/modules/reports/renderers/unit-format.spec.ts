import { formatValueWithUnit } from './unit-format';

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
