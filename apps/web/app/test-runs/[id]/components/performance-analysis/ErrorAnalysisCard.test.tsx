import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorAnalysisCard from './ErrorAnalysisCard';

const mockUseErrorAnalysisData = jest.fn();

jest.mock('./error-analysis/hooks', () => ({
  useErrorAnalysisData: (...args: unknown[]) => mockUseErrorAnalysisData(...args),
}));

// The chart is Plotly-backed; stub the dynamic import so jsdom does not try to
// load the real bundle.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Component = () => <div data-testid="plotly-chart" />;
    Component.displayName = 'Plot';
    return Component;
  },
}));

const hookResult = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  error: null,
  summary: null,
  errorsByCode: [],
  errorsByTransaction: [],
  errorsOverTime: [],
  errorsOverTimeByCode: [],
  selectedError: null,
  detailsOpen: false,
  handleViewDetails: jest.fn(),
  handleCloseDetails: jest.fn(),
  ...overrides,
});

describe('ErrorAnalysisCard', () => {
  beforeEach(() => {
    mockUseErrorAnalysisData.mockReset();
  });

  it('shows the clean-run state when the run recorded no errors', () => {
    mockUseErrorAnalysisData.mockReturnValue(
      hookResult({
        summary: { totalErrors: 0, uniqueResponseCodes: 0, transactionsWithErrors: 0, uniqueErrorUrls: 0 },
      }),
    );

    render(<ErrorAnalysisCard testRunId="run-1" />);

    expect(screen.getByText('No errors detected')).toBeInTheDocument();
  });

  it('surfaces the fetch error instead of an empty tab', () => {
    mockUseErrorAnalysisData.mockReturnValue(hookResult({ error: 'Failed to fetch errors by code' }));

    render(<ErrorAnalysisCard testRunId="run-1" />);

    expect(screen.getByText('Failed to fetch errors by code')).toBeInTheDocument();
  });

  it('renders the summary and tables once errors are present', () => {
    mockUseErrorAnalysisData.mockReturnValue(
      hookResult({
        summary: {
          totalErrors: 12,
          uniqueResponseCodes: 1,
          transactionsWithErrors: 3,
          uniqueErrorUrls: 3,
          errorRate: 1.46,
          totalRequests: 821,
        },
        errorsByCode: [
          { responseCode: '500', errorCount: 12, avgResponseTime: 100, minResponseTime: 90, maxResponseTime: 110 },
        ],
      }),
    );

    render(<ErrorAnalysisCard testRunId="run-1" />);

    expect(screen.getByText('Error Summary')).toBeInTheDocument();
    expect(screen.getByText('Errors Over Time by Response Code')).toBeInTheDocument();
    expect(screen.getByText('Errors by Code')).toBeInTheDocument();
    expect(screen.getByText('Error Details')).toBeInTheDocument();
  });
});
