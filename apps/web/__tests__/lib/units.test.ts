/**
 * Unit tests for Unit Utilities
 *
 * Tests unit mapping and value formatting functions:
 * - getUnit: Maps Grafana unit IDs to unit metadata
 * - formatValueWithUnit: Formats numeric values with appropriate units
 *
 * Based on Grafana unit formats for consistency across performance metrics.
 */

import { getUnit, formatValueWithUnit } from '@/lib/units';

describe('Unit Utilities', () => {
  describe('getUnit()', () => {
    describe('Common Units', () => {
      it('should return percent unit', () => {
        // Act
        const unit = getUnit('percent');

        // Assert
        expect(unit).toEqual({
          name: '%',
          id: 'percent',
          format: '%',
        });
      });

      it('should return milliseconds unit', () => {
        // Act
        const unit = getUnit('ms');

        // Assert
        expect(unit).toEqual({
          name: 'milliseconds (ms)',
          id: 'ms',
          format: 'ms',
        });
      });

      it('should return bytes unit', () => {
        // Act
        const unit = getUnit('bytes');

        // Assert
        expect(unit).toEqual({
          name: 'bytes(IEC)',
          id: 'bytes',
          format: 'B',
        });
      });

      it('should return requests/sec unit', () => {
        // Act
        const unit = getUnit('reqps');

        // Assert
        expect(unit).toEqual({
          name: 'requests/sec (rps)',
          id: 'reqps',
          format: 'req/s',
        });
      });
    });

    describe('Time Units', () => {
      it('should return nanoseconds unit', () => {
        const unit = getUnit('ns');
        expect(unit.format).toBe('ns');
      });

      it('should return microseconds unit', () => {
        const unit = getUnit('µs');
        expect(unit.format).toBe('µs');
      });

      it('should return seconds unit', () => {
        const unit = getUnit('s');
        expect(unit.format).toBe('s');
      });

      it('should return minutes unit', () => {
        const unit = getUnit('m');
        expect(unit.format).toBe('m');
      });

      it('should return hours unit', () => {
        const unit = getUnit('h');
        expect(unit.format).toBe('h');
      });

      it('should return days unit', () => {
        const unit = getUnit('d');
        expect(unit.format).toBe('d');
      });
    });

    describe('Memory/Storage Units', () => {
      it('should return kibibytes unit', () => {
        const unit = getUnit('kbytes');
        expect(unit.format).toBe('KiB');
      });

      it('should return mebibytes unit', () => {
        const unit = getUnit('mbytes');
        expect(unit.format).toBe('MiB');
      });

      it('should return gibibytes unit', () => {
        const unit = getUnit('gbytes');
        expect(unit.format).toBe('GiB');
      });
    });

    describe('Rate Units', () => {
      it('should return bytes/sec unit', () => {
        const unit = getUnit('Bps');
        expect(unit.format).toBe('B/s');
      });

      it('should return ops/sec unit', () => {
        const unit = getUnit('ops');
        expect(unit.format).toBe('ops/s');
      });

      it('should return I/O ops/sec unit', () => {
        const unit = getUnit('iops');
        expect(unit.format).toBe('io/s');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty unit for undefined ID', () => {
        // Act
        const unit = getUnit(undefined);

        // Assert
        expect(unit).toEqual({
          name: '',
          id: '',
          format: '',
        });
      });

      it('should return fallback unit for unknown ID', () => {
        // Act
        const unit = getUnit('unknown-unit');

        // Assert
        expect(unit).toEqual({
          name: 'unknown-unit',
          id: 'unknown-unit',
          format: 'unknown-unit',
        });
      });

      it('should return empty unit for "none"', () => {
        // Act
        const unit = getUnit('none');

        // Assert
        expect(unit.format).toBe('');
      });

      it('should return empty unit for "short"', () => {
        // Act
        const unit = getUnit('short');

        // Assert
        expect(unit.format).toBe('');
      });
    });
  });

  describe('formatValueWithUnit()', () => {
    describe('Null/Undefined/Empty Values', () => {
      it('should return "-" for null', () => {
        expect(formatValueWithUnit(null)).toBe('-');
      });

      it('should return "-" for undefined', () => {
        expect(formatValueWithUnit(undefined)).toBe('-');
      });

      it('should return "-" for empty string', () => {
        expect(formatValueWithUnit('')).toBe('-');
      });

      it('should return "-" for NaN string', () => {
        expect(formatValueWithUnit('not-a-number')).toBe('-');
      });
    });

    describe('Basic Number Formatting', () => {
      it('should format zero without unit', () => {
        expect(formatValueWithUnit(0)).toBe('0');
      });

      it('should format whole numbers without decimals', () => {
        expect(formatValueWithUnit(100)).toBe('100');
        expect(formatValueWithUnit(42)).toBe('42');
        expect(formatValueWithUnit(1000)).toBe('1000');
      });

      it('should format decimal numbers with 2 decimal places', () => {
        expect(formatValueWithUnit(123.456)).toBe('123.46');
        expect(formatValueWithUnit(99.99)).toBe('99.99');
      });

      it('should handle negative numbers', () => {
        expect(formatValueWithUnit(-50)).toBe('-50');
        expect(formatValueWithUnit(-123.45)).toBe('-123.45');
      });
    });

    describe('Small Number Precision', () => {
      it('should show more precision for very small numbers', () => {
        // Numbers < 0.01 should show 5 decimal places
        expect(formatValueWithUnit(0.00123)).toBe('0.00123');
        expect(formatValueWithUnit(0.000456)).toBe('0.00046');
      });

      it('should handle numbers that round to zero', () => {
        // Very small numbers that would round to 0.00
        const result = formatValueWithUnit(0.00001);
        expect(result).toBe('0.00001');
      });
    });

    describe('String Number Conversion', () => {
      it('should parse string numbers', () => {
        expect(formatValueWithUnit('123')).toBe('123');
        expect(formatValueWithUnit('45.67')).toBe('45.67');
      });

      it('should parse negative string numbers', () => {
        expect(formatValueWithUnit('-100')).toBe('-100');
      });
    });

    describe('Units: Percentages', () => {
      it('should format percentage (0-100 scale)', () => {
        expect(formatValueWithUnit(75, 'percent')).toBe('75%');
        expect(formatValueWithUnit(100, 'percent')).toBe('100%');
        expect(formatValueWithUnit(0, 'percent')).toBe('0%');
      });

      it('should format percentunit (0.0-1.0 scale) by converting to 0-100', () => {
        expect(formatValueWithUnit(0.75, 'percentunit')).toBe('75%');
        expect(formatValueWithUnit(1.0, 'percentunit')).toBe('100%');
        expect(formatValueWithUnit(0.0, 'percentunit')).toBe('0%');
        expect(formatValueWithUnit(0.5, 'percentunit')).toBe('50%');
      });

      it('should handle percentunit with decimal precision', () => {
        expect(formatValueWithUnit(0.12345, 'percentunit')).toBe('12.35%');
        expect(formatValueWithUnit(0.999, 'percentunit')).toBe('99.9%');
      });
    });

    describe('Units: Time', () => {
      it('should format milliseconds', () => {
        expect(formatValueWithUnit(250, 'ms')).toBe('250 ms');
        expect(formatValueWithUnit(1500.5, 'ms')).toBe('1500.5 ms');
      });

      it('should format seconds', () => {
        expect(formatValueWithUnit(30, 's')).toBe('30 s');
        expect(formatValueWithUnit(45.67, 's')).toBe('45.67 s');
      });

      it('should format microseconds', () => {
        expect(formatValueWithUnit(1000, 'µs')).toBe('1000 µs');
      });

      it('should format nanoseconds', () => {
        expect(formatValueWithUnit(500000, 'ns')).toBe('500000 ns');
      });
    });

    describe('Units: Memory/Storage', () => {
      it('should format bytes', () => {
        expect(formatValueWithUnit(1024, 'bytes')).toBe('1024 B');
        expect(formatValueWithUnit(512.5, 'bytes')).toBe('512.5 B');
      });

      it('should format kilobytes', () => {
        expect(formatValueWithUnit(100, 'kbytes')).toBe('100 KiB');
      });

      it('should format megabytes', () => {
        expect(formatValueWithUnit(256, 'mbytes')).toBe('256 MiB');
      });

      it('should format gigabytes', () => {
        expect(formatValueWithUnit(8, 'gbytes')).toBe('8 GiB');
      });
    });

    describe('Units: Rates', () => {
      it('should format requests per second', () => {
        expect(formatValueWithUnit(1000, 'reqps')).toBe('1000 req/s');
        expect(formatValueWithUnit(250.5, 'reqps')).toBe('250.5 req/s');
      });

      it('should format operations per second', () => {
        expect(formatValueWithUnit(5000, 'ops')).toBe('5000 ops/s');
      });

      it('should format bytes per second', () => {
        expect(formatValueWithUnit(1024, 'Bps')).toBe('1024 B/s');
      });

      it('should format I/O operations per second', () => {
        expect(formatValueWithUnit(150, 'iops')).toBe('150 io/s');
      });
    });

    describe('Units: None/Short', () => {
      it('should format numbers without unit for "none"', () => {
        expect(formatValueWithUnit(100, 'none')).toBe('100');
        expect(formatValueWithUnit(123.45, 'none')).toBe('123.45');
      });

      it('should format numbers without unit for "short"', () => {
        expect(formatValueWithUnit(1000, 'short')).toBe('1000');
      });

      it('should format numbers without unit when unit is undefined', () => {
        expect(formatValueWithUnit(42)).toBe('42');
        expect(formatValueWithUnit(3.14)).toBe('3.14');
      });
    });

    describe('Unknown Units', () => {
      it('should use unknown unit as-is in format', () => {
        const result = formatValueWithUnit(100, 'custom-unit');
        expect(result).toBe('100 custom-unit');
      });
    });

    describe('Edge Cases and Boundary Values', () => {
      it('should handle very large numbers', () => {
        expect(formatValueWithUnit(1000000, 'bytes')).toBe('1000000 B');
      });

      it('should handle very small positive numbers with units', () => {
        expect(formatValueWithUnit(0.001, 's')).toBe('0.001 s');
      });

      it('should handle zero with various units', () => {
        expect(formatValueWithUnit(0, 'ms')).toBe('0 ms');
        expect(formatValueWithUnit(0, 'bytes')).toBe('0 B');
        expect(formatValueWithUnit(0, 'reqps')).toBe('0 req/s');
      });

      it('should round to 2 decimal places for mid-range numbers', () => {
        expect(formatValueWithUnit(123.456789, 'ms')).toBe('123.46 ms');
        expect(formatValueWithUnit(99.999, 's')).toBe('100 s');
      });

      it('should handle whole numbers that are exactly divisible', () => {
        expect(formatValueWithUnit(100.00, 'ms')).toBe('100 ms');
        expect(formatValueWithUnit(50.0, 's')).toBe('50 s');
      });
    });

    describe('Real-world Scenarios', () => {
      it('should format response times correctly', () => {
        expect(formatValueWithUnit(250.75, 'ms')).toBe('250.75 ms');
        expect(formatValueWithUnit(1234.567, 'ms')).toBe('1234.57 ms');
      });

      it('should format throughput correctly', () => {
        expect(formatValueWithUnit(1500, 'reqps')).toBe('1500 req/s');
        expect(formatValueWithUnit(250.5, 'reqps')).toBe('250.5 req/s');
      });

      it('should format memory usage correctly', () => {
        expect(formatValueWithUnit(512, 'mbytes')).toBe('512 MiB');
        expect(formatValueWithUnit(2.5, 'gbytes')).toBe('2.5 GiB');
      });

      it('should format CPU percentages correctly', () => {
        expect(formatValueWithUnit(0.85, 'percentunit')).toBe('85%');
        expect(formatValueWithUnit(0.123, 'percentunit')).toBe('12.3%');
      });

      it('should format success rates correctly', () => {
        expect(formatValueWithUnit(99.95, 'percent')).toBe('99.95%');
        expect(formatValueWithUnit(100, 'percent')).toBe('100%');
      });
    });
  });

  describe('Integration: getUnit + formatValueWithUnit', () => {
    it('should work together for complete formatting flow', () => {
      // Arrange
      const value = 1500;
      const unitId = 'ms';

      // Act
      const unit = getUnit(unitId);
      const formatted = formatValueWithUnit(value, unitId);

      // Assert
      expect(unit.format).toBe('ms');
      expect(formatted).toBe('1500 ms');
    });

    it('should handle unknown units gracefully', () => {
      // Arrange
      const value = 42;
      const unitId = 'unknown';

      // Act
      const unit = getUnit(unitId);
      const formatted = formatValueWithUnit(value, unitId);

      // Assert
      expect(unit.id).toBe('unknown');
      expect(formatted).toBe('42 unknown');
    });
  });
});
