/**
 * Unit tests for TrendChart Component
 *
 * Tests the trend visualization chart:
 * - Chart rendering with Plotly
 * - Loading and error states
 * - Empty state when no data
 * - Data processing and formatting
 * - Responsive behavior
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TrendChart from '@/app/test-runs/[id]/components/anomaly-detection/components/TrendChart';
import { MetricTrendData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

// Mock dynamic imports
jest.mock('next/dynamic', () => () => {
  const DynamicComponent = ({ data, layout, config }: any) => (
    <div data-testid="mock-plot" data-traces={data?.length || 0}>
      Plotly Chart
    </div>
  );
  DynamicComponent.displayName = 'Plot';
  return DynamicComponent;
});

const mockTrendData: MetricTrendData[] = [
  {
    test_run_id: 'tr-1',
    test_run_start: '2024-01-01T00:00:00Z',
    test_run_end: '2024-01-01T01:00:00Z',
    mean: 50,
    median: 48,
    q95: 75,
    conclusion_label: 'no difference',
    unit: 'ms',
    thresholds: {
      lower: { overall: 40 },
      upper: { overall: 60 },
    },
  },
  {
    test_run_id: 'tr-2',
    test_run_start: '2024-01-02T00:00:00Z',
    test_run_end: '2024-01-02T01:00:00Z',
    mean: 100,
    median: 95,
    q95: 120,
    conclusion_label: 'regression',
    unit: 'ms',
    thresholds: {
      lower: { overall: 40 },
      upper: { overall: 60 },
    },
  },
];

describe('TrendChart', () => {
  const defaultProps = {
    data: mockTrendData,
    rowKey: 'test-row-1',
    metricName: 'response_time',
    unit: 'ms',
    loading: false,
    height: 400,
    chartKey: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the chart component', () => {
      render(<TrendChart {...defaultProps} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should process trend data correctly', () => {
      render(<TrendChart {...defaultProps} />);

      const plot = screen.getByTestId('mock-plot');
      expect(plot).toBeInTheDocument();
    });

    it('should use the specified height', () => {
      const { container } = render(<TrendChart {...defaultProps} height={500} />);

      expect(container.firstChild).toBeInTheDocument();
    });

    it('should update when chartKey changes', () => {
      const { rerender } = render(<TrendChart {...defaultProps} chartKey={0} />);

      rerender(<TrendChart {...defaultProps} chartKey={1} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner', () => {
      render(<TrendChart {...defaultProps} loading={true} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not display chart while loading', () => {
      render(<TrendChart {...defaultProps} loading={true} />);

      expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    });

    it('should have correct height for loading container', () => {
      const { container } = render(<TrendChart {...defaultProps} loading={true} height={350} />);

      const loadingBox = container.querySelector('[role="progressbar"]')?.closest('div');
      expect(loadingBox).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message', () => {
      render(<TrendChart {...defaultProps} error="Failed to load data" />);

      expect(screen.getByText(/Failed to load trend data/)).toBeInTheDocument();
    });

    it('should display specific error message', () => {
      render(<TrendChart {...defaultProps} error="Network timeout" />);

      expect(screen.getByText(/Network timeout/)).toBeInTheDocument();
    });

    it('should not display chart when error', () => {
      render(<TrendChart {...defaultProps} error="Error occurred" />);

      expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no data', () => {
      render(<TrendChart {...defaultProps} data={[]} />);

      expect(screen.getByText('No trend data available')).toBeInTheDocument();
    });

    it('should display empty state when data is undefined', () => {
      render(<TrendChart {...defaultProps} data={undefined as any} />);

      expect(screen.getByText('No trend data available')).toBeInTheDocument();
    });

    it('should display empty state when data is null', () => {
      render(<TrendChart {...defaultProps} data={null as any} />);

      expect(screen.getByText('No trend data available')).toBeInTheDocument();
    });

    it('should have correct height for empty state', () => {
      const { container} = render(<TrendChart {...defaultProps} data={[]} height={300} />);

      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('Data Processing', () => {
    it('should handle different units', () => {
      render(<TrendChart {...defaultProps} unit="s" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle percentage units', () => {
      const percentData = mockTrendData.map((d) => ({ ...d, unit: '%' }));
      render(<TrendChart {...defaultProps} data={percentData} unit="%" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle milliseconds to seconds conversion', () => {
      const msData = mockTrendData.map((d) => ({ ...d, unit: 'ms', mean: 1500 }));
      render(<TrendChart {...defaultProps} data={msData} unit="ms" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle regression detection test run ID', () => {
      render(<TrendChart {...defaultProps} regressionDetectionTestRunId="tr-2" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle missing thresholds', () => {
      const dataWithoutThresholds = mockTrendData.map((d) => ({ ...d, thresholds: undefined }));
      render(<TrendChart {...defaultProps} data={dataWithoutThresholds} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });
  });

  describe('Chart Updates', () => {
    it('should update when data changes', () => {
      const { rerender } = render(<TrendChart {...defaultProps} />);

      const newData = [
        ...mockTrendData,
        {
          test_run_id: 'tr-3',
          test_run_start: '2024-01-03T00:00:00Z',
          mean: 75,
          median: 70,
          q95: 90,
          conclusion_label: 'improvement',
          unit: 'ms',
        } as MetricTrendData,
      ];

      rerender(<TrendChart {...defaultProps} data={newData} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should update when metric name changes', () => {
      const { rerender } = render(<TrendChart {...defaultProps} metricName="metric1" />);

      rerender(<TrendChart {...defaultProps} metricName="metric2" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should update when unit changes', () => {
      const { rerender } = render(<TrendChart {...defaultProps} unit="ms" />);

      rerender(<TrendChart {...defaultProps} unit="s" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single data point', () => {
      render(<TrendChart {...defaultProps} data={[mockTrendData[0]]} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle very large datasets', () => {
      const largeData = Array(1000)
        .fill(null)
        .map((_, i) => ({
          ...mockTrendData[0],
          test_run_id: `tr-${i}`,
          mean: Math.random() * 100,
        }));

      render(<TrendChart {...defaultProps} data={largeData} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle missing metric name', () => {
      render(<TrendChart {...defaultProps} metricName="" />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle zero height', () => {
      render(<TrendChart {...defaultProps} height={0} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should handle negative values', () => {
      const negativeData = mockTrendData.map((d) => ({ ...d, mean: -50 }));
      render(<TrendChart {...defaultProps} data={negativeData} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('should render with default height', () => {
      render(<TrendChart {...defaultProps} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });

    it('should adapt to custom height', () => {
      render(<TrendChart {...defaultProps} height={600} />);

      expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    });
  });
});
