import {
  formatDuration,
  formatDurationCompact,
  formatDurationClock,
  formatBytes,
  formatPercentage,
  formatRatioAsPercentage,
  formatChangePercentage,
  formatRate,
  formatNumber,
  formatCompactNumber,
  formatInteger,
} from '@/lib/format-units';

// ─── formatDuration (auto-unit, precise) ────────────────────────────

describe('formatDuration', () => {
  it('returns N/A for null, undefined, NaN', () => {
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(undefined)).toBe('N/A');
    expect(formatDuration(NaN)).toBe('N/A');
  });

  it('formats microseconds', () => {
    expect(formatDuration(0.0005)).toBe('500.00 us');
    expect(formatDuration(0.000001)).toBe('1.00 us');
  });

  it('formats milliseconds', () => {
    expect(formatDuration(0.5)).toBe('500.00 ms');
    expect(formatDuration(0.001)).toBe('1.00 ms');
    expect(formatDuration(0.999)).toBe('999.00 ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1)).toBe('1.00 s');
    expect(formatDuration(45)).toBe('45.00 s');
    expect(formatDuration(59.99)).toBe('59.99 s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60)).toBe('1.00 min');
    expect(formatDuration(150)).toBe('2.50 min');
  });

  it('formats hours', () => {
    expect(formatDuration(3600)).toBe('1.00 hr');
    expect(formatDuration(7200)).toBe('2.00 hr');
  });

  it('formats days', () => {
    expect(formatDuration(86400)).toBe('1.00 days');
    expect(formatDuration(172800)).toBe('2.00 days');
  });

  it('handles negative values', () => {
    expect(formatDuration(-45)).toBe('-45.00 s');
    expect(formatDuration(-0.5)).toBe('-500.00 ms');
  });

  it('respects decimals parameter', () => {
    expect(formatDuration(45.123, 1)).toBe('45.1 s');
    expect(formatDuration(45.123, 0)).toBe('45 s');
    expect(formatDuration(0.5, 3)).toBe('500.000 ms');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0.00 us');
  });
});

// ─── formatDurationCompact ──────────────────────────────────────────

describe('formatDurationCompact', () => {
  it('returns N/A for null, undefined, NaN, zero', () => {
    expect(formatDurationCompact(null)).toBe('N/A');
    expect(formatDurationCompact(undefined)).toBe('N/A');
    expect(formatDurationCompact(NaN)).toBe('N/A');
    expect(formatDurationCompact(0)).toBe('N/A');
  });

  it('formats sub-millisecond as microseconds', () => {
    expect(formatDurationCompact(0.0005)).toBe('500us');
    expect(formatDurationCompact(0.0000005)).toBe('1us');
  });

  it('formats milliseconds', () => {
    expect(formatDurationCompact(0.5)).toBe('500.0ms');
  });

  it('formats seconds', () => {
    expect(formatDurationCompact(42)).toBe('42.0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDurationCompact(125)).toBe('2m 5s');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatDurationCompact(5445)).toBe('1h 30m 45s');
  });

  it('formats days', () => {
    expect(formatDurationCompact(90000)).toBe('1d 1h');
  });

  it('handles negative values', () => {
    expect(formatDurationCompact(-125)).toBe('-2m 5s');
  });
});

// ─── formatDurationClock ────────────────────────────────────────────

describe('formatDurationClock', () => {
  it('returns N/A for undefined, zero, negative', () => {
    expect(formatDurationClock(undefined)).toBe('N/A');
    expect(formatDurationClock(0)).toBe('N/A');
    expect(formatDurationClock(-5)).toBe('N/A');
  });

  it('formats seconds only', () => {
    expect(formatDurationClock(42)).toBe('42s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDurationClock(154)).toBe('2m 34s');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatDurationClock(3661)).toBe('1h 1m 1s');
  });

  it('formats exact boundaries', () => {
    expect(formatDurationClock(60)).toBe('1m 0s');
    expect(formatDurationClock(3600)).toBe('1h 0m 0s');
  });
});

// ─── formatBytes ────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns N/A for null, undefined, NaN', () => {
    expect(formatBytes(null)).toBe('N/A');
    expect(formatBytes(undefined)).toBe('N/A');
    expect(formatBytes(NaN)).toBe('N/A');
  });

  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500.00 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });

  it('formats terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1.00 TB');
  });

  it('handles negative bytes', () => {
    expect(formatBytes(-1048576)).toBe('-1.00 MB');
  });

  it('respects decimals parameter', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

// ─── formatPercentage ───────────────────────────────────────────────

describe('formatPercentage', () => {
  it('returns N/A for null, undefined, NaN', () => {
    expect(formatPercentage(null)).toBe('N/A');
    expect(formatPercentage(undefined)).toBe('N/A');
    expect(formatPercentage(NaN)).toBe('N/A');
  });

  it('formats with default decimals', () => {
    expect(formatPercentage(95.5)).toBe('95.5%');
  });

  it('formats with custom decimals', () => {
    expect(formatPercentage(95.567, 2)).toBe('95.57%');
  });

  it('formats without symbol', () => {
    expect(formatPercentage(95.5, 1, false)).toBe('95.5');
  });

  it('handles zero', () => {
    expect(formatPercentage(0)).toBe('0.0%');
  });

  it('handles negative values', () => {
    expect(formatPercentage(-5.5)).toBe('-5.5%');
  });

  it('handles values over 100', () => {
    expect(formatPercentage(150)).toBe('150.0%');
  });
});

// ─── formatRatioAsPercentage ────────────────────────────────────────

describe('formatRatioAsPercentage', () => {
  it('converts ratio to percentage', () => {
    expect(formatRatioAsPercentage(0.955)).toBe('95.5%');
    expect(formatRatioAsPercentage(1)).toBe('100.0%');
    expect(formatRatioAsPercentage(0)).toBe('0.0%');
  });

  it('returns N/A for null', () => {
    expect(formatRatioAsPercentage(null)).toBe('N/A');
  });
});

// ─── formatChangePercentage ─────────────────────────────────────────

describe('formatChangePercentage', () => {
  it('adds + sign for positive', () => {
    expect(formatChangePercentage(25.5)).toBe('+25.5%');
  });

  it('keeps - sign for negative', () => {
    expect(formatChangePercentage(-10.3)).toBe('-10.3%');
  });

  it('no sign for zero', () => {
    expect(formatChangePercentage(0)).toBe('0.0%');
  });

  it('returns N/A for null', () => {
    expect(formatChangePercentage(null)).toBe('N/A');
  });
});

// ─── formatRate ─────────────────────────────────────────────────────

describe('formatRate', () => {
  it('returns N/A for null, undefined, NaN', () => {
    expect(formatRate(null, 'req/s')).toBe('N/A');
    expect(formatRate(undefined, 'req/s')).toBe('N/A');
    expect(formatRate(NaN, 'req/s')).toBe('N/A');
  });

  it('formats with unit suffix', () => {
    expect(formatRate(0.5, 'ops/s')).toBe('0.50 ops/s');
  });

  it('formats with thousand separators', () => {
    expect(formatRate(1234.5, 'req/s')).toBe('1,234.50 req/s');
  });

  it('respects decimals', () => {
    expect(formatRate(99.9, 'MB/s', 0)).toBe('100 MB/s');
    expect(formatRate(99.9, 'MB/s', 1)).toBe('99.9 MB/s');
  });

  it('handles zero', () => {
    expect(formatRate(0, 'req/s')).toBe('0.00 req/s');
  });

  it('handles negative rates', () => {
    expect(formatRate(-5.5, 'ops/s')).toBe('-5.50 ops/s');
  });
});

// ─── formatNumber ───────────────────────────────────────────────────

describe('formatNumber', () => {
  it('returns N/A for null, undefined, NaN', () => {
    expect(formatNumber(null)).toBe('N/A');
    expect(formatNumber(undefined)).toBe('N/A');
    expect(formatNumber(NaN)).toBe('N/A');
  });

  it('formats with thousand separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('respects decimals', () => {
    expect(formatNumber(1234.567, 1)).toBe('1,234.6');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

// ─── formatCompactNumber ────────────────────────────────────────────

describe('formatCompactNumber', () => {
  it('returns N/A for null', () => {
    expect(formatCompactNumber(null)).toBe('N/A');
  });

  it('formats thousands as K', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
  });

  it('formats millions as M', () => {
    expect(formatCompactNumber(2500000)).toBe('2.5M');
  });

  it('formats billions as G', () => {
    expect(formatCompactNumber(1500000000)).toBe('1.5G');
  });

  it('formats trillions as T', () => {
    expect(formatCompactNumber(1500000000000)).toBe('1.5T');
  });

  it('formats small values directly', () => {
    expect(formatCompactNumber(500)).toBe('500.0');
  });

  it('handles negative values', () => {
    expect(formatCompactNumber(-2500000)).toBe('-2.5M');
  });
});

// ─── formatInteger ──────────────────────────────────────────────────

describe('formatInteger', () => {
  it('returns N/A for null', () => {
    expect(formatInteger(null)).toBe('N/A');
  });

  it('rounds and formats', () => {
    expect(formatInteger(1234.7)).toBe('1,235');
    expect(formatInteger(1234.2)).toBe('1,234');
  });

  it('handles zero', () => {
    expect(formatInteger(0)).toBe('0');
  });
});
