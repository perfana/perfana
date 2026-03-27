import { TestRun } from '@/types/test-runs';
import { formatDurationClock } from '@/lib/format-units';

/**
 * Format duration in seconds to human-readable string.
 * Delegates to the centralized formatDurationClock.
 */
export const formatDuration = formatDurationClock;

/**
 * Check if a test run is recently active (updated within last 30 seconds)
 */
export function isRecentlyActive(testRun: TestRun, currentTime?: number): boolean {
  const now = currentTime || Date.now();

  // For completed tests, check if end_time is within 30 seconds
  if (testRun.completed && testRun.end_time) {
    const endTime = new Date(testRun.end_time).getTime();
    const timeDiffInSeconds = (now - endTime) / 1000;
    return timeDiffInSeconds < 30;
  }

  // For running tests (not completed), check if last update (end_time) is recent
  if (!testRun.completed && testRun.end_time) {
    const lastUpdateTime = new Date(testRun.end_time).getTime();
    const timeDiffInSeconds = (now - lastUpdateTime) / 1000;
    return timeDiffInSeconds < 30; // Test is active if updated within last 30 seconds
  }

  return false;
}

/**
 * Calculate elapsed duration for a test run
 */
export function calculateElapsedDuration(testRun: TestRun, currentTime?: number): number {
  const now = currentTime || Date.now();
  if (!testRun.start_time) return 0;

  const startTime = new Date(testRun.start_time).getTime();
  const elapsedMs = now - startTime;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/**
 * Calculate progress percentage for a test run
 */
export function calculateProgress(testRun: TestRun, currentTime?: number): number {
  const isActive = isRecentlyActive(testRun, currentTime);

  // If test is completed, use actual duration vs planned duration
  if (testRun.completed && testRun.duration && testRun.planned_duration) {
    return Math.min((testRun.duration / testRun.planned_duration) * 100, 100);
  }

  // Only calculate live progress for actively running tests (not stale)
  if (!testRun.completed && isActive && testRun.start_time && testRun.planned_duration) {
    const startTime = new Date(testRun.start_time).getTime();
    const now = currentTime || Date.now();
    const elapsedSeconds = Math.floor((now - startTime) / 1000);
    return Math.min((elapsedSeconds / testRun.planned_duration) * 100, 100);
  }

  // For stale tests (running but not active), use fixed progress based on last known time
  if (!testRun.completed && !isActive && testRun.start_time && testRun.end_time && testRun.planned_duration) {
    const startTime = new Date(testRun.start_time).getTime();
    const lastUpdateTime = new Date(testRun.end_time).getTime();
    const elapsedSeconds = Math.floor((lastUpdateTime - startTime) / 1000);
    return Math.min((elapsedSeconds / testRun.planned_duration) * 100, 100);
  }

  return 0;
}
