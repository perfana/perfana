/**
 * Unit tests for Compare Presets API Client
 *
 * Tests the ComparePresetsAPI class and PresetUtils helper functions:
 * - CRUD operations for compare presets
 * - Error handling for API failures
 * - Preset utility functions (grouping, permissions, formatting)
 * - Authentication header integration
 */

import { ComparePresetsAPI, PresetUtils, PresetType, ComparePreset, CreateComparePresetRequest } from '@/lib/compare-presets';

// Mock authenticatedFetch
const mockAuthenticatedFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));

describe('ComparePresetsAPI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll()', () => {
    it('should fetch all presets without testRunId filter', async () => {
      const mockPresets: ComparePreset[] = [
        {
          id: '1',
          name: 'Test Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          created_by: 'user-123',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPresets
      });

      const result = await ComparePresetsAPI.getAll();

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/compare-presets');
      expect(result).toEqual(mockPresets);
    });

    it('should fetch presets filtered by testRunId', async () => {
      const mockPresets: ComparePreset[] = [];
      const testRunId = 'test-run-123';

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPresets
      });

      await ComparePresetsAPI.getAll(testRunId);

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `/compare-presets?testRunId=${encodeURIComponent(testRunId)}`
      );
    });

    it('should handle fetch errors', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error'
      });

      await expect(ComparePresetsAPI.getAll()).rejects.toThrow(
        'Failed to fetch compare presets: Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      mockAuthenticatedFetch.mockRejectedValue(new Error('Network error'));

      await expect(ComparePresetsAPI.getAll()).rejects.toThrow('Network error');
    });
  });

  describe('getById()', () => {
    it('should fetch preset by ID successfully', async () => {
      const mockPreset: ComparePreset = {
        id: 'preset-123',
        name: 'My Preset',
        preset_type: PresetType.SPECIFIC,
        show_percentiles: true,
        baseline_test_run_id: 'baseline-123',
        is_global: false,
        created_by: 'user-456',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPreset
      });

      const result = await ComparePresetsAPI.getById('preset-123');

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/compare-presets/preset-123');
      expect(result).toEqual(mockPreset);
    });

    it('should throw specific error for 404 not found', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(ComparePresetsAPI.getById('non-existent')).rejects.toThrow(
        'Compare preset not found'
      );
    });

    it('should throw generic error for other failures', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(ComparePresetsAPI.getById('preset-123')).rejects.toThrow(
        'Failed to fetch compare preset: Internal Server Error'
      );
    });
  });

  describe('create()', () => {
    it('should create a new preset successfully', async () => {
      const createRequest: CreateComparePresetRequest = {
        name: 'New Preset',
        description: 'Test description',
        preset_type: PresetType.GENERIC,
        series_search_text: 'cpu',
        show_percentiles: true,
        application_dashboard_id: 'dashboard-123',
        panel_id: 5,
        panel_title: 'CPU Usage',
        is_global: false
      };

      const mockCreatedPreset: ComparePreset = {
        id: 'new-preset-id',
        ...createRequest,
        created_by: 'user-123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCreatedPreset
      });

      const result = await ComparePresetsAPI.create(createRequest);

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/compare-presets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createRequest),
      });
      expect(result).toEqual(mockCreatedPreset);
    });

    it('should send correct headers for create request', async () => {
      const createRequest: CreateComparePresetRequest = {
        name: 'Test',
        preset_type: PresetType.GENERIC,
        show_percentiles: false,
        is_global: false
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...createRequest, id: '1', created_by: 'user', created_at: '', updated_at: '' })
      });

      await ComparePresetsAPI.create(createRequest);

      const callArgs = mockAuthenticatedFetch.mock.calls[0];
      expect(callArgs[1].headers).toEqual({
        'Content-Type': 'application/json',
      });
    });

    it('should handle creation errors with error text', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        text: async () => 'Validation failed: name is required'
      });

      await expect(
        ComparePresetsAPI.create({
          name: '',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false
        })
      ).rejects.toThrow('Failed to create compare preset: Validation failed: name is required');
    });

    it('should create preset with all optional fields', async () => {
      const fullRequest: CreateComparePresetRequest = {
        name: 'Full Preset',
        description: 'Complete preset with all fields',
        preset_type: PresetType.SPECIFIC,
        series_search_text: 'memory.*',
        show_percentiles: true,
        application_dashboard_id: 'app-dash-123',
        source: 'grafana',
        dashboard_label: 'Performance Dashboard',
        panel_id: 10,
        panel_title: 'Memory Usage',
        baseline_test_run_id: 'baseline-run-456',
        created_for_test_run_id: 'MyApp-prod-loadTest-00042',
        is_global: true
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...fullRequest, id: 'preset-id', created_by: 'user', created_at: '', updated_at: '' })
      });

      await ComparePresetsAPI.create(fullRequest);

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        '/compare-presets',
        expect.objectContaining({
          body: JSON.stringify(fullRequest)
        })
      );
    });

    it('should include created_for_test_run_id when provided', async () => {
      const createRequest: CreateComparePresetRequest = {
        name: 'Test Run Specific Preset',
        preset_type: PresetType.GENERIC,
        show_percentiles: false,
        created_for_test_run_id: 'PaymentService-prod-loadTest-20240115',
        is_global: false
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ...createRequest, id: 'preset-id', created_by: 'user', created_at: '', updated_at: '' })
      });

      await ComparePresetsAPI.create(createRequest);

      const callArgs = mockAuthenticatedFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.created_for_test_run_id).toBe('PaymentService-prod-loadTest-20240115');
    });
  });

  describe('update()', () => {
    it('should update preset successfully', async () => {
      const updateRequest = {
        name: 'Updated Name',
        description: 'Updated description'
      };

      const mockUpdatedPreset: ComparePreset = {
        id: 'preset-123',
        name: 'Updated Name',
        description: 'Updated description',
        preset_type: PresetType.GENERIC,
        show_percentiles: false,
        is_global: false,
        created_by: 'user-123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z'
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockUpdatedPreset
      });

      const result = await ComparePresetsAPI.update('preset-123', updateRequest);

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/compare-presets/preset-123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateRequest),
      });
      expect(result).toEqual(mockUpdatedPreset);
    });

    it('should throw specific error for 403 forbidden', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403
      });

      await expect(
        ComparePresetsAPI.update('preset-123', { name: 'New Name' })
      ).rejects.toThrow('You can only update your own presets');
    });

    it('should throw specific error for 404 not found', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(
        ComparePresetsAPI.update('non-existent', { name: 'New Name' })
      ).rejects.toThrow('Compare preset not found');
    });

    it('should handle update errors with error text', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid preset type'
      });

      await expect(
        ComparePresetsAPI.update('preset-123', { name: 'Test' })
      ).rejects.toThrow('Failed to update compare preset: Invalid preset type');
    });
  });

  describe('delete()', () => {
    it('should delete preset successfully', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: true
      });

      await ComparePresetsAPI.delete('preset-123');

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/compare-presets/preset-123', {
        method: 'DELETE',
      });
    });

    it('should throw specific error for 403 forbidden', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 403
      });

      await expect(ComparePresetsAPI.delete('preset-123')).rejects.toThrow(
        'You can only delete your own presets'
      );
    });

    it('should throw specific error for 404 not found', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(ComparePresetsAPI.delete('non-existent')).rejects.toThrow(
        'Compare preset not found'
      );
    });

    it('should handle generic delete errors', async () => {
      mockAuthenticatedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(ComparePresetsAPI.delete('preset-123')).rejects.toThrow(
        'Failed to delete compare preset: Internal Server Error'
      );
    });
  });
});

