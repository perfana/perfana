import { authenticatedFetch } from './api';

/**
 * Represents a single time series configuration for custom graphs
 */
export interface SeriesConfig {
  /** Grafana or Dynatrace application dashboard ID */
  dashboardId: string;
  /** Panel ID within the dashboard */
  panelId: number;
  /** Human-readable panel title */
  panelTitle: string;
  /** Optional series name filter/search text */
  metricName?: string;
  /** Data source type */
  source?: 'grafana' | 'dynatrace' | 'performance-metrics';
  /** Dashboard label for display purposes */
  dashboardLabel?: string;
  /** Y-axis format */
  yAxisFormat?: string;
  /** Metrics source ID (Phase 3.5) */
  metricsSourceId?: string;
}

/**
 * Graph preset entity returned from the API
 */
export interface GraphPreset {
  id: string;
  name: string;
  description?: string;
  seriesConfig: SeriesConfig[];
  testRunId?: string;
  isGlobal: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request payload for creating a new graph preset
 */
export interface CreateGraphPresetRequest {
  name: string;
  description?: string;
  seriesConfig: SeriesConfig[];
  testRunId?: string;
  isGlobal: boolean;
}

/**
 * Request payload for updating an existing graph preset
 */
export interface UpdateGraphPresetRequest extends Partial<CreateGraphPresetRequest> {}

/**
 * API client for managing graph presets
 *
 * Graph presets allow users to save and restore custom graph configurations
 * with multiple metric series from different dashboards and panels.
 */
export class GraphPresetsAPI {
  private static readonly BASE_URL = '/graph-presets';

  /**
   * Fetch all graph presets, optionally filtered by test run
   *
   * @param testRunId - Optional test run ID to filter presets
   * @returns Array of graph presets
   * @throws Error if the request fails
   */
  static async getAll(testRunId?: string): Promise<GraphPreset[]> {
    const url = testRunId
      ? `${this.BASE_URL}?testRunId=${encodeURIComponent(testRunId)}`
      : this.BASE_URL;

    const response = await authenticatedFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch graph presets: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch a single graph preset by ID
   *
   * @param id - Graph preset ID
   * @returns Graph preset entity
   * @throws Error if preset not found or request fails
   */
  static async getById(id: string): Promise<GraphPreset> {
    const response = await authenticatedFetch(`${this.BASE_URL}/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Graph preset not found');
      }
      throw new Error(`Failed to fetch graph preset: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Create a new graph preset
   *
   * @param preset - Graph preset data
   * @returns Created graph preset with generated ID
   * @throws Error if validation fails or request fails
   */
  static async create(preset: CreateGraphPresetRequest): Promise<GraphPreset> {
    const response = await authenticatedFetch(this.BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preset),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create graph preset: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Update an existing graph preset
   *
   * @param id - Graph preset ID
   * @param preset - Updated graph preset data
   * @returns Updated graph preset
   * @throws Error if not authorized, preset not found, or request fails
   */
  static async update(id: string, preset: UpdateGraphPresetRequest): Promise<GraphPreset> {
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
        throw new Error('Graph preset not found');
      }
      const errorText = await response.text();
      throw new Error(`Failed to update graph preset: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Delete a graph preset
   *
   * @param id - Graph preset ID
   * @throws Error if not authorized, preset not found, or request fails
   */
  static async delete(id: string): Promise<void> {
    const response = await authenticatedFetch(`${this.BASE_URL}/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('You can only delete your own presets');
      }
      if (response.status === 404) {
        throw new Error('Graph preset not found');
      }
      throw new Error(`Failed to delete graph preset: ${response.statusText}`);
    }
  }
}

/**
 * Utility functions for working with graph presets
 */
export const GraphPresetUtils = {
  /**
   * Generate a suggested preset name based on series configuration
   *
   * @param seriesConfig - Array of series configurations
   * @returns Suggested preset name
   */
  generatePresetName: (seriesConfig: SeriesConfig[]): string => {
    if (seriesConfig.length === 0) {
      return 'Custom Graph';
    }

    if (seriesConfig.length === 1) {
      return seriesConfig[0].panelTitle;
    }

    if (seriesConfig.length <= 3) {
      return seriesConfig.map(s => s.panelTitle).join(' + ');
    }

    return `Multi-metric Analysis (${seriesConfig.length} series)`;
  },

  /**
   * Generate a suggested description based on series configuration
   *
   * @param seriesConfig - Array of series configurations
   * @returns Suggested description
   */
  generateDescription: (seriesConfig: SeriesConfig[]): string => {
    const parts: string[] = [];

    // Group by dashboard
    const dashboardGroups = new Map<string, SeriesConfig[]>();
    seriesConfig.forEach(config => {
      const key = config.dashboardLabel || config.dashboardId;
      if (!dashboardGroups.has(key)) {
        dashboardGroups.set(key, []);
      }
      dashboardGroups.get(key)!.push(config);
    });

    // Add dashboard and panel info
    dashboardGroups.forEach((configs, dashboardLabel) => {
      const panelTitles = configs.map(c => c.panelTitle).join(', ');
      parts.push(`${dashboardLabel}: ${panelTitles}`);
    });

    return parts.join('. ') || 'Custom graph configuration';
  },

  /**
   * Check if user can edit/delete a preset
   *
   * @param preset - Graph preset
   * @param currentUserId - Current user's ID
   * @returns True if user can modify the preset
   */
  canModify: (preset: GraphPreset, currentUserId: string): boolean => {
    return preset.userId === currentUserId;
  },

  /**
   * Group presets by scope for display
   *
   * @param presets - Array of graph presets
   * @param currentUserId - Current user's ID
   * @returns Grouped presets
   */
  groupPresets: (presets: GraphPreset[], currentUserId: string) => {
    const personal = presets.filter(p => p.userId === currentUserId && !p.isGlobal);
    const global = presets.filter(p => p.isGlobal);
    const shared = presets.filter(p => p.userId !== currentUserId && !p.isGlobal);

    return {
      personal,
      global,
      shared
    };
  },

  /**
   * Get a summary of the preset for tooltip/description
   *
   * @param preset - Graph preset
   * @returns Summary text
   */
  getSummary: (preset: GraphPreset): string => {
    const parts = [];

    parts.push(`${preset.seriesConfig.length} series`);

    if (preset.testRunId) {
      parts.push(`Test Run: ${preset.testRunId}`);
    }

    if (preset.isGlobal) {
      parts.push('Global');
    }

    return parts.join(' • ');
  }
};
