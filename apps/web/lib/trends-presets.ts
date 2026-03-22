import { authenticatedFetch } from './api';

export enum PresetType {
  GENERIC = 'generic',
  SPECIFIC = 'specific'
}

export interface TrendsSeriesConfig {
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: 'grafana' | 'dynatrace' | 'performance-metrics';
  yAxisFormat?: string;
  metricsSourceId?: string;
}

export interface TrendsPreset {
  id: string;
  name: string;
  description?: string;
  preset_type: PresetType;
  application_dashboard_id?: string;
  panel_id?: number;
  panel_title?: string;
  evaluate_type?: string;
  source?: string;
  created_for_test_run_id: string;
  dashboard_label?: string;
  series_config?: TrendsSeriesConfig[];
  created_by?: string;
  is_global: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTrendsPresetRequest {
  name: string;
  description?: string;
  preset_type: PresetType;
  application_dashboard_id?: string;
  panel_id?: number;
  panel_title?: string;
  evaluate_type?: string;
  source?: string;
  dashboard_label?: string;
  series_config?: TrendsSeriesConfig[];
  created_for_test_run_id: string;
  is_global: boolean;
}

export const TrendsPresetsAPI = {
  async getAll(testRunId: string): Promise<TrendsPreset[]> {
    const response = await authenticatedFetch(`/trends-presets?testRunId=${testRunId}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch trends presets:', response.status, errorText);
      throw new Error(`Failed to fetch trends presets: ${response.status} ${errorText}`);
    }
    return response.json();
  },

  async create(data: CreateTrendsPresetRequest): Promise<TrendsPreset> {
    const response = await authenticatedFetch('/trends-presets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to create trends preset');
    }
    return response.json();
  },

  async delete(id: string): Promise<void> {
    const response = await authenticatedFetch(`/trends-presets/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete trends preset');
    }
  }
};