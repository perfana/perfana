/**
 * Copyright 2025 Perfana Contributors
 *
 * Shared types for auto-config module
 */

/**
 * Dashboard variable structure
 *
 * Format: [{ name: "service", values: ["value1"] }]
 */
export interface DashboardVariable {
  name: string;
  values: string[];
}

/**
 * Dashboard variables type - array of dashboard variables
 */
export type DashboardVariables = DashboardVariable[];