describe('PresetUtils', () => {
  const currentUserId = 'user-123';

  const createMockPreset = (overrides: Partial<ComparePreset> = {}): ComparePreset => ({
    id: 'preset-1',
    name: 'Test Preset',
    preset_type: PresetType.GENERIC,
    show_percentiles: false,
    is_global: false,
    created_by: currentUserId,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides
  });

  describe('groupPresets()', () => {
    it('should group presets into personal, global, and shared categories', () => {
      const presets: ComparePreset[] = [
        createMockPreset({ id: '1', created_by: currentUserId, is_global: false }),
        createMockPreset({ id: '2', created_by: currentUserId, is_global: true }),
        createMockPreset({ id: '3', created_by: 'other-user', is_global: false }),
        createMockPreset({ id: '4', created_by: 'other-user', is_global: true }),
        createMockPreset({ id: '5', created_by: currentUserId, is_global: false }),
      ];

      const result = PresetUtils.groupPresets(presets, currentUserId);

      expect(result.personal).toHaveLength(2);
      expect(result.personal.map(p => p.id)).toEqual(['1', '5']);

      expect(result.global).toHaveLength(2);
      expect(result.global.map(p => p.id)).toEqual(['2', '4']);

      expect(result.shared).toHaveLength(1);
      expect(result.shared.map(p => p.id)).toEqual(['3']);
    });

    it('should handle empty presets array', () => {
      const result = PresetUtils.groupPresets([], currentUserId);

      expect(result.personal).toHaveLength(0);
      expect(result.global).toHaveLength(0);
      expect(result.shared).toHaveLength(0);
    });

    it('should correctly categorize global presets created by current user', () => {
      const presets: ComparePreset[] = [
        createMockPreset({ created_by: currentUserId, is_global: true }),
      ];

      const result = PresetUtils.groupPresets(presets, currentUserId);

      expect(result.personal).toHaveLength(0);
      expect(result.global).toHaveLength(1);
      expect(result.shared).toHaveLength(0);
    });
  });

  describe('canModify()', () => {
    it('should return true when user created the preset', () => {
      const preset = createMockPreset({ created_by: currentUserId });

      expect(PresetUtils.canModify(preset, currentUserId)).toBe(true);
    });

    it('should return false when user did not create the preset', () => {
      const preset = createMockPreset({ created_by: 'other-user' });

      expect(PresetUtils.canModify(preset, currentUserId)).toBe(false);
    });

    it('should return false for global presets created by others', () => {
      const preset = createMockPreset({
        created_by: 'admin-user',
        is_global: true
      });

      expect(PresetUtils.canModify(preset, currentUserId)).toBe(false);
    });

    it('should return true for global presets created by current user', () => {
      const preset = createMockPreset({
        created_by: currentUserId,
        is_global: true
      });

      expect(PresetUtils.canModify(preset, currentUserId)).toBe(true);
    });
  });

  describe('getDisplayText()', () => {
    it('should return just the name for generic presets', () => {
      const preset = createMockPreset({
        name: 'CPU Metrics',
        preset_type: PresetType.GENERIC
      });

      expect(PresetUtils.getDisplayText(preset)).toBe('CPU Metrics');
    });

    it('should include baseline test run ID for specific presets', () => {
      const preset = createMockPreset({
        name: 'Memory Comparison',
        preset_type: PresetType.SPECIFIC,
        baseline_test_run_id: 'baseline-run-123'
      });

      expect(PresetUtils.getDisplayText(preset)).toBe('Memory Comparison (baseline-run-123)');
    });

    it('should add globe emoji for global presets', () => {
      const preset = createMockPreset({
        name: 'Global Preset',
        is_global: true
      });

      expect(PresetUtils.getDisplayText(preset)).toBe('Global Preset 🌍');
    });

    it('should combine baseline and global indicators', () => {
      const preset = createMockPreset({
        name: 'Performance Baseline',
        preset_type: PresetType.SPECIFIC,
        baseline_test_run_id: 'v1.0.0-baseline',
        is_global: true
      });

      expect(PresetUtils.getDisplayText(preset)).toBe('Performance Baseline (v1.0.0-baseline) 🌍');
    });

    it('should handle specific preset without baseline test run', () => {
      const preset = createMockPreset({
        name: 'Specific Preset',
        preset_type: PresetType.SPECIFIC
      });

      expect(PresetUtils.getDisplayText(preset)).toBe('Specific Preset');
    });
  });

  describe('getSummary()', () => {
    it('should return empty string when no details available', () => {
      const preset = createMockPreset({});

      expect(PresetUtils.getSummary(preset)).toBe('');
    });

    it('should include series filter in summary', () => {
      const preset = createMockPreset({
        series_search_text: 'cpu.*usage'
      });

      expect(PresetUtils.getSummary(preset)).toBe('Filter: "cpu.*usage"');
    });

    it('should include percentiles status in summary', () => {
      const preset = createMockPreset({
        show_percentiles: true
      });

      expect(PresetUtils.getSummary(preset)).toBe('Percentiles enabled');
    });

    it('should include panel title in summary', () => {
      const preset = createMockPreset({
        panel_title: 'CPU Usage Over Time'
      });

      expect(PresetUtils.getSummary(preset)).toBe('Panel: CPU Usage Over Time');
    });

    it('should include baseline for specific presets', () => {
      const preset = createMockPreset({
        preset_type: PresetType.SPECIFIC,
        baseline_test_run_id: 'prod-2024-01-01'
      });

      expect(PresetUtils.getSummary(preset)).toBe('Baseline: prod-2024-01-01');
    });

    it('should combine multiple summary parts with bullet separator', () => {
      const preset = createMockPreset({
        series_search_text: 'memory',
        show_percentiles: true,
        panel_title: 'Memory Dashboard',
        preset_type: PresetType.SPECIFIC,
        baseline_test_run_id: 'baseline-123'
      });

      const summary = PresetUtils.getSummary(preset);

      expect(summary).toContain('Filter: "memory"');
      expect(summary).toContain('Percentiles enabled');
      expect(summary).toContain('Panel: Memory Dashboard');
      expect(summary).toContain('Baseline: baseline-123');
      expect(summary.split(' • ')).toHaveLength(4);
    });

    it('should not include baseline for generic presets even if baseline_test_run_id exists', () => {
      const preset = createMockPreset({
        preset_type: PresetType.GENERIC,
        baseline_test_run_id: 'should-not-appear'
      });

      expect(PresetUtils.getSummary(preset)).toBe('');
    });

    it('should handle all fields together correctly', () => {
      const preset = createMockPreset({
        series_search_text: 'http.*latency',
        show_percentiles: true,
        panel_title: 'HTTP Latency P99'
      });

      expect(PresetUtils.getSummary(preset)).toBe(
        'Filter: "http.*latency" • Percentiles enabled • Panel: HTTP Latency P99'
      );
    });
  });
});
