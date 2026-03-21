'use client';

// Re-export from refactored module
export { default } from './dashboard-form/DashboardFormDialog';

// Re-export types for backward compatibility
export type {
  GrafanaInstance,
  GrafanaDashboard,
  DashboardFormDialogProps,
} from './dashboard-form/types';
