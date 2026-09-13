/**
 * Unit tests for the perf-test bucket rule in time-bucketing.ts.
 *
 * `perfTestBucketSizes` is the one place the live ticks and the analyze-time rebuild
 * agree on a bucket size, and `alignToBucket` is what keeps a tick's overlap window on
 * the grid those buckets are built on. Both are pure, so they are pinned here directly
 * rather than only through the pipeline's log lines.
 */
import { describe, it, expect } from 'vitest';
import {
  alignToBucket,
  calculateBucketSize,
  perfTestBucketSizes,
  FULL_COLLECTION_TARGET_DATA_POINTS,
  TICK_BUCKET_FALLBACK_SECONDS,
  PERF_TEST_OVERLAP_SECONDS,
} from '../../../utils/time-bucketing.js';

const start = new Date('2026-01-01T00:00:00Z');

describe('perfTestBucketSizes', () => {
  it('sizes the tick from the planned duration when the test posted one', () => {
    // 3 h plan / 250 points → 60 s buckets, regardless of what the run has done so far.
    const { tick } = perfTestBucketSizes({ plannedDuration: 10800, startTime: start, completed: false });

    expect(tick).toBe(calculateBucketSize(10800, FULL_COLLECTION_TARGET_DATA_POINTS));
    expect(tick).toBe(60);
  });

  it.each([undefined, null, 0, -5])('falls back to the fixed tick size when planned duration is %s', (planned) => {
    const { tick } = perfTestBucketSizes({ plannedDuration: planned, startTime: start, completed: false });

    expect(tick).toBe(TICK_BUCKET_FALLBACK_SECONDS);
  });

  it('sizes the final bucket from the actual length once the run is completed', () => {
    // 1 h actual → 15 s buckets, even though the 3 h plan would have said 60 s.
    const { tick, final } = perfTestBucketSizes({
      plannedDuration: 10800,
      startTime: start,
      endTime: new Date('2026-01-01T01:00:00Z'),
      completed: true,
    });

    expect(tick).toBe(60);
    expect(final).toBe(15);
  });

  it('has no final size while the run is live, even though the keep-alive has set end_time', () => {
    const { final } = perfTestBucketSizes({
      plannedDuration: 3600,
      startTime: start,
      endTime: new Date('2026-01-01T00:20:00Z'),
      completed: false,
    });

    expect(final).toBeNull();
  });

  it('has no final size when the run is completed but carries no end_time', () => {
    const { final } = perfTestBucketSizes({ plannedDuration: 3600, startTime: start, endTime: null, completed: true });

    expect(final).toBeNull();
  });

  it('has no final size when a completed run has a zero-length window', () => {
    // calculateBucketSize throws on a non-positive duration; the rule must not.
    const { final } = perfTestBucketSizes({ startTime: start, endTime: start, completed: true });

    expect(final).toBeNull();
  });

  it('agrees between tick and final when the run honoured its plan', () => {
    const { tick, final } = perfTestBucketSizes({
      plannedDuration: 3600,
      startTime: start,
      endTime: new Date('2026-01-01T01:00:00Z'),
      completed: true,
    });

    expect(final).toBe(tick);
  });
});

describe('alignToBucket', () => {
  it('aligns a time down to the bucket boundary built on start_time', () => {
    expect(alignToBucket(new Date('2026-01-01T00:09:30Z'), start, 60)).toEqual(new Date('2026-01-01T00:09:00Z'));
    expect(alignToBucket(new Date('2026-01-01T00:57:40Z'), start, 15)).toEqual(new Date('2026-01-01T00:57:30Z'));
  });

  it('keeps a time that is already on the grid', () => {
    expect(alignToBucket(new Date('2026-01-01T00:10:00Z'), start, 60)).toEqual(new Date('2026-01-01T00:10:00Z'));
  });

  it('aligns to the run start, not to the wall clock minute', () => {
    const oddStart = new Date('2026-01-01T00:00:17Z');

    expect(alignToBucket(new Date('2026-01-01T00:02:00Z'), oddStart, 60)).toEqual(new Date('2026-01-01T00:01:17Z'));
  });

  it('clamps at start_time when the overlap would reach before the run', () => {
    const before = new Date(start.getTime() - PERF_TEST_OVERLAP_SECONDS * 1000);

    expect(alignToBucket(before, start, 60)).toEqual(start);
    expect(alignToBucket(new Date('2026-01-01T00:00:30Z'), start, 60)).toEqual(start);
  });
});
