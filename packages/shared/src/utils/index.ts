// Utility functions for shared use across the application

// Export encryption utilities (AES-256-GCM)
export * from './encryption';

// Export TypeORM encrypted column transformer
export * from './encrypted-column.transformer';

// Export TypeORM URL column transformer
export * from './url-column.transformer';

// Export safe regex utilities (ReDoS prevention)
export * from './safe-regex';

// Export audit-log diff helpers (used by API + grafana-sync audit dispatchers)
export * from './audit-diff';

// Export the report text-block markdown renderer (used by API report HTML + web editor preview)
export * from './markdown';

/**
 * Formats a date to ISO string
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Checks if a value is defined and not null
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Creates a delay promise for async operations
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Capitalizes the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generates a unique identifier
 */
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Truncates a string to specified length with ellipsis
 */
export function truncate(str: string, length: number): string {
  return str.length <= length ? str : str.slice(0, length) + '...';
}

/**
 * Removes undefined and null values from an object
 */
export function cleanObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

/**
 * Filters out tags that match the perfana pattern (case-insensitive),
 * start with $ (template variables), or are system control tags
 *
 * This function is used to remove system/template tags that are not
 * meaningful for user-facing tag displays or filtering
 *
 * @param tags - Array of tag strings to filter
 * @returns Array of filtered tags with system tags removed
 */
export function filterSystemTags(tags: string[]): string[] {
  if (!tags || !Array.isArray(tags)) {
    return [];
  }

  return tags.filter(tag => {
    if (typeof tag !== 'string') {
      return false;
    }

    // Filter out tags matching /perfana.*/ig pattern
    if (tag.toLowerCase().match(/^perfana/)) {
      return false;
    }

    // Filter out tags starting with $ (template variables like $service)
    if (tag.startsWith('$')) {
      return false;
    }

    // Filter out no-anomaly-detection tag (system control tag)
    if (tag === 'no-anomaly-detection') {
      return false;
    }

    return true;
  });
}

/**
 * Checks if a tag should be filtered out (matches system tag patterns)
 *
 * @param tag - Tag string to check
 * @returns true if tag should be filtered out, false otherwise
 */
export function isSystemTag(tag: string): boolean {
  if (typeof tag !== 'string') {
    return true;
  }

  // Check perfana pattern (case-insensitive)
  if (tag.toLowerCase().match(/^perfana/)) {
    return true;
  }

  // Check $ prefix
  if (tag.startsWith('$')) {
    return true;
  }

  // Check no-anomaly-detection tag
  if (tag === 'no-anomaly-detection') {
    return true;
  }

  return false;
}

/**
 * Merges multiple tag arrays and removes duplicates and system tags
 *
 * @param tagArrays - Variable number of tag arrays to merge
 * @returns Array of unique filtered tags
 */
export function mergeAndFilterTags(...tagArrays: (string[] | undefined | null)[]): string[] {
  const allTags = tagArrays
    .filter(arr => Array.isArray(arr))
    .flat()
    .filter(tag => typeof tag === 'string');

  // Remove duplicates and system tags
  const uniqueTags = Array.from(new Set(allTags));
  return filterSystemTags(uniqueTags);
}

// Export report section anchor slugs (used by API report HTML + web link picker)
export * from './section-anchors';

// Export report text variables (used by API report rendering + web editor picker)
export * from './report-variables';

/**
 * A row's share of a total, as a 0-100 score with one decimal.
 *
 * Used for the top-ten "Performance Impact Ranking": raw impact is avg × count,
 * a millisecond-calls product in the millions that means nothing on its own and
 * cannot be compared between runs. The share of the run's total time can — and
 * it ranks identically, so the ordering is unchanged.
 *
 * Shared because the report renderer and the three Performance Analysis lists
 * must print the same score for the same run; a second implementation would drift.
 *
 * A row under a tenth of a percent renders as `<0.1`, not `0.0`: it did consume
 * time, and a score rounded to nothing reads as a bug. A `total` of 0 (an
 * all-zero run) gives every row 0.
 */
export function formatImpactShare(value: number, total: number): string {
  if (!(total > 0) || !(value > 0)) return '0';
  const share = (value / total) * 100;
  // `<0.1` rather than a rounded `0.1`: on a run with a long tail the floor plus
  // one-decimal rounding would make the visible column sum well past 100, and every
  // tail row would show an identical 0.1 while ranking differently. Saying "under a
  // tenth" is both true and obviously not a measurement.
  return share < 0.1 ? '<0.1' : share.toFixed(1);
}

/**
 * The denominator behind `formatImpactShare` — the total impact of every row in
 * scope, not of the ten that make the list.
 *
 * Shared for the same reason the formatter is: the report renderer and the three
 * Performance Analysis lists each compute this, and a numerator shared with a
 * denominator that is not shared is still two implementations of one number.
 * `impact` is optional on the web row types, so a missing one counts as zero
 * rather than poisoning the sum with NaN.
 */
export function sumImpact(rows: ReadonlyArray<{ impact?: number | null }>): number {
  return rows.reduce((sum, r) => sum + (Number(r.impact) || 0), 0);
}
