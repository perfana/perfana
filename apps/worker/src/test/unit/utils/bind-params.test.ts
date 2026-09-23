import { describe, it, expect } from 'vitest';
import { maxRowsPerStatement, PG_MAX_BIND_PARAMS } from '../../../utils/bind-params.js';

/**
 * Postgres caps one extended-protocol statement at 65535 bind parameters, and a bulk
 * `INSERT ... VALUES (...), (...)` spends rows x columns of that. Two worker sites had
 * hand-written row counts against that cap (worker pipeline review 2026-09-14):
 * `MetricProcessor` at a fixed 200, and `PanelsPipeline` at no limit at all, which fails
 * outright past 3449 panels.
 *
 * These tests pin the arithmetic, because the failure mode of getting it wrong is a
 * whole pipeline stage erroring on a large run rather than anything visible in dev.
 */
describe('maxRowsPerStatement', () => {
  it('never lets rows x columns exceed the parameter cap', () => {
    // The property that matters, over the column counts these tables actually have.
    for (let columns = 1; columns <= 64; columns++) {
      const rows = maxRowsPerStatement(columns, Number.MAX_SAFE_INTEGER);
      expect(rows * columns).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
      // ...and is the LARGEST such row count: one more would breach it.
      expect((rows + 1) * columns).toBeGreaterThan(PG_MAX_BIND_PARAMS);
    }
  });

  it('computes 3449 for the 19-column inserts both call sites use', () => {
    // ds_metrics and ds_panels are both 19 columns today. If either grows, the derived
    // batch shrinks automatically -- that is the whole point of deriving it.
    expect(maxRowsPerStatement(19, Number.MAX_SAFE_INTEGER)).toBe(3449);
    expect(3449 * 19).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
    expect(3450 * 19).toBeGreaterThan(PG_MAX_BIND_PARAMS);
  });

  it('returns the preferred size when it is below the ceiling', () => {
    expect(maxRowsPerStatement(19)).toBe(1000);
    expect(maxRowsPerStatement(19, 500)).toBe(500);
  });

  it('clamps to the ceiling when the preferred size is too large', () => {
    expect(maxRowsPerStatement(19, 10_000)).toBe(3449);
  });

  it('floors rather than rounds, so an exact division is not overshot', () => {
    // 65535 / 7 = 9362.14..., so 9362 rows is 65534 params and 9363 would be 65541.
    expect(maxRowsPerStatement(7, Number.MAX_SAFE_INTEGER)).toBe(9362);
    expect(9363 * 7).toBeGreaterThan(PG_MAX_BIND_PARAMS);
  });

  it('rejects a column count that cannot fit a single row', () => {
    // Not reachable today, but returning 0 here would make every caller loop forever.
    expect(() => maxRowsPerStatement(PG_MAX_BIND_PARAMS + 1, 1)).toThrow(/exceeds the/);
  });

  it('rejects nonsense inputs rather than silently producing a bad batch', () => {
    expect(() => maxRowsPerStatement(0)).toThrow(/positive integer/);
    expect(() => maxRowsPerStatement(-1)).toThrow(/positive integer/);
    expect(() => maxRowsPerStatement(1.5)).toThrow(/positive integer/);
    expect(() => maxRowsPerStatement(19, 0)).toThrow(/positive integer/);
  });
});
