import { RelatedTestRun } from '../types';

/**
 * Format test run display text with timestamp
 */
export function getTestRunDisplayText(testRun: RelatedTestRun): string {
  const startTime = testRun.start_time || testRun.created_at;
  const formattedTime = new Date(startTime).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${testRun.test_run_id} - ${formattedTime}`;
}

/**
 * Get secondary info for test run display (version, annotations)
 */
export function getTestRunSecondaryInfo(testRun: RelatedTestRun): string {
  const parts: string[] = [];

  if (testRun.application_release) {
    parts.push(`Version: ${testRun.application_release}`);
  }

  if (testRun.annotations && testRun.annotations.length > 0) {
    parts.push(`Annotations: ${testRun.annotations.join(', ')}`);
  }

  return parts.join(' • ');
}

/**
 * Extract profiler label from profiler value
 * E.g., "process_cpu:cpu:nanoseconds:cpu:nanoseconds" -> "process_cpu/cpu"
 */
export function extractProfilerLabel(profilerValue: string): string {
  const parts = profilerValue.split(':');
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return profilerValue;
}

/**
 * Format duration in minutes and seconds
 */
export function formatDuration(duration: number | undefined): string {
  if (!duration) return 'N/A';
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Format date string to localized display format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get accent color based on error state
 */
export function getAccentColor(hasError: boolean): string {
  if (hasError) {
    return '#f44336'; // Red for error
  }
  return '#1976d2'; // Default blue
}

/**
 * Convert ISO date string to milliseconds timestamp
 * Returns NaN if conversion fails
 */
export function dateToMs(dateString: string): number {
  return new Date(dateString).getTime();
}

/**
 * Validate that all timestamps are valid numbers
 */
export function validateTimestamps(...timestamps: number[]): boolean {
  return timestamps.every((ts) => !isNaN(ts));
}
