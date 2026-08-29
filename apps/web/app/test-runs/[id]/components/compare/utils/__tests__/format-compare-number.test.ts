import { formatCompareNumber } from '../compare-utils';

describe('formatCompareNumber', () => {
  it('appends the panel unit, spaced', () => {
    expect(formatCompareNumber(1200.456, 'ms')).toBe('1,200.46 ms');
    expect(formatCompareNumber(42, 'reqps')).toBe('42 req/s');
  });

  it('reads percentunit as 0-100% and hugs the sign', () => {
    expect(formatCompareNumber(0.42, 'percentunit')).toBe('42%');
    expect(formatCompareNumber(42, 'percent')).toBe('42%');
  });

  it('leaves a unitless value exactly as it rendered before', () => {
    expect(formatCompareNumber(1200.456)).toBe('1,200.46');
    expect(formatCompareNumber(12, 'short')).toBe('12');
    expect(formatCompareNumber(null, 'ms')).toBe('N/A');
  });
});
