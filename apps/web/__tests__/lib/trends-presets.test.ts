/**
 * Unit tests for Trends Presets API Client
 *
 * Tests the trends presets management API object:
 * - TrendsPresetsAPI.getAll: Retrieve all trends presets for a test run
 * - TrendsPresetsAPI.create: Create a new trends preset
 * - TrendsPresetsAPI.delete: Delete a trends preset by ID
 *
 * Testing Standards:
 * - AAA pattern (Arrange, Act, Assert)
 * - Mock authenticatedFetch for all API calls
 * - Test happy paths, error cases, edge cases
 * - Test authentication header inclusion
 * - Test error message handling
 * - Aim for 95%+ coverage
 */

import {
  TrendsPresetsAPI,
  PresetType,
  type TrendsPreset,
  type CreateTrendsPresetRequest,
} from '@/lib/trends-presets';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

describe('Trends Presets API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TrendsPresetsAPI.getAll()', () => {
    describe('Happy Path Scenarios', () => {
      it('should fetch all trends presets for a test run', async () => {
        // Arrange
        const testRunId = 'test-run-123';
        const mockPresets: TrendsPreset[] = [
          {
            id: 'preset-1',
            name: 'Generic Performance Preset',
            description: 'Track overall performance metrics',
            preset_type: PresetType.GENERIC,
            created_for_test_run_id: testRunId,
            is_global: true,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          {
            id: 'preset-2',
            name: 'Specific Panel Preset',
            description: 'Track specific dashboard panel',
            preset_type: PresetType.SPECIFIC,
            application_dashboard_id: 'dashboard-123',
            panel_id: 42,
            panel_title: 'Response Time',
            dashboard_label: 'Performance Dashboard',
            evaluate_type: 'avg',
            source: 'grafana',
            created_for_test_run_id: testRunId,
            created_by: 'user-123',
            is_global: false,
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-02T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockPresets,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.getAll(testRunId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/trends-presets?testRunId=${testRunId}`
        );
        expect(result).toEqual(mockPresets);
        expect(result).toHaveLength(2);
      });

      it('should return empty array when no presets exist', async () => {
        // Arrange
        const testRunId = 'test-run-empty';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.getAll(testRunId);

        // Assert
        expect(result).toEqual([]);
      });

      it('should fetch presets with all optional fields populated', async () => {
        // Arrange
        const testRunId = 'test-run-456';
        const mockPresets: TrendsPreset[] = [
          {
            id: 'preset-full',
            name: 'Full Preset',
            description: 'Preset with all fields',
            preset_type: PresetType.SPECIFIC,
            application_dashboard_id: 'dashboard-999',
            panel_id: 100,
            panel_title: 'CPU Usage',
            dashboard_label: 'JVM Dashboard',
            evaluate_type: 'max',
            source: 'prometheus',
            created_for_test_run_id: testRunId,
            created_by: 'admin-user',
            is_global: true,
            created_at: '2025-01-15T10:00:00Z',
            updated_at: '2025-01-15T12:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockPresets,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.getAll(testRunId);

        // Assert
        expect(result[0]).toHaveProperty('description');
        expect(result[0]).toHaveProperty('application_dashboard_id');
        expect(result[0]).toHaveProperty('panel_id');
        expect(result[0]).toHaveProperty('panel_title');
        expect(result[0]).toHaveProperty('evaluate_type');
        expect(result[0]).toHaveProperty('source');
        expect(result[0]).toHaveProperty('created_by');
      });

      it('should handle UUID format test run ID', async () => {
        // Arrange
        const testRunId = '550e8400-e29b-41d4-a716-446655440000';
        const mockPresets: TrendsPreset[] = [];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockPresets,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.getAll(testRunId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/trends-presets?testRunId=${testRunId}`
        );
        expect(result).toEqual([]);
      });

      it('should distinguish between generic and specific preset types', async () => {
        // Arrange
        const testRunId = 'test-run-types';
        const mockPresets: TrendsPreset[] = [
          {
            id: 'generic-preset',
            name: 'Generic',
            preset_type: PresetType.GENERIC,
            created_for_test_run_id: testRunId,
            is_global: true,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          {
            id: 'specific-preset',
            name: 'Specific',
            preset_type: PresetType.SPECIFIC,
            application_dashboard_id: 'dash-1',
            panel_id: 1,
            created_for_test_run_id: testRunId,
            is_global: false,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ];

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockPresets,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.getAll(testRunId);

        // Assert
        expect(result[0].preset_type).toBe(PresetType.GENERIC);
        expect(result[1].preset_type).toBe(PresetType.SPECIFIC);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when fetch fails', async () => {
        // Arrange
        const testRunId = 'test-run-error';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        } as Response);

        // Mock console.error to avoid cluttering test output
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act & Assert
        await expect(TrendsPresetsAPI.getAll(testRunId)).rejects.toThrow(
          'Failed to fetch trends presets: 500 Internal Server Error'
        );

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to fetch trends presets:',
          500,
          'Internal Server Error'
        );

        consoleErrorSpy.mockRestore();
      });

      it('should handle 404 not found error', async () => {
        // Arrange
        const testRunId = 'non-existent-test-run';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => 'Test run not found',
        } as Response);

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act & Assert
        await expect(TrendsPresetsAPI.getAll(testRunId)).rejects.toThrow(
          'Failed to fetch trends presets: 404 Test run not found'
        );

        consoleErrorSpy.mockRestore();
      });

      it('should handle 401 unauthorized error', async () => {
        // Arrange
        const testRunId = 'test-run-unauth';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized',
        } as Response);

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act & Assert
        await expect(TrendsPresetsAPI.getAll(testRunId)).rejects.toThrow(
          'Failed to fetch trends presets: 401 Unauthorized'
        );

        consoleErrorSpy.mockRestore();
      });

      it('should handle network errors', async () => {
        // Arrange
        const testRunId = 'test-run-network-error';
        mockAuthenticatedFetch.mockRejectedValue(new Error('Network connection failed'));

        // Act & Assert
        await expect(TrendsPresetsAPI.getAll(testRunId)).rejects.toThrow(
          'Network connection failed'
        );
      });
    });
  });

  describe('TrendsPresetsAPI.create()', () => {
    describe('Happy Path Scenarios', () => {
      it('should create a generic trends preset', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'New Generic Preset',
          description: 'Track general metrics',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-123',
          is_global: true,
        };

        const mockCreatedPreset: TrendsPreset = {
          id: 'new-preset-id',
          ...createData,
          created_at: '2025-01-15T15:00:00Z',
          updated_at: '2025-01-15T15:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedPreset,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.create(createData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/trends-presets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createData),
        });
        expect(result).toEqual(mockCreatedPreset);
        expect(result.id).toBe('new-preset-id');
        expect(result.preset_type).toBe(PresetType.GENERIC);
      });

      it('should create a specific trends preset with panel details', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Specific Panel Preset',
          description: 'Track response time panel',
          preset_type: PresetType.SPECIFIC,
          application_dashboard_id: 'dashboard-456',
          panel_id: 25,
          panel_title: 'API Response Time',
          dashboard_label: 'API Performance',
          evaluate_type: 'avg',
          source: 'grafana',
          created_for_test_run_id: 'test-run-456',
          is_global: false,
        };

        const mockCreatedPreset: TrendsPreset = {
          id: 'specific-preset-id',
          ...createData,
          created_at: '2025-01-15T15:30:00Z',
          updated_at: '2025-01-15T15:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedPreset,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.create(createData);

        // Assert
        expect(result.preset_type).toBe(PresetType.SPECIFIC);
        expect(result.panel_id).toBe(25);
        expect(result.panel_title).toBe('API Response Time');
        expect(result.application_dashboard_id).toBe('dashboard-456');
      });

      it('should create preset without optional description', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Minimal Preset',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-789',
          is_global: true,
        };

        const mockCreatedPreset: TrendsPreset = {
          id: 'minimal-preset-id',
          ...createData,
          created_at: '2025-01-15T16:00:00Z',
          updated_at: '2025-01-15T16:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedPreset,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.create(createData);

        // Assert
        expect(result.description).toBeUndefined();
        expect(result.name).toBe('Minimal Preset');
      });

      it('should create non-global preset', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Private Preset',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-abc',
          is_global: false,
        };

        const mockCreatedPreset: TrendsPreset = {
          id: 'private-preset-id',
          ...createData,
          created_at: '2025-01-15T16:30:00Z',
          updated_at: '2025-01-15T16:30:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedPreset,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.create(createData);

        // Assert
        expect(result.is_global).toBe(false);
      });

      it('should create preset with all optional fields', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Full Featured Preset',
          description: 'Preset with all fields populated',
          preset_type: PresetType.SPECIFIC,
          application_dashboard_id: 'dashboard-999',
          panel_id: 99,
          panel_title: 'Memory Usage',
          dashboard_label: 'JVM Metrics',
          evaluate_type: 'max',
          source: 'prometheus',
          created_for_test_run_id: 'test-run-full',
          is_global: true,
        };

        const mockCreatedPreset: TrendsPreset = {
          id: 'full-preset-id',
          ...createData,
          created_by: 'user-123',
          created_at: '2025-01-15T17:00:00Z',
          updated_at: '2025-01-15T17:00:00Z',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockCreatedPreset,
        } as Response);

        // Act
        const result = await TrendsPresetsAPI.create(createData);

        // Assert
        expect(result).toHaveProperty('application_dashboard_id');
        expect(result).toHaveProperty('panel_id');
        expect(result).toHaveProperty('panel_title');
        expect(result).toHaveProperty('evaluate_type');
        expect(result).toHaveProperty('source');
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when creation fails', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Invalid Preset',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-invalid',
          is_global: true,
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 400,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.create(createData)).rejects.toThrow(
          'Failed to create trends preset'
        );
      });

      it('should handle duplicate name errors', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Duplicate Name',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-123',
          is_global: true,
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 409,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.create(createData)).rejects.toThrow(
          'Failed to create trends preset'
        );
      });

      it('should handle unauthorized errors', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Unauthorized Preset',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-unauth',
          is_global: true,
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 401,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.create(createData)).rejects.toThrow(
          'Failed to create trends preset'
        );
      });

      it('should handle validation errors', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: '',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-123',
          is_global: true,
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 400,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.create(createData)).rejects.toThrow(
          'Failed to create trends preset'
        );
      });

      it('should handle network errors', async () => {
        // Arrange
        const createData: CreateTrendsPresetRequest = {
          name: 'Network Error Preset',
          preset_type: PresetType.GENERIC,
          created_for_test_run_id: 'test-run-network',
          is_global: true,
        };

        mockAuthenticatedFetch.mockRejectedValue(new Error('Network timeout'));

        // Act & Assert
        await expect(TrendsPresetsAPI.create(createData)).rejects.toThrow('Network timeout');
      });
    });
  });

  describe('TrendsPresetsAPI.delete()', () => {
    describe('Happy Path Scenarios', () => {
      it('should delete a trends preset successfully', async () => {
        // Arrange
        const presetId = 'preset-to-delete-123';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
        } as Response);

        // Act
        await TrendsPresetsAPI.delete(presetId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/trends-presets/${presetId}`, {
          method: 'DELETE',
        });
      });

      it('should delete preset with UUID format ID', async () => {
        // Arrange
        const presetId = '550e8400-e29b-41d4-a716-446655440000';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
        } as Response);

        // Act
        await TrendsPresetsAPI.delete(presetId);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(`/trends-presets/${presetId}`, {
          method: 'DELETE',
        });
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when deletion fails', async () => {
        // Arrange
        const presetId = 'preset-error';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.delete(presetId)).rejects.toThrow(
          'Failed to delete trends preset'
        );
      });

      it('should handle preset not found errors', async () => {
        // Arrange
        const presetId = 'non-existent-preset';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.delete(presetId)).rejects.toThrow(
          'Failed to delete trends preset'
        );
      });

      it('should handle unauthorized deletion', async () => {
        // Arrange
        const presetId = 'protected-preset';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 401,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.delete(presetId)).rejects.toThrow(
          'Failed to delete trends preset'
        );
      });

      it('should handle forbidden deletion (insufficient permissions)', async () => {
        // Arrange
        const presetId = 'global-preset';

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 403,
        } as Response);

        // Act & Assert
        await expect(TrendsPresetsAPI.delete(presetId)).rejects.toThrow(
          'Failed to delete trends preset'
        );
      });

      it('should handle network errors during deletion', async () => {
        // Arrange
        const presetId = 'preset-network-error';
        mockAuthenticatedFetch.mockRejectedValue(new Error('Connection refused'));

        // Act & Assert
        await expect(TrendsPresetsAPI.delete(presetId)).rejects.toThrow('Connection refused');
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete lifecycle: create -> fetch -> delete', async () => {
      // Arrange
      const testRunId = 'lifecycle-test-run';
      const createData: CreateTrendsPresetRequest = {
        name: 'Lifecycle Preset',
        description: 'Test lifecycle operations',
        preset_type: PresetType.GENERIC,
        created_for_test_run_id: testRunId,
        is_global: true,
      };

      const createdPreset: TrendsPreset = {
        id: 'lifecycle-preset-id',
        ...createData,
        created_at: '2025-01-15T18:00:00Z',
        updated_at: '2025-01-15T18:00:00Z',
      };

      // Mock create
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdPreset,
      } as Response);

      // Mock getAll
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [createdPreset],
      } as Response);

      // Mock delete
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      // Act
      const created = await TrendsPresetsAPI.create(createData);
      const presets = await TrendsPresetsAPI.getAll(testRunId);
      await TrendsPresetsAPI.delete(created.id);

      // Assert
      expect(created.id).toBe('lifecycle-preset-id');
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe(created.id);
      expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle creating multiple presets for the same test run', async () => {
      // Arrange
      const testRunId = 'multi-preset-test-run';
      const preset1Data: CreateTrendsPresetRequest = {
        name: 'Generic Preset',
        preset_type: PresetType.GENERIC,
        created_for_test_run_id: testRunId,
        is_global: true,
      };
      const preset2Data: CreateTrendsPresetRequest = {
        name: 'Specific Preset',
        preset_type: PresetType.SPECIFIC,
        application_dashboard_id: 'dashboard-1',
        panel_id: 1,
        created_for_test_run_id: testRunId,
        is_global: false,
      };

      const createdPreset1: TrendsPreset = {
        id: 'preset-1',
        ...preset1Data,
        created_at: '2025-01-15T19:00:00Z',
        updated_at: '2025-01-15T19:00:00Z',
      };
      const createdPreset2: TrendsPreset = {
        id: 'preset-2',
        ...preset2Data,
        created_at: '2025-01-15T19:01:00Z',
        updated_at: '2025-01-15T19:01:00Z',
      };

      // Mock creates
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdPreset1,
      } as Response);
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createdPreset2,
      } as Response);

      // Mock getAll
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [createdPreset1, createdPreset2],
      } as Response);

      // Act
      const created1 = await TrendsPresetsAPI.create(preset1Data);
      const created2 = await TrendsPresetsAPI.create(preset2Data);
      const allPresets = await TrendsPresetsAPI.getAll(testRunId);

      // Assert
      expect(created1.preset_type).toBe(PresetType.GENERIC);
      expect(created2.preset_type).toBe(PresetType.SPECIFIC);
      expect(allPresets).toHaveLength(2);
      expect(allPresets.some(p => p.id === created1.id)).toBe(true);
      expect(allPresets.some(p => p.id === created2.id)).toBe(true);
    });

    it('should handle fetching presets with different panel IDs', async () => {
      // Arrange
      const testRunId = 'multi-panel-test-run';
      const mockPresets: TrendsPreset[] = [
        {
          id: 'preset-panel-1',
          name: 'Panel 1 Preset',
          preset_type: PresetType.SPECIFIC,
          application_dashboard_id: 'dashboard-1',
          panel_id: 1,
          panel_title: 'Response Time',
          created_for_test_run_id: testRunId,
          is_global: false,
          created_at: '2025-01-15T20:00:00Z',
          updated_at: '2025-01-15T20:00:00Z',
        },
        {
          id: 'preset-panel-2',
          name: 'Panel 2 Preset',
          preset_type: PresetType.SPECIFIC,
          application_dashboard_id: 'dashboard-1',
          panel_id: 2,
          panel_title: 'Throughput',
          created_for_test_run_id: testRunId,
          is_global: false,
          created_at: '2025-01-15T20:01:00Z',
          updated_at: '2025-01-15T20:01:00Z',
        },
      ];

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPresets,
      } as Response);

      // Act
      const presets = await TrendsPresetsAPI.getAll(testRunId);

      // Assert
      expect(presets).toHaveLength(2);
      expect(presets[0].panel_id).toBe(1);
      expect(presets[1].panel_id).toBe(2);
      expect(presets[0].application_dashboard_id).toBe(presets[1].application_dashboard_id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long preset names', async () => {
      // Arrange
      const longName = 'A'.repeat(500);
      const createData: CreateTrendsPresetRequest = {
        name: longName,
        preset_type: PresetType.GENERIC,
        created_for_test_run_id: 'test-run-123',
        is_global: true,
      };

      const mockCreatedPreset: TrendsPreset = {
        id: 'long-name-preset',
        ...createData,
        created_at: '2025-01-15T21:00:00Z',
        updated_at: '2025-01-15T21:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCreatedPreset,
      } as Response);

      // Act
      const result = await TrendsPresetsAPI.create(createData);

      // Assert
      expect(result.name).toBe(longName);
    });

    it('should handle special characters in preset name', async () => {
      // Arrange
      const createData: CreateTrendsPresetRequest = {
        name: 'Test <>&"\' Preset',
        preset_type: PresetType.GENERIC,
        created_for_test_run_id: 'test-run-special',
        is_global: true,
      };

      const mockCreatedPreset: TrendsPreset = {
        id: 'special-chars-preset',
        ...createData,
        created_at: '2025-01-15T21:30:00Z',
        updated_at: '2025-01-15T21:30:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCreatedPreset,
      } as Response);

      // Act
      const result = await TrendsPresetsAPI.create(createData);

      // Assert
      expect(result.name).toBe('Test <>&"\' Preset');
    });

    it('should handle zero panel_id', async () => {
      // Arrange
      const createData: CreateTrendsPresetRequest = {
        name: 'Panel Zero Preset',
        preset_type: PresetType.SPECIFIC,
        application_dashboard_id: 'dashboard-1',
        panel_id: 0,
        created_for_test_run_id: 'test-run-zero',
        is_global: false,
      };

      const mockCreatedPreset: TrendsPreset = {
        id: 'panel-zero-preset',
        ...createData,
        created_at: '2025-01-15T22:00:00Z',
        updated_at: '2025-01-15T22:00:00Z',
      };

      mockAuthenticatedFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCreatedPreset,
      } as Response);

      // Act
      const result = await TrendsPresetsAPI.create(createData);

      // Assert
      expect(result.panel_id).toBe(0);
    });
  });
});
