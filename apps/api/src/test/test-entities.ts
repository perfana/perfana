/**
 * Test entities barrel export
 *
 * This file imports all API-specific TypeORM entities as classes for use in global-setup.ts.
 * This ensures TypeORM can properly resolve entity relationships.
 *
 * Note: Only includes @Entity decorated classes, not plain TypeScript interfaces or classes.
 */

// API-specific TypeORM entities (with @Entity decorator)
export { AwrReport } from '../modules/awr/entities/awr-report.entity';
export { AwrAnalysis } from '../modules/awr/entities/awr-analysis.entity';

// Re-export all shared entities from source
export * from '../../../../packages/shared/src/entities';
