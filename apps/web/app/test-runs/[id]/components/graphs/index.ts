/**
 * Graph preset components for saving and loading custom graph configurations
 *
 * This module provides UI components for managing graph presets:
 * - GraphPresetsTable: Display and manage saved presets
 * - SaveGraphPresetModal: Create new presets with validation
 *
 * @module graphs
 */

export { default as GraphPresetsTable } from './GraphPresetsTable';
export { default as SaveGraphPresetModal } from './SaveGraphPresetModal';
export type { GraphPresetFormData } from './SaveGraphPresetModal';
