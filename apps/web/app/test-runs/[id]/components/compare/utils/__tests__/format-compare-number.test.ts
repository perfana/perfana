import { formatCompareNumber } from '../compare-utils';

describe('formatCompareNumber', () => {
  it('prints a bare number — the unit is in the panel header, not the cell', () => {
    expect(formatCompareNumber(1200.456, 'ms')).toBe('1,200.46');
    expect(formatCompareNumber(42, 'reqps')).toBe('42');
  });

  it('pins the locale so grouping does not follow the runner ICU default', () => {
    // en-US grouping, not '1.200,46' or '1 200,46'.
    expect(formatCompareNumber(1200.456, 'ms')).toBe('1,200.46');
    expect(formatCompareNumber(1200.456)).toBe('1,200.46');
  });

  it('still reads percentunit as 0-100, only without the sign', () => {
    expect(formatCompareNumber(0.42, 'percentunit')).toBe('42');
    // `percent` is already 0-100 and must not be scaled again.
    expect(formatCompareNumber(42, 'percent')).toBe('42');
  });

  it('says N/A for either kind of missing value, whatever the unit', () => {
    // The guard must stay in front of the conversion.
    expect(formatCompareNumber(undefined, 'percentunit')).toBe('N/A');
    expect(formatCompareNumber(null, 'ms')).toBe('N/A');
    expect(formatCompareNumber(null)).toBe('N/A');
    expect(formatCompareNumber(undefined)).toBe('N/A');
  });

  it('keeps zero and negatives as values, not as missing', () => {
    // 0 is falsy; a `!value` guard here would blank out every idle-CPU row.
    expect(formatCompareNumber(0, 'ms')).toBe('0');
    expect(formatCompareNumber(0, 'percentunit')).toBe('0');
    expect(formatCompareNumber(-12.5, 'ms')).toBe('-12.5');
    expect(formatCompareNumber(-0.5, 'percentunit')).toBe('-50');
  });

  it('groups thousands after the percentunit conversion, not before', () => {
    // 12.3456 stored -> 1,234.56. Grouping before scaling would print '12.35'.
    expect(formatCompareNumber(12.3456, 'percentunit')).toBe('1,234.56');
  });

  it('never leaks a unit code the table does not know into the output', () => {
    // yAxesFormat is whatever the Grafana panel carries; none of it reaches the cell now.
    expect(formatCompareNumber(3, 'furlongs')).toBe('3');
    expect(formatCompareNumber(3, 'none')).toBe('3');
    expect(formatCompareNumber(3, 'short')).toBe('3');
  });
});
