/**
 * Unit tests for Anomaly API Client
 *
 * Tests the anomaly data management functions:
 * - deleteAnomalyData: Delete anomaly data by scope (metric/panel) and range (current/all test runs)
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
  deleteAnomalyData,
  type DeleteAnomalyRequest,
  type DeleteAnomalyResponse,
  type DeleteAnomalyOptions,
} from '@/lib/anomaly-api';
import * as api from '@/lib/api';

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = api.authenticatedFetch as jest.MockedFunction<
  typeof api.authenticatedFetch
>;

describe('Anomaly API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('deleteAnomalyData()', () => {
    describe('Happy Path Scenarios', () => {
      it('should delete anomaly data for a specific metric in current test run', async () => {
        // Arrange
        const testRunId = 'test-run-123';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Performance Dashboard',
          panelTitle: 'Response Time',
          metricName: 'p95_response_time',
          panelId: '42',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Successfully deleted anomaly data',
          deletedCount: 5,
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/test-runs/${testRunId}/anomaly-data`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
          }
        );
        expect(result).toEqual(mockResponse);
        expect(result.deletedCount).toBe(5);
        expect(result.scope).toBe('metric');
      });

      it('should delete anomaly data for entire panel in current test run', async () => {
        // Arrange
        const testRunId = 'test-run-456';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'JVM Dashboard',
          panelTitle: 'Memory Usage',
          panelId: '15',
          applicationDashboardId: 'app-dash-2',
          scope: 'panel',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Successfully deleted panel anomaly data',
          deletedCount: 12,
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(12);
        expect(result.scope).toBe('panel');
        expect(requestData.metricName).toBeUndefined(); // Panel scope doesn't need metric name
      });

      it('should delete anomaly data for a metric across all test runs', async () => {
        // Arrange
        const testRunId = 'test-run-789';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'HTTP Dashboard',
          panelTitle: 'Request Rate',
          metricName: 'requests_per_second',
          panelId: '8',
          applicationDashboardId: 'app-dash-3',
          scope: 'metric',
          range: 'all-test-runs',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Successfully deleted anomaly data across all test runs',
          deletedCount: 45,
          scope: 'metric',
          range: 'all-test-runs',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(45);
        expect(result.range).toBe('all-test-runs');
      });

      it('should delete anomaly data for entire panel across all test runs', async () => {
        // Arrange
        const testRunId = 'test-run-abc';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Database Dashboard',
          panelTitle: 'Connection Pool',
          panelId: '23',
          applicationDashboardId: 'app-dash-4',
          scope: 'panel',
          range: 'all-test-runs',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Successfully deleted panel data across all test runs',
          deletedCount: 100,
          scope: 'panel',
          range: 'all-test-runs',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(100);
        expect(result.scope).toBe('panel');
        expect(result.range).toBe('all-test-runs');
      });

      it('should return zero deletedCount when no anomaly data exists', async () => {
        // Arrange
        const testRunId = 'test-run-empty';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Empty Dashboard',
          panelTitle: 'No Data Panel',
          metricName: 'non_existent_metric',
          panelId: '99',
          applicationDashboardId: 'app-dash-5',
          scope: 'metric',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'No anomaly data found',
          deletedCount: 0,
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(0);
        expect(result.message).toBe('No anomaly data found');
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error with message when deletion fails with error response', async () => {
        // Arrange
        const testRunId = 'test-run-error';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Invalid panel ID format' }),
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Invalid panel ID format'
        );
      });

      it('should throw generic error when error response has no message', async () => {
        // Arrange
        const testRunId = 'test-run-generic';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'test_metric',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({}),
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Failed to delete anomaly data'
        );
      });

      it('should throw generic error when error response JSON parsing fails', async () => {
        // Arrange
        const testRunId = 'test-run-parse-error';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'all-test-runs',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('JSON parse error');
          },
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Failed to delete anomaly data'
        );
      });

      it('should handle 404 not found error', async () => {
        // Arrange
        const testRunId = 'non-existent-test-run';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'test_metric',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Test run not found' }),
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Test run not found'
        );
      });

      it('should handle 401 unauthorized error', async () => {
        // Arrange
        const testRunId = 'test-run-unauth';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ message: 'Authentication required' }),
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Authentication required'
        );
      });

      it('should handle 403 forbidden error', async () => {
        // Arrange
        const testRunId = 'test-run-forbidden';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'all-test-runs',
          metricName: 'test_metric',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({ message: 'Insufficient permissions to delete all test runs data' }),
        } as Response);

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Insufficient permissions to delete all test runs data'
        );
      });

      it('should handle network errors', async () => {
        // Arrange
        const testRunId = 'test-run-network-error';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockRejectedValue(new Error('Network connection failed'));

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Network connection failed'
        );
      });

      it('should handle timeout errors', async () => {
        // Arrange
        const testRunId = 'test-run-timeout';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'all-test-runs',
          metricName: 'test_metric',
        };

        mockAuthenticatedFetch.mockRejectedValue(new Error('Request timeout'));

        // Act & Assert
        await expect(deleteAnomalyData(testRunId, requestData)).rejects.toThrow(
          'Request timeout'
        );
      });
    });

    describe('Edge Cases', () => {
      it('should handle very long dashboard labels', async () => {
        // Arrange
        const testRunId = 'test-run-long-label';
        const longLabel = 'A'.repeat(500);
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: longLabel,
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Success',
          deletedCount: 1,
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(1);
        const callArgs = mockAuthenticatedFetch.mock.calls[0][1];
        expect(callArgs?.body).toContain(longLabel);
      });

      it('should handle special characters in panel title', async () => {
        // Arrange
        const testRunId = 'test-run-special-chars';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel: <>"&\' Test',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Success',
          deletedCount: 3,
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(3);
      });

      it('should handle numeric panelId as string', async () => {
        // Arrange
        const testRunId = 'test-run-numeric-panel';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '12345',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'metric',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Success',
          deletedCount: 1,
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(1);
        expect(requestData.panelId).toBe('12345');
      });

      it('should handle UUID format test run ID', async () => {
        // Arrange
        const testRunId = '550e8400-e29b-41d4-a716-446655440000';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Success',
          deletedCount: 2,
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          `/test-runs/${testRunId}/anomaly-data`,
          expect.any(Object)
        );
        expect(result.deletedCount).toBe(2);
      });

      it('should properly serialize complex metric names', async () => {
        // Arrange
        const testRunId = 'test-run-complex-metric';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'http.server.requests{status="200",method="GET"}',
        };

        const mockResponse: DeleteAnomalyResponse = {
          message: 'Success',
          deletedCount: 8,
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result.deletedCount).toBe(8);
        const callArgs = mockAuthenticatedFetch.mock.calls[0][1];
        const bodyData = JSON.parse(callArgs?.body as string);
        expect(bodyData.metricName).toBe('http.server.requests{status="200",method="GET"}');
      });
    });

    describe('Request Body Validation', () => {
      it('should include all required fields in request body', async () => {
        // Arrange
        const testRunId = 'test-run-validation';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Test Dashboard',
          panelTitle: 'Test Panel',
          metricName: 'test_metric',
          panelId: '42',
          applicationDashboardId: 'app-dash-123',
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            message: 'Success',
            deletedCount: 1,
            scope: 'metric',
            range: 'current-test-run',
          }),
        } as Response);

        // Act
        await deleteAnomalyData(testRunId, requestData);

        // Assert
        const callArgs = mockAuthenticatedFetch.mock.calls[0][1];
        const bodyData = JSON.parse(callArgs?.body as string);

        expect(bodyData).toHaveProperty('dashboardLabel', 'Test Dashboard');
        expect(bodyData).toHaveProperty('panelTitle', 'Test Panel');
        expect(bodyData).toHaveProperty('metricName', 'test_metric');
        expect(bodyData).toHaveProperty('panelId', '42');
        expect(bodyData).toHaveProperty('applicationDashboardId', 'app-dash-123');
        expect(bodyData).toHaveProperty('scope', 'metric');
        expect(bodyData).toHaveProperty('range', 'current-test-run');
      });

      it('should include metricName for metric scope', async () => {
        // Arrange
        const testRunId = 'test-run-metric-scope';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          metricName: 'important_metric',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            message: 'Success',
            deletedCount: 1,
            scope: 'metric',
            range: 'current-test-run',
          }),
        } as Response);

        // Act
        await deleteAnomalyData(testRunId, requestData);

        // Assert
        const callArgs = mockAuthenticatedFetch.mock.calls[0][1];
        const bodyData = JSON.parse(callArgs?.body as string);
        expect(bodyData.metricName).toBe('important_metric');
      });

      it('should not require metricName for panel scope', async () => {
        // Arrange
        const testRunId = 'test-run-panel-scope';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'panel',
          range: 'current-test-run',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            message: 'Success',
            deletedCount: 10,
            scope: 'panel',
            range: 'current-test-run',
          }),
        } as Response);

        // Act
        await deleteAnomalyData(testRunId, requestData);

        // Assert
        const callArgs = mockAuthenticatedFetch.mock.calls[0][1];
        const bodyData = JSON.parse(callArgs?.body as string);
        expect(bodyData.metricName).toBeUndefined();
        expect(bodyData.scope).toBe('panel');
      });
    });

    describe('Response Validation', () => {
      it('should return response with all expected fields', async () => {
        // Arrange
        const testRunId = 'test-run-response';
        const requestData: DeleteAnomalyRequest = {
          dashboardLabel: 'Dashboard',
          panelTitle: 'Panel',
          panelId: '1',
          applicationDashboardId: 'app-dash-1',
          scope: 'metric',
          range: 'all-test-runs',
          metricName: 'test_metric',
        };

        const expectedResponse: DeleteAnomalyResponse = {
          message: 'Deleted successfully',
          deletedCount: 25,
          scope: 'metric',
          range: 'all-test-runs',
        };

        mockAuthenticatedFetch.mockResolvedValue({
          ok: true,
          json: async () => expectedResponse,
        } as Response);

        // Act
        const result = await deleteAnomalyData(testRunId, requestData);

        // Assert
        expect(result).toHaveProperty('message');
        expect(result).toHaveProperty('deletedCount');
        expect(result).toHaveProperty('scope');
        expect(result).toHaveProperty('range');
        expect(typeof result.message).toBe('string');
        expect(typeof result.deletedCount).toBe('number');
      });
    });
  });
});
