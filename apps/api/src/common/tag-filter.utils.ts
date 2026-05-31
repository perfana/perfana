/**
 * Utility functions for filtering tags
 * Used across the application to consistently filter out system tags
 *
 * NOTE: Core tag filtering functions have been moved to @perfana/shared
 * for consistent use across frontend and backend. This file now re-exports
 * the backend-consumed helper for backward compatibility.
 */

import { mergeAndFilterTags } from '@perfana/shared';

// Re-export shared function for backward compatibility
export { mergeAndFilterTags };
