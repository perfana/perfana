import { BadRequestException } from '@nestjs/common';
import { parseMetricTimeRange } from './metrics.controller';

/**
 * `parseMetricTimeRange` validates the `from`/`to` query pair on
 * `GET /metrics/ds-metrics/:testRunId/:panelId` — the window a chart zoom narrows the
 * downsample budget to. Both bounds or neither; anything else is a 400, so a caller that
 * drops one query param on the way does not silently get the whole run back on that side.
 */
describe('parseMetricTimeRange', () => {
  it('returns undefined when neither bound is supplied', () => {
    expect(parseMetricTimeRange(undefined, undefined)).toBeUndefined();
  });

  it('rejects from without to', () => {
    expect(() => parseMetricTimeRange('2024-01-01T00:00:00Z', undefined)).toThrow(BadRequestException);
    expect(() => parseMetricTimeRange('2024-01-01T00:00:00Z', undefined)).toThrow('from and to must be supplied together');
  });

  it('rejects to without from', () => {
    expect(() => parseMetricTimeRange(undefined, '2024-01-01T00:00:00Z')).toThrow(BadRequestException);
  });

  it('rejects an unparseable from timestamp', () => {
    expect(() => parseMetricTimeRange('not-a-date', '2024-01-01T00:00:00Z')).toThrow('ISO-8601');
  });

  it('rejects an unparseable to timestamp', () => {
    expect(() => parseMetricTimeRange('2024-01-01T00:00:00Z', 'not-a-date')).toThrow('ISO-8601');
  });

  it('rejects from after to', () => {
    expect(() =>
      parseMetricTimeRange('2024-01-02T00:00:00Z', '2024-01-01T00:00:00Z'),
    ).toThrow('from must not be after to');
  });

  it('accepts from equal to to — a single-instant window is not an error', () => {
    const result = parseMetricTimeRange('2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
    expect(result).toEqual({ from: '2024-01-01T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' });
  });

  it('normalises a parseable-but-non-canonical timestamp to strict ISO-8601', () => {
    // Date.parse accepts a bare date; the service's SQL casts the string with ::timestamptz,
    // so what travels downstream must already be unambiguous.
    const result = parseMetricTimeRange('2024-01-01', '2024-01-02');
    expect(result).toEqual({ from: '2024-01-01T00:00:00.000Z', to: '2024-01-02T00:00:00.000Z' });
  });
});
