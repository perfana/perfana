import {
  formatDuration,
  calculateElapsedDuration,
  calculateProgress,
  isRecentlyActive,
} from '@/app/test-runs/utils/test-run-utils';
import { TestRun } from '@/types/test-runs';

// Minimal TestRun factory
function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: '1',
    test_run_id: 'test-1',
    system_name: 'sys',
    test_environment: 'env',
    workload: 'wl',
    completed: false,
    start_time: null,
    end_time: null,
    duration: null,
    planned_duration: null,
    ramp_up: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as TestRun;
}

describe('formatDuration', () => {
  it('returns N/A for undefined', () => {
    expect(formatDuration(undefined)).toBe('N/A');
  });

  it('returns N/A for 0', () => {
    expect(formatDuration(0)).toBe('N/A');
  });

  it('returns N/A for negative values', () => {
    expect(formatDuration(-5)).toBe('N/A');
  });

  it('formats seconds only', () => {
    expect(formatDuration(42)).toBe('42s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(154)).toBe('2m 34s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(4500)).toBe('1h 15m 0s');
  });

  it('formats exact hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m 0s');
  });

  it('formats exact minute', () => {
    expect(formatDuration(60)).toBe('1m 0s');
  });

  it('formats 1 second', () => {
    expect(formatDuration(1)).toBe('1s');
  });

  it('formats large durations', () => {
    expect(formatDuration(86400)).toBe('24h 0m 0s');
  });
});

describe('calculateElapsedDuration', () => {
  it('returns 0 when start_time is null', () => {
    const run = makeTestRun({ start_time: null });
    expect(calculateElapsedDuration(run, Date.now())).toBe(0);
  });

  it('calculates elapsed seconds from start_time to currentTime', () => {
    const now = Date.now();
    const startTime = new Date(now - 120_000).toISOString(); // 2 minutes ago
    const run = makeTestRun({ start_time: startTime });
    expect(calculateElapsedDuration(run, now)).toBe(120);
  });

  it('returns 0 for future start_time', () => {
    const now = Date.now();
    const futureStart = new Date(now + 60_000).toISOString();
    const run = makeTestRun({ start_time: futureStart });
    expect(calculateElapsedDuration(run, now)).toBe(0);
  });
});

describe('isRecentlyActive', () => {
  it('returns false when no end_time', () => {
    const run = makeTestRun({ completed: false, end_time: null });
    expect(isRecentlyActive(run)).toBe(false);
  });

  it('returns true for completed test with recent end_time', () => {
    const now = Date.now();
    const run = makeTestRun({
      completed: true,
      end_time: new Date(now - 10_000).toISOString(), // 10s ago
    });
    expect(isRecentlyActive(run, now)).toBe(true);
  });

  it('returns false for completed test with old end_time', () => {
    const now = Date.now();
    const run = makeTestRun({
      completed: true,
      end_time: new Date(now - 60_000).toISOString(), // 60s ago
    });
    expect(isRecentlyActive(run, now)).toBe(false);
  });

  it('returns true for running test with recent end_time', () => {
    const now = Date.now();
    const run = makeTestRun({
      completed: false,
      end_time: new Date(now - 5_000).toISOString(), // 5s ago
    });
    expect(isRecentlyActive(run, now)).toBe(true);
  });
});

describe('calculateProgress', () => {
  it('returns 0 when no data available', () => {
    const run = makeTestRun();
    expect(calculateProgress(run)).toBe(0);
  });

  it('calculates progress for completed test', () => {
    const run = makeTestRun({
      completed: true,
      duration: 300,
      planned_duration: 600,
    });
    expect(calculateProgress(run)).toBe(50);
  });

  it('caps completed test progress at 100%', () => {
    const run = makeTestRun({
      completed: true,
      duration: 900,
      planned_duration: 600,
    });
    expect(calculateProgress(run)).toBe(100);
  });

  it('calculates live progress for active running test', () => {
    const now = Date.now();
    const run = makeTestRun({
      completed: false,
      start_time: new Date(now - 150_000).toISOString(), // 150s ago
      end_time: new Date(now - 5_000).toISOString(), // active (5s ago)
      planned_duration: 300,
    });
    expect(calculateProgress(run, now)).toBe(50);
  });

  it('calculates stale progress for inactive running test', () => {
    const now = Date.now();
    const run = makeTestRun({
      completed: false,
      start_time: new Date(now - 300_000).toISOString(), // 300s ago
      end_time: new Date(now - 120_000).toISOString(), // stale (120s ago)
      planned_duration: 600,
    });
    // elapsed = (300_000 - 120_000) / 1000 = 180s, progress = 180/600 * 100 = 30%
    expect(calculateProgress(run, now)).toBe(30);
  });
});
