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
