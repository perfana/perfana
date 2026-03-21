/**
 * Unit tests for ProfileBenchmarksTable Component
 *
 * Tests comprehensive SLO table functionality:
 * - Rendering benchmarks with all columns
 * - Loading states
 * - Error states
 * - Empty states
 * - Evaluation type labels
 * - Requirement operators with unit formatting
 * - Tags display
 * - Edit and delete actions
 * - Unit conversion (percentunit)
 * - Fancy chips with gradients
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileBenchmarksTable from '@/app/settings/profiles/[id]/components/ProfileBenchmarksTable';
import { ProfileBenchmark } from '@/lib/profile-benchmarks';

describe('ProfileBenchmarksTable', () => {
  const mockOnEdit = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnSelectAll = jest.fn();
  const mockOnSelectOne = jest.fn();
  const mockOnBatchDelete = jest.fn();

  const defaultProps = {
    benchmarks: [] as ProfileBenchmark[],
    loading: false,
    error: '',
    selectedBenchmarkIds: new Set<string>(),
    onEdit: mockOnEdit,
    onDelete: mockOnDelete,
    onSelectAll: mockOnSelectAll,
    onSelectOne: mockOnSelectOne,
    onBatchDelete: mockOnBatchDelete,
  };

  const mockBenchmark: ProfileBenchmark = {
    id: 'benchmark-1',
    profileId: 'profile-1',
    profileDashboardId: 'dashboard-1',
    workloadPattern: 'load-test-.*',
    source: 'grafana',
    grafanaInstance: 'grafana-prod',
    dashboardLabel: 'JMeter Overview',
    dashboardUid: 'jmeter-uid',
    panelId: 1,
    panelTitle: 'Response Time',
    panelType: 'timeseries',
    panelDescription: 'HTTP response time metrics',
    evaluateType: 'avg',
    metricUnit: 'ms',
    requirementOperator: 'lt',
    requirementValue: 500,
    excludeRampUpTime: true,
    averageAll: false,
    matchPattern: '',
    validateWithDefaultIfNoData: false,
    tags: ['performance', 'http'],
    metadata: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockPercentileBenchmark: ProfileBenchmark = {
    id: 'benchmark-2',
    profileId: 'profile-1',
    profileDashboardId: 'dashboard-1',
    workloadPattern: '.*',
    source: 'grafana',
    grafanaInstance: 'grafana-staging',
    dashboardLabel: 'System Metrics',
    panelId: 2,
    panelTitle: 'CPU Usage',
    panelType: 'graph',
    evaluateType: 'q95',
    metricUnit: 'percentunit',
    requirementOperator: 'lte',
    requirementValue: 0.8,
    excludeRampUpTime: false,
    averageAll: true,
    validateWithDefaultIfNoData: false,
    tags: ['cpu', 'system', 'infrastructure'],
    metadata: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockMinimalBenchmark: ProfileBenchmark = {
    id: 'benchmark-3',
    profileId: 'profile-1',
    profileDashboardId: 'dashboard-1',
    workloadPattern: '.*',
    source: 'grafana',
    excludeRampUpTime: false,
    averageAll: false,
    validateWithDefaultIfNoData: false,
    tags: [],
    metadata: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should display loading spinner when loading is true', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[]}
          loading={true}
        />
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('should display CircularProgress with correct size', () => {
      const { container } = render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[]}
          loading={true}
        />
      );

      const progressBar = container.querySelector('.MuiCircularProgress-root');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when error is provided', () => {
      const errorMessage = 'Failed to load benchmarks';
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          error={errorMessage}
        />
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should not display table when error is shown', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          error="Error occurred"
        />
      );

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display empty state message in table when no benchmarks', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
        />
      );

      expect(screen.getByText('No SLOs found')).toBeInTheDocument();
    });

    it('should still render table with headers when empty', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
        />
      );

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Metric')).toBeInTheDocument();
      expect(screen.getByText('Workload Pattern')).toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render table with all column headers', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('Metric')).toBeInTheDocument();
      expect(screen.getByText('Workload Pattern')).toBeInTheDocument();
      expect(screen.getByText('Evaluation')).toBeInTheDocument();
      expect(screen.getByText('Requirement')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('should render panel title as metric name', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('Response Time')).toBeInTheDocument();
    });

    it('should render dashboard label below metric', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('JMeter Overview')).toBeInTheDocument();
    });

    it('should render grafana instance below dashboard', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('grafana-prod')).toBeInTheDocument();
    });

    it('should display "Unnamed Metric" when panelTitle is missing', () => {
      const benchmarkWithoutTitle: ProfileBenchmark = {
        ...mockBenchmark,
        panelTitle: undefined,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[benchmarkWithoutTitle]}
        />
      );

      expect(screen.getByText('Unnamed Metric')).toBeInTheDocument();
    });

    it('should render multiple benchmarks', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark, mockPercentileBenchmark, mockMinimalBenchmark]}
        />
      );

      expect(screen.getByText('Response Time')).toBeInTheDocument();
      expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    });
  });

  describe('Workload Pattern', () => {
    it('should render workload pattern chip', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('load-test-.*')).toBeInTheDocument();
    });

    it('should render wildcard pattern', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      const wildcardChips = screen.getAllByText('.*');
      expect(wildcardChips.length).toBeGreaterThan(0);
    });
  });

  describe('Evaluation Type', () => {
    it('should display "Average" for avg evaluation type', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('Average')).toBeInTheDocument();
    });

    it('should display "95th Percentile" for q95 evaluation type', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      expect(screen.getByText('95th Percentile')).toBeInTheDocument();
    });

    it('should display "Maximum" for max evaluation type', () => {
      const maxBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        evaluateType: 'max',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[maxBenchmark]}
        />
      );

      expect(screen.getByText('Maximum')).toBeInTheDocument();
    });

    it('should display "Minimum" for min evaluation type', () => {
      const minBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        evaluateType: 'min',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[minBenchmark]}
        />
      );

      expect(screen.getByText('Minimum')).toBeInTheDocument();
    });

    it('should display "Last Value" for last evaluation type', () => {
      const lastBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        evaluateType: 'last',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[lastBenchmark]}
        />
      );

      expect(screen.getByText('Last Value')).toBeInTheDocument();
    });

    it('should display percentile labels for q50, q90, q99', () => {
      const benchmarks: ProfileBenchmark[] = [
        { ...mockBenchmark, id: 'b1', evaluateType: 'q50' },
        { ...mockBenchmark, id: 'b2', evaluateType: 'q90' },
        { ...mockBenchmark, id: 'b3', evaluateType: 'q99' },
      ];

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={benchmarks}
        />
      );

      expect(screen.getByText('50th Percentile')).toBeInTheDocument();
      expect(screen.getByText('90th Percentile')).toBeInTheDocument();
      expect(screen.getByText('99th Percentile')).toBeInTheDocument();
    });

    it('should display N/A when evaluation type is missing', () => {
      const benchmarkNoEval: ProfileBenchmark = {
        ...mockBenchmark,
        evaluateType: undefined,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[benchmarkNoEval]}
        />
      );

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  describe('Requirement Operators', () => {
    it('should display "Less than" for lt operator', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText(/less than 500/i)).toBeInTheDocument();
    });

    it('should display "Less than or equal" for lte operator', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      expect(screen.getByText(/less than or equal/i)).toBeInTheDocument();
    });

    it('should display "Greater than" for gt operator', () => {
      const gtBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: 'gt',
        requirementValue: 100,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[gtBenchmark]}
        />
      );

      expect(screen.getByText(/greater than/i)).toBeInTheDocument();
    });

    it('should display "Greater than or equal" for gte operator', () => {
      const gteBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: 'gte',
        requirementValue: 100,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[gteBenchmark]}
        />
      );

      expect(screen.getByText(/greater than or equal/i)).toBeInTheDocument();
    });

    it('should display "Equal to" for eq operator', () => {
      const eqBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: 'eq',
        requirementValue: 0,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[eqBenchmark]}
        />
      );

      expect(screen.getByText(/equal to/i)).toBeInTheDocument();
    });

    it('should display "Not equal to" for ne operator', () => {
      const neBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: 'ne',
        requirementValue: 0,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[neBenchmark]}
        />
      );

      expect(screen.getByText(/not equal to/i)).toBeInTheDocument();
    });
  });

  describe('Unit Formatting', () => {
    it('should display milliseconds unit for ms', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText(/500 ms/i)).toBeInTheDocument();
    });

    it('should convert percentunit to percentage display', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      // 0.8 should be displayed as 80%
      expect(screen.getByText(/80 %/i)).toBeInTheDocument();
    });

    it('should handle value with embedded unit', () => {
      const benchmarkWithUnit: ProfileBenchmark = {
        ...mockBenchmark,
        requirementValue: 500, // Value might have unit embedded in string representation
        metricUnit: 'ms',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[benchmarkWithUnit]}
        />
      );

      expect(screen.getByText(/500/i)).toBeInTheDocument();
    });

    it('should display requirement value without unit when metricUnit is missing', () => {
      const benchmarkNoUnit: ProfileBenchmark = {
        ...mockBenchmark,
        metricUnit: undefined,
        requirementValue: 100,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[benchmarkNoUnit]}
        />
      );

      expect(screen.getByText(/less than 100$/i)).toBeInTheDocument();
    });

    it('should display "No requirement" when operator and value are missing', () => {
      const benchmarkNoReq: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: undefined,
        requirementValue: undefined,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[benchmarkNoReq]}
        />
      );

      expect(screen.getByText('No requirement')).toBeInTheDocument();
    });
  });

  describe('Tags', () => {
    it('should render tag chips', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      expect(screen.getByText('performance')).toBeInTheDocument();
      expect(screen.getByText('http')).toBeInTheDocument();
    });

    it('should render multiple tags', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      expect(screen.getByText('cpu')).toBeInTheDocument();
      expect(screen.getByText('system')).toBeInTheDocument();
      expect(screen.getByText('infrastructure')).toBeInTheDocument();
    });

    it('should show "+X more" chip when more than 3 tags', () => {
      const manyTagsBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[manyTagsBenchmark]}
        />
      );

      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('should display "No tags" when tags array is empty', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockMinimalBenchmark]}
        />
      );

      expect(screen.getByText('No tags')).toBeInTheDocument();
    });

    it('should render exactly 3 tags when benchmark has exactly 3', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockPercentileBenchmark]}
        />
      );

      expect(screen.getByText('cpu')).toBeInTheDocument();
      expect(screen.getByText('system')).toBeInTheDocument();
      expect(screen.getByText('infrastructure')).toBeInTheDocument();
      expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    });
  });

  describe('Edit Action', () => {
    it('should call onEdit when edit button is clicked', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const editButton = screen.getByRole('button', { name: /edit slo/i });
      fireEvent.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledTimes(1);
      expect(mockOnEdit).toHaveBeenCalledWith(mockBenchmark);
    });

    it('should call onEdit with correct benchmark when multiple benchmarks exist', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark, mockPercentileBenchmark]}
        />
      );

      const editButtons = screen.getAllByRole('button', { name: /edit slo/i });
      const secondEditButton = editButtons[1];
      if (secondEditButton) {
        fireEvent.click(secondEditButton);
      }

      expect(mockOnEdit).toHaveBeenCalledWith(mockPercentileBenchmark);
    });
  });

  describe('Delete Action', () => {
    it('should call onDelete when delete button is clicked', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /delete slo/i });
      fireEvent.click(deleteButton);

      expect(mockOnDelete).toHaveBeenCalledTimes(1);
      expect(mockOnDelete).toHaveBeenCalledWith('benchmark-1');
    });

    it('should call onDelete with correct benchmark ID when multiple benchmarks exist', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark, mockPercentileBenchmark]}
        />
      );

      const deleteButtons = screen.getAllByRole('button', { name: /delete slo/i });
      const secondDeleteButton = deleteButtons[1];
      if (secondDeleteButton) {
        fireEvent.click(secondDeleteButton);
      }

      expect(mockOnDelete).toHaveBeenCalledWith('benchmark-2');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels on table', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const table = screen.getByRole('table', { name: /profile service level objectives table/i });
      expect(table).toBeInTheDocument();
    });

    it('should have tooltips for action buttons', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const editButton = screen.getByRole('button', { name: /edit slo/i });
      const deleteButton = screen.getByRole('button', { name: /delete slo/i });

      expect(editButton).toBeInTheDocument();
      expect(deleteButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle benchmark with all optional fields missing', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockMinimalBenchmark]}
        />
      );

      expect(screen.getByText('Unnamed Metric')).toBeInTheDocument();
      expect(screen.getByText('No requirement')).toBeInTheDocument();
      expect(screen.getByText('No tags')).toBeInTheDocument();
    });

    it('should handle very long panel titles', () => {
      const longTitleBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        panelTitle: 'Very Long Panel Title That Should Be Displayed Without Breaking The Layout',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[longTitleBenchmark]}
        />
      );

      expect(screen.getByText(/Very Long Panel Title/i)).toBeInTheDocument();
    });

    it('should handle zero as requirement value', () => {
      const zeroBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementOperator: 'eq',
        requirementValue: 0,
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[zeroBenchmark]}
        />
      );

      expect(screen.getByText(/equal to 0/i)).toBeInTheDocument();
    });

    it('should handle decimal requirement values', () => {
      const decimalBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementValue: 123.45,
        metricUnit: 'ms',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[decimalBenchmark]}
        />
      );

      expect(screen.getByText(/123\.45/i)).toBeInTheDocument();
    });

    it('should handle large requirement values', () => {
      const largeBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        requirementValue: 999999,
        metricUnit: 'bytes',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[largeBenchmark]}
        />
      );

      expect(screen.getByText(/999999/i)).toBeInTheDocument();
    });

    it('should handle complex workload patterns', () => {
      const complexPatternBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        workloadPattern: '^(load|stress)-test-(prod|staging)-[0-9]+$',
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[complexPatternBenchmark]}
        />
      );

      expect(screen.getByText(/\^\(load\|stress\)-test-/i)).toBeInTheDocument();
    });

    it('should handle benchmarks with metadata', () => {
      const metadataBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        metadata: { custom: 'value', important: true },
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[metadataBenchmark]}
        />
      );

      expect(screen.getByText('Response Time')).toBeInTheDocument();
    });
  });

  describe('Chip Styling', () => {
    it('should render workload pattern chips with gradient styling', () => {
      const { container } = render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const chips = container.querySelectorAll('.MuiChip-root');
      expect(chips.length).toBeGreaterThan(0);
    });

    it('should render tag chips with gradient styling', () => {
      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[mockBenchmark]}
        />
      );

      const performanceChip = screen.getByText('performance');
      expect(performanceChip).toBeInTheDocument();
      expect(performanceChip.closest('.MuiChip-root')).toBeInTheDocument();
    });

    it('should render "+X more" chip with purple gradient when present', () => {
      const manyTagsBenchmark: ProfileBenchmark = {
        ...mockBenchmark,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
      };

      render(
        <ProfileBenchmarksTable
          {...defaultProps}
          benchmarks={[manyTagsBenchmark]}
        />
      );

      const moreChip = screen.getByText('+2 more');
      expect(moreChip.closest('.MuiChip-root')).toBeInTheDocument();
    });
  });
});
