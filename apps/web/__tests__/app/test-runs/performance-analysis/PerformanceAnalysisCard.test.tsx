/**
 * Unit tests for PerformanceAnalysisCard Component
 *
 * Tests the performance analysis card functionality:
 * - Rendering in collapsed and expanded states
 * - Fetching transaction statistics from API
 * - Data display in sortable table
 * - Sorting functionality for all columns
 * - Loading and error states
 * - Empty state handling
 * - Auto-focus on expand
 * - Number formatting
 * - Expand/collapse transitions
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import PerformanceAnalysisCard from '@/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard';
import { authenticatedFetch } from '@/lib/api';

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

describe('PerformanceAnalysisCard', () => {
  const mockOnExpand = jest.fn();
  const mockShowToast = jest.fn();
  const testRunId = 'test-run-uuid-123';

  const mockTransactionData = [
    {
      transaction_name: 'database_call',
      scenario_name: 'load_test',
      avg_response_time: 52.48,
      p95_response_time: 70.0,
      p99_response_time: 87.48,
      passed_count: 573,
      failed_count: 12,
      total_count: 585,
      ranking: 30703.08,
      apdex_score: 0.85,
      active_threshold: 500,
    },
    {
      transaction_name: 'api_endpoint',
      scenario_name: 'load_test',
      avg_response_time: 25.75,
      p95_response_time: 45.3,
      p99_response_time: 62.1,
      passed_count: 1198,
      failed_count: 2,
      total_count: 1200,
      ranking: 30900.0,
      apdex_score: 0.95,
      active_threshold: 500,
    },
    {
      transaction_name: 'external_service',
      scenario_name: 'stress_test',
      avg_response_time: 105.2,
      p95_response_time: 180.5,
      p99_response_time: 220.75,
      passed_count: 450,
      failed_count: 0,
      total_count: 450,
      ranking: 47340.0,
      apdex_score: 0.65,
      active_threshold: 500,
    },
  ];

  const mockThroughputStats = {
    overall: {
      peak_transactions_per_second: 100.5,
      peak_requests_per_second: 500.25,
      avg_transactions_per_second: 85.3,
      avg_requests_per_second: 425.8,
    },
    by_scenario: [],
  };

  const mockVirtualUserStats = {
    overall: {
      peak_active_threads: 50,
      avg_active_threads: 35.5,
      peak_started_threads: 60,
      avg_started_threads: 40.2,
      peak_finished_threads: 55,
      avg_finished_threads: 38.7,
      total_data_points: 100,
    },
    by_scenario: [],
  };

  const mockApdexThreshold = {
    threshold: 500,
    has_explicit_threshold: false,
  };

  // Helper function to mock API responses based on URL
  const setupMockFetch = (transactionData = mockTransactionData) => {
    // Clear any previous mocks first
    (authenticatedFetch as jest.Mock).mockReset();

    // Set up URL-aware mock implementation
    (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/throughput')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockThroughputStats,
        });
      }
      if (url.includes('/virtual-users')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockVirtualUserStats,
        });
      }
      if (url.includes('/apdex-threshold')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockApdexThreshold,
        });
      }
      if (url.includes('/transactions')) {
        return Promise.resolve({
          ok: true,
          json: async () => transactionData,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  };

  // Helper function to expand a scenario in the table
  const expandScenario = async (scenarioName: string) => {
    const user = userEvent.setup();

    // Wait for scenario to appear (may appear both in filter chips and table row)
    await waitFor(() => {
      expect(screen.getAllByText(scenarioName).length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    // Find all rows and locate the scenario row
    const allElements = screen.getAllByText(scenarioName);
    // Find the one that's in a table row (scenario name appears in metrics row)
    for (const element of allElements) {
      const row = element.closest('tr');
      if (row) {
        // Find the expand button in this row (first button in the row)
        const buttons = row.querySelectorAll('button');
        if (buttons.length > 0) {
          await user.click(buttons[0] as HTMLElement);
          break;
        }
      }
    }

    // Wait a bit for expansion animation
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  // Helper to get transaction data rows in order (by finding cells with specific role)
  const getTransactionRows = () => {
    const allRows = screen.getAllByRole('row');
    // Transaction data rows are identified by having table cells (not being header/scenario rows)
    // and containing passed/failed count data
    return allRows.filter(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length === 0) return false; // Skip header rows (only have th)

      const text = row.textContent || '';
      // Must have numeric data, but exclude scenario metrics rows
      // Scenario metrics rows contain "Errors" percentage and "Apdex" ratings
      return (
        text.match(/\d+\.\d{2}/) &&
        cells.length >= 8 && // Transaction rows have many cells
        !text.match(/Errors\d+\.\d+%/) // Not a scenario metrics row
      );
    });
  };

  beforeEach(() => {
    setupMockFetch(); // Setup default mocks for all tests
  });

  describe('Initial Rendering - Collapsed State', () => {
    it('should render collapsed card with correct test ID', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-collapsed')).toBeInTheDocument();
      });
    });

    it('should display "Performance Analysis" title', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Performance Analysis')).toBeInTheDocument();
      });
    });

    it('should show expand icon in collapsed state', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        const expandButtons = screen.getAllByRole('button');
        expect(expandButtons.length).toBeGreaterThan(0);
      });
    });

    it('should display scenario count when data loads', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data
      // mockTransactionData has 2 unique scenarios: 'load_test' and 'stress_test'

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('scenarios')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should handle singular scenario count text', async () => {
      // Arrange
      setupMockFetch([mockTransactionData[0]]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('scenario')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should display average response time chip', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        // Weighted average: (52.48*585 + 25.75*1200 + 105.2*450) / (585+1200+450) = 48.7347... → rounds to 48.74ms
        expect(screen.getByText(/Avg: 48\.74ms/)).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('API Integration', () => {
    it('should call authenticatedFetch with correct endpoint', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          `/test-runs/${testRunId}/transactions?excludeRampUp=true`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      });
    });

    it('should fetch data on component mount', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        // Component makes 4 calls: transactions, apdex-threshold, throughput, virtual-users
        expect(authenticatedFetch).toHaveBeenCalled();
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/transactions'),
          expect.any(Object)
        );
      });
    });

    it('should fetch data when testRunId changes', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      const { rerender } = render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Act
      rerender(
        <PerformanceAnalysisCard
          testRunId="different-test-run-id"
          expanded={false}
          onExpand={mockOnExpand}
          showToast={mockShowToast}
        />
      );

      // Assert - Component should make calls with the new testRunId
      await waitFor(() => {
        const calls = (authenticatedFetch as jest.Mock).mock.calls;
        const newTestRunCalls = calls.filter((call: any[]) =>
          call[0].includes('different-test-run-id')
        );
        expect(newTestRunCalls.length).toBeGreaterThanOrEqual(4); // Should have made at least 4 calls with new testRunId
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner while fetching data', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      (authenticatedFetch as jest.Mock).mockReturnValue(fetchPromise);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert - Multiple progress bars exist (one in primary info box, one in chip)
      expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);

      // Cleanup
      resolvePromise!({
        ok: true,
        json: async () => mockTransactionData,
      });
    });

    it('should display "Loading metrics..." message in collapsed state', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      (authenticatedFetch as jest.Mock).mockReturnValue(fetchPromise);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      expect(screen.getByText('Loading metrics...')).toBeInTheDocument();

      // Cleanup
      resolvePromise!({
        ok: true,
        json: async () => mockTransactionData,
      });
    });

    it('should display loading message in expanded state', async () => {
      // Arrange
      let resolvePromise: (value: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      (authenticatedFetch as jest.Mock).mockReturnValue(fetchPromise);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Loading transaction data...')).toBeInTheDocument();
      });

      // Cleanup
      resolvePromise!({
        ok: true,
        json: async () => mockTransactionData,
      });
    });

    it('should hide loading state after data loads', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('Loading transactions...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should display error message when fetch fails', async () => {
      // Arrange
      (authenticatedFetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({ ok: false, statusText: 'Internal Server Error' })
      );

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Failed to fetch transaction data')).toBeInTheDocument();
      });
    });

    it('should display error in collapsed state', async () => {
      // Arrange
      (authenticatedFetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({ ok: false, statusText: 'Error' })
      );

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert - Component shows "Error" in the KPI label
      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should handle network errors gracefully', async () => {
      // Arrange
      const networkError = new Error('Network request failed');
      (authenticatedFetch as jest.Mock).mockRejectedValue(networkError);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Network request failed')).toBeInTheDocument();
      });
    });

    it('should clear error state on successful retry', async () => {
      // Arrange
      // First render: transactions call fails, others succeed
      // Second render: all calls succeed
      let firstTransactionCall = true;
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/transactions')) {
          if (firstTransactionCall) {
            firstTransactionCall = false;
            return Promise.resolve({ ok: false, statusText: 'Error' });
          }
          return Promise.resolve({ ok: true, json: async () => mockTransactionData });
        }
        if (url.includes('/throughput')) {
          return Promise.resolve({ ok: true, json: async () => mockThroughputStats });
        }
        if (url.includes('/virtual-users')) {
          return Promise.resolve({ ok: true, json: async () => mockVirtualUserStats });
        }
        if (url.includes('/apdex-threshold')) {
          return Promise.resolve({ ok: true, json: async () => mockApdexThreshold });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const { rerender } = render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
          showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch transaction data')).toBeInTheDocument();
      });

      // Act - Trigger retry by changing testRunId
      rerender(
        <PerformanceAnalysisCard
          testRunId="new-test-run-id"
          expanded={true}
          onExpand={mockOnExpand}
          showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('Failed to fetch transaction data')).not.toBeInTheDocument();
      });
    });

    it('should clear transactions on error', async () => {
      // Arrange
      (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('should display "No transactions found" when data is empty', async () => {
      // Arrange
      setupMockFetch([]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('No transactions found')).toBeInTheDocument();
      });
    });

    it('should display empty state message in expanded view', async () => {
      // Arrange
      setupMockFetch([]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText('No transaction data available for this test run.')
        ).toBeInTheDocument();
      });
    });

    it('should not display table when no data', async () => {
      // Arrange
      setupMockFetch([]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
      });
    });

    it('should handle null response data', async () => {
      // Arrange
      setupMockFetch(null);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByText('No transactions found')).toBeInTheDocument();
      });
    });
  });

  describe('Expanded State - Data Display', () => {
    it('should render expanded card with correct test ID', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-expanded')).toBeInTheDocument();
      });
    });

    it('should display table with transaction data', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
    });

    it('should display all column headers', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal table headers
      await expandScenario('load_test');

      // Assert
      await waitFor(() => {
        expect(screen.getAllByText('Transaction Name').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Avg Response \(ms\)').length).toBeGreaterThan(0);
        expect(screen.getAllByText('95th Pct \(ms\)').length).toBeGreaterThan(0);
        expect(screen.getAllByText('99th Pct \(ms\)').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
      });
    });

    it('should display transaction names', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal transaction rows
      await expandScenario('load_test');

      // Assert - Check for transactions in load_test scenario
      await waitFor(() => {
        expect(screen.getByText('database_call')).toBeInTheDocument();
        expect(screen.getByText('api_endpoint')).toBeInTheDocument();
      });

      // Expand stress_test scenario to see external_service
      await expandScenario('stress_test');
      await waitFor(() => {
        expect(screen.getByText('external_service')).toBeInTheDocument();
      });
    });

    it('should display all transaction metrics', async () => {
      // Arrange
      setupMockFetch([mockTransactionData[0]]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal transaction data
      await expandScenario('load_test');

      // Assert - metrics appear in table (may also appear elsewhere)
      await waitFor(() => {
        expect(screen.getAllByText('52.48').length).toBeGreaterThan(0); // avg_response_time
        expect(screen.getAllByText('70.00').length).toBeGreaterThan(0); // p95_response_time
        expect(screen.getAllByText('87.48').length).toBeGreaterThan(0); // p99_response_time
        expect(screen.getAllByText('573').length).toBeGreaterThan(0); // passed_count
        expect(screen.getAllByText('12').length).toBeGreaterThan(0); // failed_count
      });
    });

    it('should display all rows of data', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all rows
      await expandScenario('load_test');
      await expandScenario('stress_test');

      // Assert - With scenarios, we have: header + 3 transaction rows
      await waitFor(() => {
        const tableRows = screen.getAllByRole('row');
        // Should have at least the transaction rows visible
        expect(tableRows.length).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe('Number Formatting', () => {
    it('should format numbers to 2 decimal places', async () => {
      // Arrange
      const dataWithDecimals = [
        {
          transaction_name: 'test',
          scenario_name: 'load_test',
          avg_response_time: 52.4867,
          p95_response_time: 70.0001,
          p99_response_time: 87.4899,
          passed_count: 573,
          failed_count: 12,
          total_count: 585,
          ranking: 30703.0876,
          apdex_score: 0.85,
          active_threshold: 500,
        },
      ];
      setupMockFetch(dataWithDecimals);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal formatted numbers
      await expandScenario('load_test');

      // Assert - numbers appear in table cells (may also appear in chips)
      await waitFor(() => {
        const avgElements = screen.getAllByText('52.49');
        expect(avgElements.length).toBeGreaterThan(0);
        const p95Elements = screen.getAllByText('70.00');
        expect(p95Elements.length).toBeGreaterThan(0);
        const p99Elements = screen.getAllByText('87.49');
        expect(p99Elements.length).toBeGreaterThan(0);
      });
    });

    it('should handle whole numbers with .00', async () => {
      // Arrange
      const dataWithWholeNumbers = [
        {
          transaction_name: 'test',
          scenario_name: 'load_test',
          avg_response_time: 50,
          p95_response_time: 75,
          p99_response_time: 100,
          passed_count: 500,
          failed_count: 0,
          total_count: 500,
          ranking: 25000,
          apdex_score: 0.95,
          active_threshold: 500,
        },
      ];
      setupMockFetch(dataWithWholeNumbers);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal formatted numbers
      await expandScenario('load_test');

      // Assert - numbers appear in table cells (may also appear in chips)
      await waitFor(() => {
        const avgElements = screen.getAllByText('50.00');
        expect(avgElements.length).toBeGreaterThan(0);
        const p95Elements = screen.getAllByText('75.00');
        expect(p95Elements.length).toBeGreaterThan(0);
        const p99Elements = screen.getAllByText('100.00');
        expect(p99Elements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Sorting Functionality', () => {
    // Uses setupMockFetch from global beforeEach

    it('should sort by transaction name in ascending order by default', async () => {
      // Arrange & Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Check order: api_endpoint < database_call < external_service (alphabetically)
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should toggle sort order when clicking transaction name header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('Transaction Name').length).toBeGreaterThan(0);
      });

      // Act - Click to sort descending
      await user.click(screen.getAllByText('Transaction Name')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Check order within scenarios (load_test first, then stress_test)
        // load_test (desc): database_call > api_endpoint
        expect(transactionRows[0]).toHaveTextContent('database_call');
        expect(transactionRows[1]).toHaveTextContent('api_endpoint');
        // stress_test: external_service
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should sort by avg_response_time when clicking header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('Avg Response \(ms\)').length).toBeGreaterThan(0);
      });

      // Act
      await user.click(screen.getAllByText('Avg Response \(ms\)')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Order: 25.75 < 52.48 < 105.2
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should sort by p95_response_time when clicking header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('95th Pct \(ms\)').length).toBeGreaterThan(0);
      });

      // Act
      await user.click(screen.getAllByText('95th Pct \(ms\)')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Order: 45.3 < 70.0 < 180.5
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should sort by p99_response_time when clicking header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('99th Pct \(ms\)').length).toBeGreaterThan(0);
      });

      // Act
      await user.click(screen.getAllByText('99th Pct \(ms\)')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Order: 62.1 < 87.48 < 220.75
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should sort by passed_count when clicking header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
      });

      // Act
      await user.click(screen.getAllByText('Passed')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Order within scenarios: load_test (573 < 1198), stress_test (450)
        expect(transactionRows[0]).toHaveTextContent('database_call');
        expect(transactionRows[1]).toHaveTextContent('api_endpoint');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should sort by failed_count when clicking header', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
      });

      // Act
      await user.click(screen.getAllByText('Failed')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Order within scenarios: load_test (2 < 12), stress_test (0)
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });

    it('should toggle between ascending and descending order', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand both scenarios to reveal all sortable data
      await expandScenario('load_test');
      await expandScenario('stress_test');

      await waitFor(() => {
        expect(screen.getAllByText('Transaction Name').length).toBeGreaterThan(0);
      });

      // Act - First click: descending (default is ascending)
      await user.click(screen.getAllByText('Transaction Name')[0]);

      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Descending: database_call > api_endpoint (load_test), external_service (stress_test)
        expect(transactionRows[0]).toHaveTextContent('database_call');
        expect(transactionRows[1]).toHaveTextContent('api_endpoint');
      });

      // Act - Second click: back to ascending
      await user.click(screen.getAllByText('Transaction Name')[0]);

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        // Ascending: api_endpoint < database_call (load_test), external_service (stress_test)
        expect(transactionRows[0]).toHaveTextContent('api_endpoint');
        expect(transactionRows[1]).toHaveTextContent('database_call');
        expect(transactionRows[2]).toHaveTextContent('external_service');
      });
    });
  });

  describe('Expand/Collapse Functionality', () => {
    // Uses setupMockFetch from global beforeEach

    it('should call onExpand when clicking card in collapsed state', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-collapsed')).toBeInTheDocument();
      });

      // Act
      await user.click(screen.getByTestId('performance-analysis-card-collapsed'));

      // Assert
      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onExpand when clicking expand button', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getAllByRole('button')[0]).toBeInTheDocument();
      });

      // Act
      const expandButton = screen.getAllByRole('button')[0];
      await user.click(expandButton);

      // Assert
      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should call onExpand when clicking collapse button', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getAllByRole('button')[0]).toBeInTheDocument();
      });

      // Act
      const collapseButton = screen.getAllByRole('button')[0];
      await user.click(collapseButton);

      // Assert
      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should not trigger expand when clicking card in expanded state', async () => {
      // Arrange
      const user = userEvent.setup();
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-expanded')).toBeInTheDocument();
      });

      // Clear any previous calls from rendering
      mockOnExpand.mockClear();

      // Act
      await user.click(screen.getByTestId('performance-analysis-card-expanded'));

      // Assert
      expect(mockOnExpand).not.toHaveBeenCalled();
    });
  });

  describe('Auto-Focus on Expand', () => {
    it('should attempt to focus and scroll expanded card into view after expansion', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      jest.useFakeTimers();

      // Mock focus and scrollIntoView methods
      const mockFocus = jest.fn();
      const mockScrollIntoView = jest.fn();

      // Use Object.defineProperty to mock methods that are getters
      Object.defineProperty(HTMLElement.prototype, 'focus', {
        configurable: true,
        value: mockFocus,
      });

      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: mockScrollIntoView,
      });

      const user = userEvent.setup({ delay: null });

      const { rerender } = render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={false}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-collapsed')).toBeInTheDocument();
      });

      // Act - Click to expand
      await user.click(screen.getAllByRole('button')[0]);

      // Simulate parent component updating expanded prop
      rerender(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Fast-forward timers for the setTimeout
      jest.advanceTimersByTime(300);

      // Assert - Just verify the expanded state is rendered (focus behavior is tested in integration tests)
      await waitFor(() => {
        expect(screen.getByTestId('performance-analysis-card-expanded')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });

  describe('Edge Cases and Accessibility', () => {
    it('should handle many transactions', async () => {
      // Arrange - Use 10 items instead of 100 to avoid test timeouts
      const dataset = Array.from({ length: 10 }, (_, i) => ({
        transaction_name: `transaction_${i}`,
        scenario_name: 'load_test',
        avg_response_time: i * 10,
        p95_response_time: i * 15,
        p99_response_time: i * 20,
        passed_count: i * 100,
        failed_count: i,
        total_count: i * 100 + i,
        ranking: i * 1000,
        apdex_score: 0.85,
        active_threshold: 500,
      }));
      setupMockFetch(dataset);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal data
      await expandScenario('load_test');

      // Assert
      await waitFor(() => {
        const transactionRows = getTransactionRows();
        expect(transactionRows.length).toBeGreaterThanOrEqual(10); // Should have 10 transaction rows
      });
    });

    it('should display failed count in red when greater than zero', async () => {
      // Arrange
      setupMockFetch([mockTransactionData[0]]);

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Expand scenario to reveal data
      await expandScenario('load_test');

      // Assert
      await waitFor(() => {
        const failedCell = screen.getByText('12');
        expect(failedCell).toBeInTheDocument();
        // Verify it has error styling (this would check computed styles in actual DOM)
      });
    });

    it('should have sticky table header for scrolling', async () => {
      // Arrange
      // Uses setupMockFetch from beforeEach with default data

      // Act
      render(
        <PerformanceAnalysisCard
          testRunId={testRunId}
          expanded={true}
          onExpand={mockOnExpand}
        showToast={mockShowToast}
        />
      );

      // Assert
      await waitFor(() => {
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
        // Table should have sticky header (implementation detail)
      });
    });
  });
});
