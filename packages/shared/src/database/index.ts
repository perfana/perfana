// IMPORTANT: This barrel is consumed by `typeorm.config.ts` as
// `migrations: Object.values(migrations)`. Only export migration *classes*
// from here — anything else (functions, types, factories) ends up in the
// migrations array and TypeORM will try to `new` it during
// ConnectionMetadataBuilder.buildMigrations, throwing "is not a constructor"
// for non-class exports (e.g. async functions like `createSystemDataSource`).
//
// For runtime helpers, import directly from their source module:
//   import { createSystemDataSource } from '@perfana/shared/database/data-source-system';
//   import type { SystemActor } from '@perfana/shared/database/system-connection';

// Export all migrations for TypeORM
export { ConsolidatedSchema1700000000000 } from './migrations/1700000000000-ConsolidatedSchema';
