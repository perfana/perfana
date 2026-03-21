/**
 * Utility functions for filtering tags
 * Used across the application to consistently filter out system tags
 * 
 * NOTE: Core tag filtering functions have been moved to @perfana/shared
 * for consistent use across frontend and backend. This file now re-exports
 * those functions plus adds backend-specific utilities.
 */

import { filterSystemTags, isSystemTag, mergeAndFilterTags } from '@perfana/shared';

// Re-export shared functions for backward compatibility
export { filterSystemTags, isSystemTag, mergeAndFilterTags };

/**
 * PostgreSQL-compatible function to filter system tags
 * Returns SQL expression that can be used in database queries
 * 
 * @param tagsColumn - Name of the tags column in the query
 * @returns SQL expression string for filtering system tags
 */
export function getTagFilterSQL(tagsColumn: string = 'tags'): string {
  return `
    CASE 
      WHEN ${tagsColumn} IS NULL THEN ARRAY[]::text[]
      ELSE ARRAY(
        SELECT tag 
        FROM unnest(${tagsColumn}) as tag 
        WHERE tag !~* '^perfana.*' 
        AND tag !~ '^\\$.*'
      )
    END
  `;
}

