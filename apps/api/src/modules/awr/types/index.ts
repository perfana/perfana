/**
 * AWR Types Index
 *
 * Barrel export for all AWR-related TypeScript type definitions.
 * Import types from here for cleaner imports throughout the codebase.
 *
 * @example
 * import { ParsedAwrData, AwrInsight, AnalysisResult } from '../types';
 */

// Re-export all AWR data types (parsed report structures)
export * from './awr-data.types';

// Re-export all insight types (must be before analysis types due to dependencies)
export * from './insights.types';

// Re-export all analysis types (analysis results and comparison structures)
export * from './analysis.types';
