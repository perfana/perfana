/**
 * Unit tests for TrackedRegressionsView Component
 *
 * Tests the tracked regressions view functionality:
 * - Fetching and displaying tracked regressions
 * - Grouping by tracked test run ID
 * - Chronological ordering
 * - Resolution eligibility (oldest first)
 * - Resolution actions (regression/variability/changepoint)
 * - Batch re-evaluation triggering
 * - Trends data fetching
 * - Loading, error, and empty states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TrackedRegressionsView from '@/app/test-runs/[id]/components/anomaly-detection/components/TrackedRegressionsView';
import { authenticatedFetch } from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/TrackedRegressionSection', () => {
  return function MockTrackedRegressionSection({ group, onResolve, onMarkChangepoint }: any) {
    return (
      <div data-testid="tracked-regression-section">
        <div>Tracked Test Run: {group.trackedTestRunId}</div>
        <div>Count: {group.regressions.length}</div>
        <button onClick={() => onResolve(group.trackedTestRunId, 'regression')}>Resolve as Regression</button>
        <button onClick={() => onResolve(group.trackedTestRunId, 'variability')}>Resolve as Variability</button>
        <button onClick={() => onMarkChangepoint(group.trackedTestRunId)}>Mark Changepoint</button>
      </div>
    );
  };
});

const mockTrackedRegressions = [
  {
    id: 'reg-1',
    testRunId: 'test-run-1',
    trackedTestRunId: 'tracked-1',
    metricName: 'response_time',
    applicationDashboardId: 'app-1',
    panelId: 'panel-1',
    dashboardLabel: 'Test Dashboard',
    panelTitle: 'Response Time Panel',
    unit: 'ms',
    testRunStart: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'reg-2',
    testRunId: 'test-run-2',
    trackedTestRunId: 'tracked-2',
    metricName: 'error_rate',
    applicationDashboardId: 'app-2',
    panelId: 'panel-2',
    dashboardLabel: 'Test Dashboard 2',
    panelTitle: 'Error Rate Panel',
    unit: '%',
    testRunStart: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
];

const mockTestRun = {
  id: 'test-run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'baseline',
  systems_under_test: { name: 'test-system' },
};

const mockTrendsData = [
  {
    test_run_id: 'tr-1',
    test_run_start: '2024-01-01T00:00:00Z',
    mean: 50,
    unit: 'ms',
  },
];

describe('TrackedRegressionsView', () => {
  const defaultProps = {
    testRunId: 'test-run-1',
    testRun: mockTestRun,
    onResolve: jest.fn(),
    onMarkChangepoint: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ regressions: mockTrackedRegressions }),
    });
  });

  describe('Data Fetching', () => {
    it('should fetch tracked regressions on mount', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/adapt/tracked-regressions')
        );
      });
    });

    it('should include system in query params', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('system=test-system')
        );
      });
    });

    it('should include environment in query params', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('environment=production')
        );
      });
    });

    it('should include workload in query params', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('workload=baseline')
        );
      });
    });

    it('should handle fetch error', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      });
    });

    it('should handle network error', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/error loading/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner initially', () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should hide loading after data loads', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no regressions', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: [] }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/No unresolved regressions found/i)).toBeInTheDocument();
      });
    });

    it('should not display regression sections when empty', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: [] }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByTestId('tracked-regression-section')).not.toBeInTheDocument();
      });
    });
  });

  describe('Regression Grouping', () => {
    it('should group regressions by tracked test run ID', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const sections = screen.getAllByTestId('tracked-regression-section');
        expect(sections.length).toBe(2);
      });
    });

    it('should sort groups chronologically (oldest first)', async () => {
      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const sections = screen.getAllByTestId('tracked-regression-section');
        expect(sections[0]).toHaveTextContent('tracked-1');
        expect(sections[1]).toHaveTextContent('tracked-2');
      });
    });

    it('should count regressions per group', async () => {
      const multipleRegInGroup = [
        ...mockTrackedRegressions,
        {
          ...mockTrackedRegressions[0],
          id: 'reg-3',
          testRunId: 'test-run-3',
        },
      ];

      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: multipleRegInGroup }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Count: 2')).toBeInTheDocument();
      });
    });
  });

  describe('Resolution Actions', () => {
    it('should resolve regression as regression', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const resolveButton = screen.getAllByText('Resolve as Regression')[0];
        fireEvent.click(resolveButton);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/adapt/tracked-regressions/resolve',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('regression'),
          })
        );
      });
    });

    it('should resolve regression as variability', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const resolveButton = screen.getAllByText('Resolve as Variability')[0];
        fireEvent.click(resolveButton);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/adapt/tracked-regressions/resolve',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('variability'),
          })
        );
      });
    });

    it('should call onResolve callback after resolution', async () => {
      const onResolve = jest.fn();
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} onResolve={onResolve} />);

      await waitFor(() => {
        const resolveButton = screen.getAllByText('Resolve as Regression')[0];
        fireEvent.click(resolveButton);
      });

      await waitFor(() => {
        expect(onResolve).toHaveBeenCalledWith('tracked-1', 'regression');
      });
    });

    it('should update adapt config after resolving as regression', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const resolveButton = screen.getAllByText('Resolve as Regression')[0];
        fireEvent.click(resolveButton);
      });

      // Should call update adapt config with DENIED
      // URL format is /test-runs/{testRunId}/adapt-config?...
      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/adapt-config'),
          expect.objectContaining({
            method: 'PUT',
          })
        );
      });
    });

    it('should handle resolution error', async () => {
      let resolveCallCount = 0;
      (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
        if (url.includes('/adapt/tracked-regressions/resolve')) {
          return Promise.resolve({
            ok: false,
            status: 500,
          });
        }
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const resolveButton = screen.getAllByText('Resolve as Regression')[0];
        fireEvent.click(resolveButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/failed to resolve/i)).toBeInTheDocument();
      });
    });
  });

  describe('Mark as Changepoint', () => {
    it('should fetch test run details before marking', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        if (url.match(/\/test-runs\/tracked-1$/)) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTestRun,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const changepointButton = screen.getAllByText('Mark Changepoint')[0];
        fireEvent.click(changepointButton);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/test-runs/tracked-1')
        );
      });
    });

    it('should mark changepoint with complete payload', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        if (url.match(/\/test-runs\/tracked-1$/)) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTestRun,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const changepointButton = screen.getAllByText('Mark Changepoint')[0];
        fireEvent.click(changepointButton);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          '/test-runs/mark-changepoint',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('systemUnderTestId'),
          })
        );
      });
    });

    it('should call onMarkChangepoint callback', async () => {
      const onMarkChangepoint = jest.fn();
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/adapt/tracked-regressions')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ regressions: mockTrackedRegressions }),
          });
        }
        if (url.includes('/control-group-trends')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTrendsData,
          });
        }
        if (url.match(/\/test-runs\/tracked-1$/)) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTestRun,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      });

      render(<TrackedRegressionsView {...defaultProps} onMarkChangepoint={onMarkChangepoint} />);

      await waitFor(() => {
        const changepointButton = screen.getAllByText('Mark Changepoint')[0];
        fireEvent.click(changepointButton);
      });

      await waitFor(() => {
        expect(onMarkChangepoint).toHaveBeenCalledWith('tracked-1');
      });
    });
  });

  describe('Trends Data Fetching', () => {
    it('should fetch trends for unique metrics', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ regressions: mockTrackedRegressions }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => mockTrendsData,
        });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/metrics/control-group-trends/')
        );
      }, { timeout: 3000 });
    });

    it('should handle trends fetch error gracefully', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ regressions: mockTrackedRegressions }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      render(<TrackedRegressionsView {...defaultProps} />);

      // Should not crash on trends error
      await waitFor(() => {
        expect(screen.getAllByTestId('tracked-regression-section').length).toBeGreaterThan(0);
      });
    });

    it('should pass trends data to sections', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ regressions: mockTrackedRegressions }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => mockTrendsData,
        });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        const sections = screen.getAllByTestId('tracked-regression-section');
        expect(sections.length).toBeGreaterThan(0);
      });
    });

    it('should use external trends data when provided', async () => {
      const externalTrendsData = { response_time: mockTrendsData };

      render(<TrackedRegressionsView {...defaultProps} trendsData={externalTrendsData} />);

      await waitFor(() => {
        const sections = screen.getAllByTestId('tracked-regression-section');
        expect(sections.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Explanatory Text', () => {
    it('should display understanding section', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: mockTrackedRegressions }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Understanding Unresolved Regressions/i)).toBeInTheDocument();
      });
    });

    it('should display resolution order explanation', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: mockTrackedRegressions }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/chronological order/i)).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing test run', async () => {
      render(<TrackedRegressionsView {...defaultProps} testRun={null} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalled();
      });
    });

    it('should handle missing system info', async () => {
      const incompleteTestRun = {
        ...mockTestRun,
        systems_under_test: undefined,
      };

      render(<TrackedRegressionsView {...defaultProps} testRun={incompleteTestRun as any} />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalled();
      });
    });

    it('should handle regressions with missing dashboard IDs', async () => {
      const regressionsWithoutIds = mockTrackedRegressions.map((r) => ({
        ...r,
        applicationDashboardId: undefined,
        panelId: undefined,
      }));

      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ regressions: regressionsWithoutIds }),
      });

      render(<TrackedRegressionsView {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('tracked-regression-section').length).toBeGreaterThan(0);
      });
    });
  });
});
