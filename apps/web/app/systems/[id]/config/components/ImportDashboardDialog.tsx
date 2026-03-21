'use client';

/**
 * Re-export from refactored module structure
 * Original file: 576 lines -> refactored to modular architecture
 *
 * Module structure:
 * - types/: DashboardTile, ImportDashboardDialogProps, MetricUnitOption
 * - utils/: Dashboard parsing utilities (parseDashboardFile, extractVariablesFromQuery)
 * - hooks/: useImportDashboard for state management
 * - components/: FileUploadSection, ImportConfigSection, VariablesSection, TilesPreviewList
 */

export { ImportDashboardDialog as default } from './import-dashboard';
export type { DashboardTile, ImportDashboardDialogProps } from './import-dashboard';
