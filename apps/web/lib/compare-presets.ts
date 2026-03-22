import { authenticatedFetch } from './api';

export enum PresetType {
  GENERIC = 'generic',
  SPECIFIC = 'specific'
}

export interface CompareSeriesConfig {
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: 'grafana' | 'dynatrace' | 'performance-metrics';
  metricsSourceId?: string;
}

export interface ComparePreset {
  id: string;
  name: string;
  description?: string;
  preset_type: PresetType;
  series_search_text?: string;
  show_percentiles: boolean;
  application_dashboard_id?: string;
  source?: string;
  dashboard_label?: string;
  panel_id?: number;
  panel_title?: string;
  baseline_test_run_id?: string;
  baseline_application_release?: string;
  baseline_annotations?: string[];
  series_config?: CompareSeriesConfig[];
  is_global: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateComparePresetRequest {
  name: string;
  description?: string;
  preset_type: PresetType;
  series_search_text?: string;
  show_percentiles: boolean;
  application_dashboard_id?: string;
  source?: string;
  dashboard_label?: string;
  panel_id?: number;
  panel_title?: string;
  baseline_test_run_id?: string;
  series_config?: CompareSeriesConfig[];
  created_for_test_run_id?: string;
  is_global: boolean;
}

export interface UpdateComparePresetRequest extends Partial<CreateComparePresetRequest> {}

export class ComparePresetsAPI {
  private static readonly BASE_URL = '/compare-presets';

  static async getAll(testRunId?: string): Promise<ComparePreset[]> {
    const url = testRunId 
      ? `${this.BASE_URL}?testRunId=${encodeURIComponent(testRunId)}`
      : this.BASE_URL;
    
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch compare presets: ${response.statusText}`);
    }
    return response.json();
  }

  static async getById(id: string): Promise<ComparePreset> {
    const response = await authenticatedFetch(`${this.BASE_URL}/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Compare preset not found');
      }
      throw new Error(`Failed to fetch compare preset: ${response.statusText}`);
    }
    return response.json();
  }

  static async create(preset: CreateComparePresetRequest): Promise<ComparePreset> {
    const response = await authenticatedFetch(this.BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preset),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create compare preset: ${errorText}`);
    }
    
    return response.json();
  }

  static async update(id: string, preset: UpdateComparePresetRequest): Promise<ComparePreset> {
    const response = await authenticatedFetch(`${this.BASE_URL}/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preset),
    });
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('You can only update your own presets');
      }
      if (response.status === 404) {
        throw new Error('Compare preset not found');
      }
      const errorText = await response.text();
      throw new Error(`Failed to update compare preset: ${errorText}`);
    }
    
    return response.json();
  }

  static async delete(id: string): Promise<void> {
    const response = await authenticatedFetch(`${this.BASE_URL}/${id}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('You can only delete your own presets');
      }
      if (response.status === 404) {
        throw new Error('Compare preset not found');
      }
      throw new Error(`Failed to delete compare preset: ${response.statusText}`);
    }
  }
}

// Utility functions for working with presets
export const PresetUtils = {
  /**
   * Group presets by ownership/scope for display
   */
  groupPresets: (presets: ComparePreset[], currentUserId: string) => {
    const personal = presets.filter(p => p.created_by === currentUserId && !p.is_global);
    const global = presets.filter(p => p.is_global);
    const shared = presets.filter(p => p.created_by !== currentUserId && !p.is_global);

    return {
      personal,
      global,
      shared
    };
  },

  /**
   * Check if user can edit/delete a preset
   */
  canModify: (preset: ComparePreset, currentUserId: string): boolean => {
    return preset.created_by === currentUserId;
  },

  /**
   * Format preset for display
   */
  getDisplayText: (preset: ComparePreset): string => {
    const parts = [preset.name];
    
    if (preset.preset_type === PresetType.SPECIFIC && preset.baseline_test_run_id) {
      parts.push(`(${preset.baseline_test_run_id})`);
    }
    
    if (preset.is_global) {
      parts.push('🌍');
    }
    
    return parts.join(' ');
  },

  /**
   * Get preset summary for tooltip/description
   */
  getSummary: (preset: ComparePreset): string => {
    const parts = [];
    
    if (preset.series_search_text) {
      parts.push(`Filter: "${preset.series_search_text}"`);
    }
    
    if (preset.show_percentiles) {
      parts.push('Percentiles enabled');
    }
    
    if (preset.panel_title) {
      parts.push(`Panel: ${preset.panel_title}`);
    }
    
    if (preset.preset_type === PresetType.SPECIFIC && preset.baseline_test_run_id) {
      parts.push(`Baseline: ${preset.baseline_test_run_id}`);
    }
    
    return parts.join(' • ');
  }
};