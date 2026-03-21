/**
 * Unit tests for time-utils
 *
 * Tests for parsing various time formats found in Oracle AWR reports:
 * - Plain numbers with unit suffixes (ms, s, min, h)
 * - Duration strings (1h 30m 45s, 01:30:45)
 * - Oracle timestamps (DD-MON-YY HH:MI:SS)
 * - Time conversions and formatting
 */

import {
  parseTimeToSeconds,
  convertFromSeconds,
  convertTime,
  secondsToMs,
  msToSeconds,
  secondsToMinutes,
  minutesToSeconds,
  secondsToHours,
  centisecondsToSeconds,
  parseAwrTimestamp,
  calculateElapsedMinutes,
  formatDuration,
  formatTimeAuto,
  formatMs,
  isValidTime,
  ensurePositiveTime,
} from '../../utils/time-utils';

describe('time-utils', () => {
  describe('parseTimeToSeconds', () => {
    describe('basic number parsing', () => {
      it('should parse plain numbers as seconds by default', () => {
        expect(parseTimeToSeconds('123')).toBe(123);
        expect(parseTimeToSeconds('0')).toBe(0);
        expect(parseTimeToSeconds('1.5')).toBeCloseTo(1.5, 2);
      });

      it('should parse numbers with comma separators', () => {
        expect(parseTimeToSeconds('1,234')).toBe(1234);
        expect(parseTimeToSeconds('1,234.56')).toBeCloseTo(1234.56, 2);
      });
    });

    describe('unit suffix parsing', () => {
      it('should parse microseconds (us)', () => {
        expect(parseTimeToSeconds('1000us')).toBeCloseTo(0.001, 2);
        expect(parseTimeToSeconds('500 usec')).toBeCloseTo(0.0005, 2);
        expect(parseTimeToSeconds('1000000us')).toBe(1);
      });

      it('should parse milliseconds (ms)', () => {
        expect(parseTimeToSeconds('500ms')).toBeCloseTo(0.5, 2);
        expect(parseTimeToSeconds('1000ms')).toBe(1);
        expect(parseTimeToSeconds('2500 msec')).toBeCloseTo(2.5, 2);
      });

      it('should parse seconds (s)', () => {
        expect(parseTimeToSeconds('30s')).toBe(30);
        expect(parseTimeToSeconds('1.5 sec')).toBeCloseTo(1.5, 2);
        expect(parseTimeToSeconds('60 seconds')).toBe(60);
      });

      it('should parse minutes (m, min)', () => {
        expect(parseTimeToSeconds('2m')).toBe(120);
        expect(parseTimeToSeconds('1.5 min')).toBe(90);
        expect(parseTimeToSeconds('5 minutes')).toBe(300);
      });

      it('should parse hours (h, hr)', () => {
        expect(parseTimeToSeconds('1h')).toBe(3600);
        expect(parseTimeToSeconds('2.5 hr')).toBe(9000);
        expect(parseTimeToSeconds('1 hour')).toBe(3600);
      });

      it('should parse days (d)', () => {
        expect(parseTimeToSeconds('1d')).toBe(86400);
        expect(parseTimeToSeconds('0.5 day')).toBe(43200);
        expect(parseTimeToSeconds('2 days')).toBe(172800);
      });

      it('should be case insensitive', () => {
        expect(parseTimeToSeconds('500MS')).toBeCloseTo(0.5, 2);
        expect(parseTimeToSeconds('30S')).toBe(30);
        expect(parseTimeToSeconds('2M')).toBe(120);
      });
    });

    describe('duration string parsing', () => {
      it('should parse HH:MM:SS format', () => {
        expect(parseTimeToSeconds('01:30:45')).toBe(5445);
        expect(parseTimeToSeconds('00:01:00')).toBe(60);
        expect(parseTimeToSeconds('02:00:00')).toBe(7200);
      });

      it('should parse HH:MM:SS.fraction format', () => {
        expect(parseTimeToSeconds('00:00:01.5')).toBeCloseTo(1.5, 2);
        expect(parseTimeToSeconds('01:00:00.123')).toBeCloseTo(3600.123, 2);
      });

      it('should parse MM:SS format', () => {
        expect(parseTimeToSeconds('05:30')).toBe(330);
        expect(parseTimeToSeconds('01:00')).toBe(60);
        expect(parseTimeToSeconds('10:45')).toBe(645);
      });

      it('should parse Xh Ym Zs format', () => {
        expect(parseTimeToSeconds('1h 30m')).toBe(5400);
        expect(parseTimeToSeconds('1h 30m 45s')).toBe(5445);
        expect(parseTimeToSeconds('2hours 15minutes')).toBe(8100);
        expect(parseTimeToSeconds('45s')).toBe(45);
      });

      it('should parse partial duration strings', () => {
        expect(parseTimeToSeconds('2h')).toBe(7200);
        expect(parseTimeToSeconds('30m')).toBe(1800);
        expect(parseTimeToSeconds('1h 15s')).toBe(3615);
      });
    });

    describe('null/undefined/empty handling', () => {
      it('should return default value for null', () => {
        expect(parseTimeToSeconds(null)).toBe(0);
        expect(parseTimeToSeconds(null, { defaultValue: -1 })).toBe(-1);
      });

      it('should return default value for undefined', () => {
        expect(parseTimeToSeconds(undefined)).toBe(0);
        expect(parseTimeToSeconds(undefined, { defaultValue: 99 })).toBe(99);
      });

      it('should return default value for empty string', () => {
        expect(parseTimeToSeconds('')).toBe(0);
        expect(parseTimeToSeconds('   ')).toBe(0);
      });
    });

    describe('special values', () => {
      it('should return default for N/A values', () => {
        expect(parseTimeToSeconds('N/A')).toBe(0);
        expect(parseTimeToSeconds('n/a')).toBe(0);
      });

      it('should return default for other special values', () => {
        expect(parseTimeToSeconds('-')).toBe(0);
        expect(parseTimeToSeconds('null')).toBe(0);
        expect(parseTimeToSeconds('none')).toBe(0);
      });
    });

    describe('default unit option', () => {
      it('should use specified default unit', () => {
        expect(parseTimeToSeconds('500', { defaultUnit: 'milliseconds' })).toBeCloseTo(0.5, 2);
        expect(parseTimeToSeconds('2', { defaultUnit: 'minutes' })).toBe(120);
        expect(parseTimeToSeconds('1', { defaultUnit: 'hours' })).toBe(3600);
      });
    });
  });

  describe('convertFromSeconds', () => {
    it('should convert to microseconds', () => {
      expect(convertFromSeconds(1, 'microseconds')).toBe(1000000);
      expect(convertFromSeconds(0.001, 'microseconds')).toBeCloseTo(1000, 2);
    });

    it('should convert to milliseconds', () => {
      expect(convertFromSeconds(1, 'milliseconds')).toBe(1000);
      expect(convertFromSeconds(0.5, 'milliseconds')).toBe(500);
    });

    it('should convert to seconds (identity)', () => {
      expect(convertFromSeconds(60, 'seconds')).toBe(60);
    });

    it('should convert to minutes', () => {
      expect(convertFromSeconds(120, 'minutes')).toBe(2);
      expect(convertFromSeconds(90, 'minutes')).toBe(1.5);
    });

    it('should convert to hours', () => {
      expect(convertFromSeconds(3600, 'hours')).toBe(1);
      expect(convertFromSeconds(7200, 'hours')).toBe(2);
    });

    it('should convert to days', () => {
      expect(convertFromSeconds(86400, 'days')).toBe(1);
      expect(convertFromSeconds(172800, 'days')).toBe(2);
    });
  });

  describe('convertTime', () => {
    it('should convert between any units', () => {
      expect(convertTime(1, 'hours', 'minutes')).toBe(60);
      expect(convertTime(1, 'minutes', 'seconds')).toBe(60);
      expect(convertTime(1000, 'milliseconds', 'seconds')).toBe(1);
      expect(convertTime(1, 'days', 'hours')).toBe(24);
    });

    it('should handle same unit conversion', () => {
      expect(convertTime(100, 'seconds', 'seconds')).toBe(100);
      expect(convertTime(50, 'minutes', 'minutes')).toBe(50);
    });
  });

  describe('secondsToMs', () => {
    it('should convert seconds to milliseconds', () => {
      expect(secondsToMs(1)).toBe(1000);
      expect(secondsToMs(0.5)).toBe(500);
      expect(secondsToMs(2.5)).toBe(2500);
    });

    it('should handle zero', () => {
      expect(secondsToMs(0)).toBe(0);
    });
  });

  describe('msToSeconds', () => {
    it('should convert milliseconds to seconds', () => {
      expect(msToSeconds(1000)).toBe(1);
      expect(msToSeconds(500)).toBe(0.5);
      expect(msToSeconds(2500)).toBe(2.5);
    });

    it('should handle zero', () => {
      expect(msToSeconds(0)).toBe(0);
    });
  });

  describe('secondsToMinutes', () => {
    it('should convert seconds to minutes', () => {
      expect(secondsToMinutes(60)).toBe(1);
      expect(secondsToMinutes(90)).toBe(1.5);
      expect(secondsToMinutes(300)).toBe(5);
    });

    it('should handle zero', () => {
      expect(secondsToMinutes(0)).toBe(0);
    });
  });

  describe('minutesToSeconds', () => {
    it('should convert minutes to seconds', () => {
      expect(minutesToSeconds(1)).toBe(60);
      expect(minutesToSeconds(1.5)).toBe(90);
      expect(minutesToSeconds(5)).toBe(300);
    });

    it('should handle zero', () => {
      expect(minutesToSeconds(0)).toBe(0);
    });
  });

  describe('secondsToHours', () => {
    it('should convert seconds to hours', () => {
      expect(secondsToHours(3600)).toBe(1);
      expect(secondsToHours(5400)).toBe(1.5);
      expect(secondsToHours(7200)).toBe(2);
    });

    it('should handle zero', () => {
      expect(secondsToHours(0)).toBe(0);
    });
  });

  describe('centisecondsToSeconds', () => {
    it('should convert centiseconds to seconds', () => {
      expect(centisecondsToSeconds(100)).toBe(1);
      expect(centisecondsToSeconds(50)).toBe(0.5);
      expect(centisecondsToSeconds(250)).toBe(2.5);
    });

    it('should handle zero', () => {
      expect(centisecondsToSeconds(0)).toBe(0);
    });
  });

  describe('parseAwrTimestamp', () => {
    it('should parse DD-MON-YY format', () => {
      const date = parseAwrTimestamp('15-JAN-24 10:30:45');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(0); // January
      expect(date!.getDate()).toBe(15);
      expect(date!.getHours()).toBe(10);
      expect(date!.getMinutes()).toBe(30);
      expect(date!.getSeconds()).toBe(45);
    });

    it('should parse DD-MON-YYYY format', () => {
      const date = parseAwrTimestamp('15-JAN-2024 10:30:45');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(0);
      expect(date!.getDate()).toBe(15);
    });

    it('should handle different months', () => {
      expect(parseAwrTimestamp('01-FEB-24 00:00:00')!.getMonth()).toBe(1);
      expect(parseAwrTimestamp('15-MAR-24 00:00:00')!.getMonth()).toBe(2);
      expect(parseAwrTimestamp('20-APR-24 00:00:00')!.getMonth()).toBe(3);
      expect(parseAwrTimestamp('25-MAY-24 00:00:00')!.getMonth()).toBe(4);
      expect(parseAwrTimestamp('10-JUN-24 00:00:00')!.getMonth()).toBe(5);
      expect(parseAwrTimestamp('05-JUL-24 00:00:00')!.getMonth()).toBe(6);
      expect(parseAwrTimestamp('18-AUG-24 00:00:00')!.getMonth()).toBe(7);
      expect(parseAwrTimestamp('22-SEP-24 00:00:00')!.getMonth()).toBe(8);
      expect(parseAwrTimestamp('31-OCT-24 00:00:00')!.getMonth()).toBe(9);
      expect(parseAwrTimestamp('15-NOV-24 00:00:00')!.getMonth()).toBe(10);
      expect(parseAwrTimestamp('25-DEC-24 00:00:00')!.getMonth()).toBe(11);
    });

    it('should handle 2-digit years in the 2000s', () => {
      const date = parseAwrTimestamp('01-JAN-24 00:00:00');
      expect(date!.getFullYear()).toBe(2024);

      const date2 = parseAwrTimestamp('01-JAN-00 00:00:00');
      expect(date2!.getFullYear()).toBe(2000);

      const date3 = parseAwrTimestamp('01-JAN-49 00:00:00');
      expect(date3!.getFullYear()).toBe(2049);
    });

    it('should handle 2-digit years in the 1900s', () => {
      const date = parseAwrTimestamp('01-JAN-99 00:00:00');
      expect(date!.getFullYear()).toBe(1999);

      const date2 = parseAwrTimestamp('01-JAN-50 00:00:00');
      expect(date2!.getFullYear()).toBe(1950);
    });

    it('should be case insensitive for months', () => {
      const date1 = parseAwrTimestamp('15-jan-24 10:30:45');
      const date2 = parseAwrTimestamp('15-JAN-24 10:30:45');
      const date3 = parseAwrTimestamp('15-Jan-24 10:30:45');

      expect(date1!.getMonth()).toBe(date2!.getMonth());
      expect(date2!.getMonth()).toBe(date3!.getMonth());
    });

    it('should parse ISO format as fallback', () => {
      const date = parseAwrTimestamp('2024-01-15T10:30:45Z');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
    });

    it('should return null for null input', () => {
      expect(parseAwrTimestamp(null)).toBeNull();
      expect(parseAwrTimestamp(undefined)).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(parseAwrTimestamp('invalid')).toBeNull();
      expect(parseAwrTimestamp('not-a-date')).toBeNull();
    });
  });

  describe('calculateElapsedMinutes', () => {
    it('should calculate elapsed minutes between timestamps', () => {
      const start = '15-JAN-24 10:00:00';
      const end = '15-JAN-24 10:30:00';
      expect(calculateElapsedMinutes(start, end)).toBe(30);
    });

    it('should work with Date objects', () => {
      const start = new Date(2024, 0, 15, 10, 0, 0);
      const end = new Date(2024, 0, 15, 11, 30, 0);
      expect(calculateElapsedMinutes(start, end)).toBe(90);
    });

    it('should work with mixed string and Date', () => {
      const start = '15-JAN-24 10:00:00';
      const end = new Date(2024, 0, 15, 11, 0, 0);
      expect(calculateElapsedMinutes(start, end)).toBe(60);
    });

    it('should return 0 for null inputs', () => {
      expect(calculateElapsedMinutes(null, null)).toBe(0);
      expect(calculateElapsedMinutes(null, '15-JAN-24 10:00:00')).toBe(0);
      expect(calculateElapsedMinutes('15-JAN-24 10:00:00', null)).toBe(0);
    });

    it('should handle multi-hour differences', () => {
      const start = '15-JAN-24 10:00:00';
      const end = '15-JAN-24 15:30:00';
      expect(calculateElapsedMinutes(start, end)).toBe(330);
    });
  });

  describe('formatDuration', () => {
    describe('compact format', () => {
      it('should format sub-second values', () => {
        expect(formatDuration(0.5)).toBe('500.0ms');
        expect(formatDuration(0.001)).toBe('1.0ms');
        expect(formatDuration(0.0001)).toBe('100us');
      });

      it('should format seconds', () => {
        expect(formatDuration(30)).toBe('30.0s');
        expect(formatDuration(59.5)).toBe('59.5s');
      });

      it('should format minutes and seconds', () => {
        expect(formatDuration(90)).toBe('1m 30s');
        expect(formatDuration(125)).toBe('2m 5s');
      });

      it('should format hours, minutes and seconds', () => {
        expect(formatDuration(3661)).toBe('1h 1m 1s');
        expect(formatDuration(5400)).toBe('1h 30m');
      });

      it('should format days', () => {
        expect(formatDuration(86400)).toBe('1d');
        expect(formatDuration(90061)).toBe('1d 1h 1m 1s');
      });

      it('should handle negative values', () => {
        expect(formatDuration(-30)).toBe('-30.0s');
        expect(formatDuration(-3661)).toBe('-1h 1m 1s');
      });
    });

    describe('non-compact format', () => {
      it('should use full words', () => {
        expect(formatDuration(3661, false)).toBe('1 hour, 1 minute, 1 second');
        expect(formatDuration(7322, false)).toBe('2 hours, 2 minutes, 2 seconds');
      });

      it('should use singular forms appropriately', () => {
        expect(formatDuration(86400, false)).toBe('1 day');
        expect(formatDuration(172800, false)).toBe('2 days');
      });
    });

    it('should handle NaN and Infinity', () => {
      expect(formatDuration(NaN)).toBe('N/A');
      expect(formatDuration(Infinity)).toBe('N/A');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0us');
    });
  });

  describe('formatTimeAuto', () => {
    it('should format microseconds for very small values', () => {
      expect(formatTimeAuto(0.0001)).toContain('us');
      expect(formatTimeAuto(0.0005, 1)).toContain('500');
    });

    it('should format milliseconds for sub-second values', () => {
      expect(formatTimeAuto(0.5)).toContain('ms');
      expect(formatTimeAuto(0.123, 1)).toContain('123');
    });

    it('should format seconds for small values', () => {
      expect(formatTimeAuto(30)).toContain('s');
      expect(formatTimeAuto(45.5, 1)).toContain('45.5');
    });

    it('should format minutes for larger values', () => {
      expect(formatTimeAuto(120)).toContain('min');
      expect(formatTimeAuto(300, 1)).toContain('5.0');
    });

    it('should format hours for even larger values', () => {
      expect(formatTimeAuto(3600)).toContain('hr');
      expect(formatTimeAuto(7200, 1)).toContain('2.0');
    });

    it('should format days for very large values', () => {
      expect(formatTimeAuto(86400)).toContain('days');
      expect(formatTimeAuto(172800, 1)).toContain('2.0');
    });

    it('should respect decimal places', () => {
      expect(formatTimeAuto(1.2345, 2)).toContain('1.23');
      expect(formatTimeAuto(1.2345, 0)).toContain('1');
    });

    it('should handle NaN and Infinity', () => {
      expect(formatTimeAuto(NaN)).toBe('N/A');
      expect(formatTimeAuto(Infinity)).toBe('N/A');
    });

    it('should handle negative values', () => {
      expect(formatTimeAuto(-30)).toContain('-');
      expect(formatTimeAuto(-3600)).toContain('-');
    });
  });

  describe('formatMs', () => {
    it('should format milliseconds using formatTimeAuto', () => {
      expect(formatMs(1000)).toContain('1'); // 1 second
      expect(formatMs(500)).toContain('500'); // 500 ms
      expect(formatMs(60000)).toContain('1'); // 1 minute
    });

    it('should respect decimal places', () => {
      expect(formatMs(1234, 2)).toContain('1.23');
    });
  });

  describe('isValidTime', () => {
    it('should return true for valid positive times', () => {
      expect(isValidTime(0)).toBe(true);
      expect(isValidTime(1)).toBe(true);
      expect(isValidTime(0.5)).toBe(true);
      expect(isValidTime(1000000)).toBe(true);
    });

    it('should return false for negative times', () => {
      expect(isValidTime(-1)).toBe(false);
      expect(isValidTime(-0.001)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidTime(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isValidTime(Infinity)).toBe(false);
      expect(isValidTime(-Infinity)).toBe(false);
    });
  });

  describe('ensurePositiveTime', () => {
    it('should return positive times unchanged', () => {
      expect(ensurePositiveTime(10)).toBe(10);
      expect(ensurePositiveTime(0.5)).toBe(0.5);
      expect(ensurePositiveTime(0)).toBe(0);
    });

    it('should convert negative times to zero', () => {
      expect(ensurePositiveTime(-10)).toBe(0);
      expect(ensurePositiveTime(-0.5)).toBe(0);
    });
  });
});
