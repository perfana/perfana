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
export { CleanupLegacyMigrationRecords1700000000001 } from './migrations/1700000000001-CleanupLegacyMigrationRecords';
export { SyncSchemaState1700000000002 } from './migrations/1700000000002-SyncSchemaState';
export { AddTagsHashUniqueIndex1700000000003 } from './migrations/1700000000003-AddTagsHashUniqueIndex';
export { AddAlertsSupport1700000000004 } from './migrations/1700000000004-AddAlertsSupport';
export { AddTestRunViews1700000000005 } from './migrations/1700000000005-AddTestRunViews';
export { RemoveRedundantIndexes1700000000006 } from './migrations/1700000000006-RemoveRedundantIndexes';
export { DropRedundantDsMetricsIndexes1700000000007 } from './migrations/1700000000007-DropRedundantDsMetricsIndexes';
export { AddSparseMetricExclusions1700000000008 } from './migrations/1700000000008-AddSparseMetricExclusions';
export { RenameMetricClassificationToProvisionedTemplate1700000000009 } from './migrations/1700000000009-RenameMetricClassificationToProvisionedTemplate';
export { AddTimescaleDBCompressionPolicies1700000000010 } from './migrations/1700000000010-AddTimescaleDBCompressionPolicies';
export { ChangeGrafanaIdToBigint1700000000011 } from './migrations/1700000000011-ChangeGrafanaIdToBigint';
export { AddDeepLinkTags1700000000012 } from './migrations/1700000000012-AddDeepLinkTags';
export { CreateMetricsSourcesTable1700000000013 } from './migrations/1700000000013-CreateMetricsSourcesTable';
export { AddMetricsSourceIdColumns1700000000014 } from './migrations/1700000000014-AddMetricsSourceIdColumns';
export { BackfillMetricsSources1700000000015 } from './migrations/1700000000015-BackfillMetricsSources';
export { AddMetricsSourceIdToApplicationDashboard1700000000016 } from './migrations/1700000000016-AddMetricsSourceIdToApplicationDashboard';
export { MetricsSourceOneToOneAndNullableGrafana1700000000017 } from './migrations/1700000000017-MetricsSourceOneToOneAndNullableGrafana';
export { MigrateCompareConfigToMetricsSource1700000000018 } from './migrations/1700000000018-MigrateCompareConfigToMetricsSource';
export { DropNarrowCompareConfigUniqueConstraints1700000000019 } from './migrations/1700000000019-DropNarrowCompareConfigUniqueConstraints';
export { TuneAutovacuumForDsMetrics1700000000020 } from './migrations/1700000000020-TuneAutovacuumForDsMetrics';
export { FixAutovacuumThrottling1700000000021 } from './migrations/1700000000021-FixAutovacuumThrottling';
