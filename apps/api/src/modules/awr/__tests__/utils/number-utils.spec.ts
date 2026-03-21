/**
 * Unit tests for number-utils
 *
 * Tests for parsing various number formats found in Oracle AWR reports:
 * - Standard numbers with commas
 * - Abbreviated numbers (K, M, G, T)
 * - Percentages
 * - Byte sizes
 * - Special values (N/A, null, etc.)
 */

import {
  parseAwrNumber,
  isSpecialValue,
  parsePercentage,
  parseBytes,
  bytesToMb,
  bytesToGb,
  parseInteger,
  parseIntegerRounded,
  parseRatio,
  formatNumber,
  formatAbbreviated,
  formatPercentage,
  isValidNumber,
  clamp,
  safeDivide,
} from '../../utils/number-utils';

describe('number-utils', () => {
  describe('parseAwrNumber', () => {
    describe('basic number parsing', () => {
      it('should parse simple integers', () => {
        expect(parseAwrNumber('123')).toBe(123);
        expect(parseAwrNumber('0')).toBe(0);
        expect(parseAwrNumber('999999')).toBe(999999);
      });

      it('should parse decimal numbers', () => {
        expect(parseAwrNumber('123.45')).toBeCloseTo(123.45, 2);
        expect(parseAwrNumber('0.5')).toBeCloseTo(0.5, 2);
        expect(parseAwrNumber('.75')).toBeCloseTo(0.75, 2);
      });

      it('should parse numbers with comma separators', () => {
        expect(parseAwrNumber('1,234')).toBe(1234);
        expect(parseAwrNumber('1,234,567')).toBe(1234567);
        expect(parseAwrNumber('1,234.56')).toBeCloseTo(1234.56, 2);
      });
    });

    describe('abbreviated number parsing', () => {
      it('should parse K (thousands) suffix', () => {
        expect(parseAwrNumber('1.5K')).toBe(1500);
        expect(parseAwrNumber('10K')).toBe(10000);
        expect(parseAwrNumber('1k')).toBe(1000);
      });

      it('should parse M (millions) suffix', () => {
        expect(parseAwrNumber('1M')).toBe(1000000);
        expect(parseAwrNumber('3.5M')).toBe(3500000);
        expect(parseAwrNumber('2.1m')).toBe(2100000);
      });

      it('should parse G (billions) suffix', () => {
        expect(parseAwrNumber('1G')).toBe(1000000000);
        expect(parseAwrNumber('2.5G')).toBe(2500000000);
        expect(parseAwrNumber('1g')).toBe(1000000000);
      });

      it('should parse T (trillions) suffix', () => {
        expect(parseAwrNumber('1T')).toBe(1000000000000);
        expect(parseAwrNumber('1.5T')).toBe(1500000000000);
        expect(parseAwrNumber('1t')).toBe(1000000000000);
      });

      it('should parse B (billions) suffix', () => {
        expect(parseAwrNumber('1B')).toBe(1000000000);
        expect(parseAwrNumber('2.5B')).toBe(2500000000);
      });
    });

    describe('negative number parsing', () => {
      it('should parse negative numbers with minus sign', () => {
        expect(parseAwrNumber('-123')).toBe(-123);
        expect(parseAwrNumber('-1.5K')).toBe(-1500);
        expect(parseAwrNumber('-1,234.56')).toBeCloseTo(-1234.56, 2);
      });

      it('should parse accounting format (parentheses)', () => {
        expect(parseAwrNumber('(123)')).toBe(-123);
        expect(parseAwrNumber('(1,234.56)')).toBeCloseTo(-1234.56, 2);
      });

      it('should respect allowNegative option', () => {
        expect(parseAwrNumber('-123', { allowNegative: false })).toBe(123);
        expect(parseAwrNumber('(456)', { allowNegative: false })).toBe(456);
      });
    });

    describe('scientific notation', () => {
      it('should parse scientific notation', () => {
        expect(parseAwrNumber('1.23E+06')).toBe(1230000);
        expect(parseAwrNumber('1.5e3')).toBe(1500);
        expect(parseAwrNumber('2.5E-3')).toBeCloseTo(0.0025, 2);
      });
    });

    describe('null/undefined/empty handling', () => {
      it('should return default value for null', () => {
        expect(parseAwrNumber(null)).toBe(0);
        expect(parseAwrNumber(null, { defaultValue: -1 })).toBe(-1);
      });

      it('should return default value for undefined', () => {
        expect(parseAwrNumber(undefined)).toBe(0);
        expect(parseAwrNumber(undefined, { defaultValue: 99 })).toBe(99);
      });

      it('should return default value for empty string', () => {
        expect(parseAwrNumber('')).toBe(0);
        expect(parseAwrNumber('   ')).toBe(0);
      });

      it('should return NaN for empty string when nullOnEmpty is true', () => {
        expect(parseAwrNumber('', { nullOnEmpty: true })).toBeNaN();
      });
    });

    describe('special values', () => {
      it('should return default for N/A values', () => {
        expect(parseAwrNumber('N/A')).toBe(0);
        expect(parseAwrNumber('n/a')).toBe(0);
        expect(parseAwrNumber('NA')).toBe(0);
      });

      it('should return default for other special values', () => {
        expect(parseAwrNumber('-')).toBe(0);
        expect(parseAwrNumber('--')).toBe(0);
        expect(parseAwrNumber('null')).toBe(0);
        expect(parseAwrNumber('none')).toBe(0);
        expect(parseAwrNumber('unknown')).toBe(0);
        expect(parseAwrNumber('.')).toBe(0);
        expect(parseAwrNumber('*')).toBe(0);
        expect(parseAwrNumber('#')).toBe(0);
      });
    });

    describe('custom default values', () => {
      it('should use custom default value when parsing fails', () => {
        expect(parseAwrNumber('invalid', { defaultValue: 42 })).toBe(42);
        expect(parseAwrNumber('N/A', { defaultValue: -999 })).toBe(-999);
      });
    });
  });

  describe('isSpecialValue', () => {
    it('should identify N/A variations', () => {
      expect(isSpecialValue('N/A')).toBe(true);
      expect(isSpecialValue('n/a')).toBe(true);
      expect(isSpecialValue('NA')).toBe(true);
      expect(isSpecialValue('na')).toBe(true);
    });

    it('should identify dash values', () => {
      expect(isSpecialValue('-')).toBe(true);
      expect(isSpecialValue('--')).toBe(true);
      expect(isSpecialValue('---')).toBe(true);
    });

    it('should identify other special values', () => {
      expect(isSpecialValue('null')).toBe(true);
      expect(isSpecialValue('NULL')).toBe(true);
      expect(isSpecialValue('none')).toBe(true);
      expect(isSpecialValue('unknown')).toBe(true);
      expect(isSpecialValue('.')).toBe(true);
      expect(isSpecialValue('*')).toBe(true);
      expect(isSpecialValue('#')).toBe(true);
    });

    it('should return false for normal values', () => {
      expect(isSpecialValue('123')).toBe(false);
      expect(isSpecialValue('1.5K')).toBe(false);
      expect(isSpecialValue('0')).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(isSpecialValue('  N/A  ')).toBe(true);
      expect(isSpecialValue('  -  ')).toBe(true);
    });
  });

  describe('parsePercentage', () => {
    it('should parse percentages with % symbol', () => {
      expect(parsePercentage('95.5%')).toBeCloseTo(95.5, 2);
      expect(parsePercentage('100%')).toBe(100);
      expect(parsePercentage('0%')).toBe(0);
    });

    it('should parse percentages without % symbol', () => {
      expect(parsePercentage('95.5')).toBeCloseTo(95.5, 2);
      expect(parsePercentage('100')).toBe(100);
    });

    it('should treat small values as-is (no ratio auto-conversion)', () => {
      // AWR reports express percentages as percentages, not ratios.
      // ".3" means 0.3%, not 30%. The old heuristic multiplied by 100.
      expect(parsePercentage('0.955')).toBeCloseTo(0.955, 3);
      expect(parsePercentage('.98')).toBeCloseTo(0.98, 2);
      expect(parsePercentage('0.5')).toBeCloseTo(0.5, 2);
      expect(parsePercentage('.3')).toBeCloseTo(0.3, 2);
    });

    it('should not convert values > 1 without % symbol', () => {
      expect(parsePercentage('50')).toBe(50);
      expect(parsePercentage('95.5')).toBeCloseTo(95.5, 2);
    });

    it('should handle null/undefined', () => {
      expect(parsePercentage(null)).toBe(0);
      expect(parsePercentage(undefined)).toBe(0);
      expect(parsePercentage(null, { defaultValue: -1 })).toBe(-1);
    });

    it('should handle special values', () => {
      expect(parsePercentage('N/A')).toBe(0);
      expect(parsePercentage('-')).toBe(0);
    });
  });

  describe('parseBytes', () => {
    it('should parse bytes without unit', () => {
      expect(parseBytes('1024')).toBe(1024);
      expect(parseBytes('0')).toBe(0);
    });

    it('should parse KB/K units', () => {
      expect(parseBytes('1KB')).toBe(1024);
      expect(parseBytes('1K')).toBe(1024);
      expect(parseBytes('1.5KB')).toBe(1536);
    });

    it('should parse MB/M units', () => {
      expect(parseBytes('1MB')).toBe(1048576);
      expect(parseBytes('1M')).toBe(1048576);
      expect(parseBytes('2MB')).toBe(2097152);
    });

    it('should parse GB/G units', () => {
      expect(parseBytes('1GB')).toBe(1073741824);
      expect(parseBytes('1G')).toBe(1073741824);
      expect(parseBytes('1.5GB')).toBe(1610612736);
    });

    it('should parse TB/T units', () => {
      expect(parseBytes('1TB')).toBe(1099511627776);
      expect(parseBytes('1T')).toBe(1099511627776);
    });

    it('should parse with space between number and unit', () => {
      expect(parseBytes('1 GB')).toBe(1073741824);
      expect(parseBytes('512 MB')).toBe(536870912);
    });

    it('should use default unit when no unit provided', () => {
      expect(parseBytes('1024', 'KB')).toBe(1048576);
      expect(parseBytes('1', 'GB')).toBe(1073741824);
    });

    it('should handle null/undefined', () => {
      expect(parseBytes(null)).toBe(0);
      expect(parseBytes(undefined)).toBe(0);
    });

    it('should handle special values', () => {
      expect(parseBytes('N/A')).toBe(0);
      expect(parseBytes('-')).toBe(0);
    });
  });

  describe('bytesToMb', () => {
    it('should convert bytes to megabytes', () => {
      expect(bytesToMb(1048576)).toBe(1);
      expect(bytesToMb(2097152)).toBe(2);
      expect(bytesToMb(524288)).toBe(0.5);
    });

    it('should handle zero', () => {
      expect(bytesToMb(0)).toBe(0);
    });
  });

  describe('bytesToGb', () => {
    it('should convert bytes to gigabytes', () => {
      expect(bytesToGb(1073741824)).toBe(1);
      expect(bytesToGb(2147483648)).toBe(2);
      expect(bytesToGb(536870912)).toBe(0.5);
    });

    it('should handle zero', () => {
      expect(bytesToGb(0)).toBe(0);
    });
  });

  describe('parseInteger', () => {
    it('should parse and truncate decimal values', () => {
      expect(parseInteger('123.9')).toBe(123);
      expect(parseInteger('123.1')).toBe(123);
      expect(parseInteger('0.99')).toBe(0);
    });

    it('should parse integer values directly', () => {
      expect(parseInteger('123')).toBe(123);
      expect(parseInteger('1,234')).toBe(1234);
    });

    it('should use default value for invalid input', () => {
      expect(parseInteger('invalid')).toBe(0);
      expect(parseInteger('invalid', 99)).toBe(99);
    });
  });

  describe('parseIntegerRounded', () => {
    it('should parse and round decimal values', () => {
      expect(parseIntegerRounded('123.9')).toBe(124);
      expect(parseIntegerRounded('123.4')).toBe(123);
      expect(parseIntegerRounded('123.5')).toBe(124);
    });

    it('should use default value for invalid input', () => {
      expect(parseIntegerRounded('invalid')).toBe(0);
      expect(parseIntegerRounded('invalid', 99)).toBe(99);
    });
  });

  describe('parseRatio', () => {
    it('should parse ratio values (0-1)', () => {
      expect(parseRatio('0.5')).toBeCloseTo(0.5, 2);
      expect(parseRatio('0.95')).toBeCloseTo(0.95, 2);
      expect(parseRatio('1')).toBe(1);
    });

    it('should convert percentage to ratio when value > 1', () => {
      expect(parseRatio('50')).toBeCloseTo(0.5, 2);
      expect(parseRatio('95')).toBeCloseTo(0.95, 2);
      expect(parseRatio('100')).toBe(1);
    });

    it('should convert ratio to percentage when asPercentage is true', () => {
      expect(parseRatio('0.5', true)).toBe(50);
      expect(parseRatio('0.95', true)).toBe(95);
      expect(parseRatio('1', true)).toBe(100);
    });

    it('should return 0 for invalid values', () => {
      expect(parseRatio('invalid')).toBe(0);
      expect(parseRatio(null)).toBe(0);
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with thousands separators', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56');
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('should respect decimal places', () => {
      expect(formatNumber(123.456789, 2)).toBe('123.46');
      expect(formatNumber(123.456789, 0)).toBe('123');
      expect(formatNumber(123.456789, 4)).toBe('123.4568');
    });

    it('should handle NaN', () => {
      expect(formatNumber(NaN)).toBe('N/A');
    });

    it('should handle zero', () => {
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('formatAbbreviated', () => {
    it('should format thousands with K suffix', () => {
      expect(formatAbbreviated(1500)).toBe('1.5K');
      expect(formatAbbreviated(10000)).toBe('10.0K');
    });

    it('should format millions with M suffix', () => {
      expect(formatAbbreviated(1500000)).toBe('1.5M');
      expect(formatAbbreviated(10000000)).toBe('10.0M');
    });

    it('should format billions with G suffix', () => {
      expect(formatAbbreviated(1500000000)).toBe('1.5G');
      expect(formatAbbreviated(10000000000)).toBe('10.0G');
    });

    it('should format trillions with T suffix', () => {
      expect(formatAbbreviated(1500000000000)).toBe('1.5T');
    });

    it('should not abbreviate small numbers', () => {
      expect(formatAbbreviated(123)).toBe('123.0');
      expect(formatAbbreviated(999)).toBe('999.0');
    });

    it('should handle negative numbers', () => {
      expect(formatAbbreviated(-1500)).toBe('-1.5K');
      expect(formatAbbreviated(-1500000)).toBe('-1.5M');
    });

    it('should respect decimal places', () => {
      expect(formatAbbreviated(1234, 2)).toBe('1.23K');
      expect(formatAbbreviated(1234, 0)).toBe('1K');
    });

    it('should handle NaN', () => {
      expect(formatAbbreviated(NaN)).toBe('N/A');
    });
  });

  describe('formatPercentage', () => {
    it('should format percentage values', () => {
      expect(formatPercentage(95.5)).toBe('95.5%');
      expect(formatPercentage(100)).toBe('100.0%');
      expect(formatPercentage(0)).toBe('0.0%');
    });

    it('should respect decimal places', () => {
      expect(formatPercentage(95.555, 2)).toBe('95.56%');
      expect(formatPercentage(95.555, 0)).toBe('96%');
    });

    it('should handle NaN', () => {
      expect(formatPercentage(NaN)).toBe('N/A');
    });
  });

  describe('isValidNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isValidNumber(123)).toBe(true);
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(-456)).toBe(true);
      expect(isValidNumber(1.5)).toBe(true);
    });

    it('should return false for NaN', () => {
      expect(isValidNumber(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isValidNumber(Infinity)).toBe(false);
      expect(isValidNumber(-Infinity)).toBe(false);
    });
  });

  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(0, 0, 100)).toBe(0);
      expect(clamp(100, 0, 100)).toBe(100);
    });

    it('should clamp to minimum', () => {
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(-100, 0, 100)).toBe(0);
    });

    it('should clamp to maximum', () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(1000, 0, 100)).toBe(100);
    });

    it('should handle negative ranges', () => {
      expect(clamp(-50, -100, -10)).toBe(-50);
      expect(clamp(-200, -100, -10)).toBe(-100);
      expect(clamp(0, -100, -10)).toBe(-10);
    });
  });

  describe('safeDivide', () => {
    it('should perform normal division', () => {
      expect(safeDivide(10, 2)).toBe(5);
      expect(safeDivide(100, 4)).toBe(25);
      expect(safeDivide(1, 3)).toBeCloseTo(0.333, 2);
    });

    it('should return default for division by zero', () => {
      expect(safeDivide(10, 0)).toBe(0);
      expect(safeDivide(10, 0, -1)).toBe(-1);
    });

    it('should return default for NaN denominator', () => {
      expect(safeDivide(10, NaN)).toBe(0);
      expect(safeDivide(10, NaN, 99)).toBe(99);
    });

    it('should handle zero numerator', () => {
      expect(safeDivide(0, 10)).toBe(0);
    });

    it('should handle negative numbers', () => {
      expect(safeDivide(-10, 2)).toBe(-5);
      expect(safeDivide(10, -2)).toBe(-5);
      expect(safeDivide(-10, -2)).toBe(5);
    });
  });
});
