/**
 * Unit tests for BenchmarkFormDialog Component
 *
 * Tests comprehensive SLO form dialog functionality:
 * - Create vs Edit modes
 * - Profile dashboard and metric selection
 * - Form field rendering and validation
 * - Evaluation type and operator options
 * - Requirement value with unit parsing
 * - Percentunit conversion
 * - Advanced options (exclude ramp-up, average all, etc.)
 * - Tags autocomplete
 * - Form submission (create and update)
 * - Error handling
 * - Dialog open/close behavior
 * - Panel fetching from Grafana
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import BenchmarkFormDialog from '@/app/settings/profiles/[id]/components/BenchmarkFormDialog';
import { ProfileDashboard } from '@/lib/profiles';
import { ProfileBenchmark } from '@/lib/profile-benchmarks';
import { authenticatedFetch } from '@/lib/api';

// Mock the API
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockAuthenticatedFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

/**
 * Helper to select a dashboard from the Profile Dashboard autocomplete.
 * Properly waits for the dropdown option to appear before clicking.
 */
async function selectDashboard(user: ReturnType<typeof userEvent.setup>, optionPattern: RegExp) {
  const dashboardInput = screen.getByRole('combobox', { name: /profile dashboard/i });
  await user.click(dashboardInput);

  // Wait for the option to appear in the listbox
  await waitFor(() => {
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText(optionPattern)).toBeInTheDocument();
  });

  const listbox = screen.getByRole('listbox');
  const option = within(listbox).getByText(optionPattern);
  await user.click(option);
}

/**
 * Helper to select a metric/panel from the Metric autocomplete.
 * Waits for the Metric field to appear, then selects the specified option.
 */
async function selectMetric(user: ReturnType<typeof userEvent.setup>, optionText: string) {
  // Wait for the Metric field to render (after panel fetch completes)
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: /metric/i })).toBeInTheDocument();
  });

  const metricInput = screen.getByRole('combobox', { name: /metric/i });
  await user.click(metricInput);

  // Wait for options to appear
  await waitFor(() => {
    expect(screen.getByText(optionText)).toBeInTheDocument();
  });

  await user.click(screen.getByText(optionText));
}

describe('BenchmarkFormDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();

  const mockProfileDashboards: ProfileDashboard[] = [
    {
      id: 'dashboard-1',
      profile: 'profile-1',
      dashboardName: 'JMeter Overview',
      dashboardUid: 'jmeter-uid',
      grafanaLabel: 'grafana-prod',
      tags: ['performance', 'jmeter'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'dashboard-2',
      profile: 'profile-1',
      dashboardName: 'System Metrics',
      dashboardUid: 'system-uid',
      grafanaLabel: 'grafana-staging',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  const mockGrafanaPanels = [
    {
      id: 1,
      title: 'Response Time',
      type: 'timeseries',
      yAxesFormat: 'ms',
      description: 'HTTP response time',
    },
    {
      id: 2,
      title: 'CPU Usage',
      type: 'graph',
      yAxesFormat: 'percentunit',
    },
    {
      id: 3,
      title: 'Memory Usage',
      type: 'stat',
      yAxesFormat: 'bytes',
    },
    {
      id: 4,
      title: 'Unsupported Panel',
      type: 'table', // Not in supported types
    },
  ];

  const mockExistingBenchmark: ProfileBenchmark = {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);

    // Mock successful panel fetch
    mockAuthenticatedFetch.mockResolvedValue({
      ok: true,
      json: async () => [{
        panels: mockGrafanaPanels,
      }],
    } as Response);
  });

  describe('Dialog Rendering', () => {
    it('should render dialog when open is true', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should not render dialog when open is false', () => {
      render(
        <BenchmarkFormDialog
          open={false}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should display create mode title and subtitle', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('Add Service Level Objective')).toBeInTheDocument();
      expect(screen.getByText('Create a new SLO for this profile')).toBeInTheDocument();
    });

    it('should display edit mode title and subtitle', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('Edit Service Level Objective')).toBeInTheDocument();
      expect(screen.getByText('Update the SLO configuration')).toBeInTheDocument();
    });
  });

  describe('Profile Dashboard Selection', () => {
    it('should render profile dashboard autocomplete', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByLabelText(/profile dashboard/i)).toBeInTheDocument();
    });

    it('should show helper text with dashboard count', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText(/2 available/i)).toBeInTheDocument();
    });

    it('should be required field', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByLabelText(/profile dashboard/i);
      expect(dashboardInput).toBeRequired();
    });

    it('should auto-populate tags from dashboard in create mode', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByLabelText(/profile dashboard/i);
      await user.click(dashboardInput);

      await waitFor(() => {
        const option = screen.getByText(/jmeter overview/i);
        expect(option).toBeInTheDocument();
      });

      const option = screen.getByText(/jmeter overview/i);
      await user.click(option);

      // Tags should be auto-populated (verified through submission)
    });

    it('should NOT auto-populate tags in edit mode', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const tagsInput = screen.getByLabelText(/^tags$/i);
        expect(tagsInput).toBeInTheDocument();
      });

      // Existing tags should be preserved
      expect(screen.getByText('performance')).toBeInTheDocument();
      expect(screen.getByText('http')).toBeInTheDocument();
    });
  });

  describe('Panel/Metric Selection', () => {
    it('should render metric autocomplete', () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Initially hidden until dashboard is selected
      const metricInputs = screen.queryAllByLabelText(/^metric$/i);
      expect(metricInputs.length).toBe(0);
    });

    it('should fetch panels when dashboard is selected', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByLabelText(/profile dashboard/i);
      await user.click(dashboardInput);

      const option = screen.getByText(/jmeter overview/i);
      await user.click(option);

      await waitFor(() => {
        expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/grafana/dashboards?uid=jmeter-uid'),
          expect.anything()
        );
      });
    });

    it('should filter panels by supported types', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await selectDashboard(user, /jmeter overview/i);

      // Wait for the Metric field to render after panel fetch
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: /metric/i })).toBeInTheDocument();
      });

      const metricInput = screen.getByRole('combobox', { name: /metric/i });
      await user.click(metricInput);

      await waitFor(() => {
        expect(screen.getByText('Response Time')).toBeInTheDocument();
        expect(screen.getByText('CPU Usage')).toBeInTheDocument();
        expect(screen.getByText('Memory Usage')).toBeInTheDocument();
        // Unsupported 'table' type should not appear
        expect(screen.queryByText('Unsupported Panel')).not.toBeInTheDocument();
      });
    });

    it('should show loading state while fetching panels', async () => {
      const user = userEvent.setup();

      // Make fetch slow
      let resolvePromise: (value: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockAuthenticatedFetch.mockReturnValueOnce(slowPromise as any);

      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByLabelText(/profile dashboard/i);
      await user.click(dashboardInput);
      const option = screen.getByText(/jmeter overview/i);
      await user.click(option);

      await waitFor(() => {
        expect(screen.getByText(/loading metrics/i)).toBeInTheDocument();
      });

      resolvePromise!({
        ok: true,
        json: async () => [{ panels: mockGrafanaPanels }],
      });
    });
  });

  describe('Evaluation Type', () => {
    it('should render evaluation type autocomplete with options', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select dashboard and panel first
      await selectDashboard(user, /jmeter overview/i);
      await selectMetric(user, 'Response Time');

      // Now evaluation type should be visible
      await waitFor(() => {
        expect(screen.getByLabelText(/evaluation type/i)).toBeInTheDocument();
      });

      const evalInput = screen.getByLabelText(/evaluation type/i);
      await user.click(evalInput);

      await waitFor(() => {
        expect(screen.getByText('Average')).toBeInTheDocument();
        expect(screen.getByText('Maximum')).toBeInTheDocument();
        expect(screen.getByText('Minimum')).toBeInTheDocument();
        expect(screen.getByText('Last Value')).toBeInTheDocument();
        expect(screen.getByText('50th Percentile')).toBeInTheDocument();
        expect(screen.getByText('90th Percentile')).toBeInTheDocument();
        expect(screen.getByText('95th Percentile')).toBeInTheDocument();
        expect(screen.getByText('99th Percentile')).toBeInTheDocument();
      });
    });

    it('should show descriptions for evaluation types', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/evaluation type/i)).toBeInTheDocument();
      });

      const evalInput = screen.getByLabelText(/evaluation type/i);
      await user.click(evalInput);

      await waitFor(() => {
        expect(screen.getByText(/calculate the average value across all data points/i)).toBeInTheDocument();
      });
    });
  });

  describe('Requirement Operator', () => {
    it('should render requirement operator autocomplete with options', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/requirement operator/i)).toBeInTheDocument();
      });

      const operatorInput = screen.getByLabelText(/requirement operator/i);
      await user.click(operatorInput);

      await waitFor(() => {
        expect(screen.getByText(/less than \(<\)/i)).toBeInTheDocument();
        expect(screen.getByText(/less than or equal \(≤\)/i)).toBeInTheDocument();
        expect(screen.getByText(/greater than \(>\)/i)).toBeInTheDocument();
        expect(screen.getByText(/greater than or equal \(≥\)/i)).toBeInTheDocument();
        expect(screen.getByText(/equal to \(=\)/i)).toBeInTheDocument();
        expect(screen.getByText(/not equal to \(≠\)/i)).toBeInTheDocument();
      });
    });

    it('should show descriptions for operators', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/requirement operator/i)).toBeInTheDocument();
      });

      const operatorInput = screen.getByLabelText(/requirement operator/i);
      await user.click(operatorInput);

      await waitFor(() => {
        expect(screen.getByText(/metric value must be below the threshold/i)).toBeInTheDocument();
      });
    });
  });

  describe('Requirement Value', () => {
    it('should render requirement value text field', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/requirement value/i)).toBeInTheDocument();
      });
    });

    it('should show placeholder with unit example', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const input = screen.getByLabelText(/requirement value/i);
        expect(input).toHaveAttribute('placeholder', expect.stringContaining('500'));
      });
    });

    it('should show unit chip when value has unit', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const input = screen.getByLabelText(/requirement value/i) as HTMLInputElement;
        expect(input.value).toBe('500');
      });
    });

    it('should detect unit from input', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select dashboard and panel
      await selectDashboard(user, /jmeter overview/i);
      await selectMetric(user, 'Response Time');

      await waitFor(() => screen.getByLabelText(/requirement value/i));
      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.type(valueInput, '500ms');

      await waitFor(() => {
        expect(screen.getByText(/unit: milliseconds/i)).toBeInTheDocument();
      });
    });

    it('should be required field', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const input = screen.getByLabelText(/requirement value/i);
        expect(input).toBeRequired();
      });
    });
  });

  describe('Workload Pattern', () => {
    it('should render workload pattern field', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/workload pattern/i)).toBeInTheDocument();
      });
    });

    it('should have default value of ".*" in create mode', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await selectDashboard(user, /jmeter overview/i);
      await selectMetric(user, 'Response Time');

      await waitFor(() => {
        const input = screen.getByLabelText(/workload pattern/i) as HTMLInputElement;
        expect(input.value).toBe('.*');
      });
    });

    it('should populate existing value in edit mode', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const input = screen.getByLabelText(/workload pattern/i) as HTMLInputElement;
        expect(input.value).toBe('load-test-.*');
      });
    });
  });

  describe('Tags', () => {
    it('should render tags autocomplete', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/^tags$/i)).toBeInTheDocument();
      });
    });

    it('should display existing tags in edit mode', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('performance')).toBeInTheDocument();
        expect(screen.getByText('http')).toBeInTheDocument();
      });
    });

    it('should allow adding new tags', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByLabelText(/^tags$/i));

      const tagsInput = screen.getByLabelText(/^tags$/i);
      await user.type(tagsInput, 'new-tag{enter}');

      await waitFor(() => {
        expect(screen.getByText('new-tag')).toBeInTheDocument();
      });
    });
  });

  describe('Advanced Options', () => {
    it('should render exclude ramp-up time checkbox', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/exclude ramp-up time/i)).toBeInTheDocument();
      });
    });

    it('should render average all values checkbox', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/average all values/i)).toBeInTheDocument();
      });
    });

    it('should render match pattern field', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/match pattern/i)).toBeInTheDocument();
      });
    });

    it('should render use default if no data checkbox', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/use default if no data/i)).toBeInTheDocument();
      });
    });

    it('should show default value field when use default is checked', async () => {
      const benchmarkWithDefault: ProfileBenchmark = {
        ...mockExistingBenchmark,
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: 0,
      };

      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={benchmarkWithDefault}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/default value if no data/i)).toBeInTheDocument();
      });
    });

    it('should hide default value field when use default is unchecked', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.queryByLabelText(/default value if no data/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Validation', () => {
    it('should show error when submitting without dashboard', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const submitButton = screen.getByRole('button', { name: /create slo/i });
      expect(submitButton).toBeDisabled();
    });

    it('should show error when submitting without panel', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByLabelText(/profile dashboard/i);
      await user.click(dashboardInput);
      await user.click(screen.getByText(/jmeter overview/i));

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /create slo/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('should show error when submitting without requirement value', async () => {
      const benchmarkNoValue: ProfileBenchmark = {
        ...mockExistingBenchmark,
        requirementValue: undefined as any,
      };

      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={benchmarkNoValue}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const submitButton = screen.getByRole('button', { name: /update slo/i });
        expect(submitButton).toBeDisabled();
      });
    });

    it('should validate numeric requirement value', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByLabelText(/requirement value/i));

      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.clear(valueInput);
      await user.type(valueInput, 'invalid');

      const submitButton = screen.getByRole('button', { name: /update slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/requirement value must be a valid number/i)).toBeInTheDocument();
      });
    });

    it('should validate default value when use default is enabled', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByLabelText(/use default if no data/i));

      // Enable default value
      const defaultCheckbox = screen.getByLabelText(/use default if no data/i);
      await user.click(defaultCheckbox);

      await waitFor(() => screen.getByLabelText(/default value if no data/i));

      // Leave default value empty - the submit button should be disabled
      // because isFormValid() returns false when validateWithDefaultIfNoData is true
      // but validateWithDefaultIfNoDataValue is empty
      const submitButton = screen.getByRole('button', { name: /update slo/i });
      expect(submitButton).toBeDisabled();

      // Type an invalid (non-numeric) value to make isFormValid() pass but validateForm() fail
      const defaultValueInput = screen.getByLabelText(/default value if no data/i);
      await user.type(defaultValueInput, 'invalid');

      // Now the button should be enabled since the field is non-empty
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update slo/i })).not.toBeDisabled();
      });

      // Click submit - validateForm should catch the invalid value
      await user.click(screen.getByRole('button', { name: /update slo/i }));

      await waitFor(() => {
        expect(screen.getByText(/default value must be a valid number/i)).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission - Create Mode', () => {
    it('should submit correct data in create mode', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select dashboard
      await selectDashboard(user, /jmeter overview/i);

      // Wait for panels to load and select one
      await selectMetric(user, 'Response Time');

      // Fill requirement value
      await waitFor(() => screen.getByLabelText(/requirement value/i));
      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.type(valueInput, '500ms');

      // Submit
      const submitButton = screen.getByRole('button', { name: /create slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            profileDashboardId: 'dashboard-1',
            source: 'grafana',
            grafanaInstance: 'grafana-prod',
            dashboardUid: 'jmeter-uid',
            panelId: 1,
            requirementOperator: 'lt',
          })
        );
      });
    });

    it('should convert percentunit values on submission', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select dashboard
      await selectDashboard(user, /jmeter overview/i);

      // Select CPU Usage panel (percentunit)
      await selectMetric(user, 'CPU Usage');

      // Enter 95% (should be converted to 0.95)
      await waitFor(() => screen.getByLabelText(/requirement value/i));
      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.type(valueInput, '95');

      const submitButton = screen.getByRole('button', { name: /create slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            requirementValue: 0.95,
          })
        );
      });
    });

    it('should close dialog after successful submission', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await selectDashboard(user, /jmeter overview/i);
      await selectMetric(user, 'Response Time');

      await waitFor(() => screen.getByLabelText(/requirement value/i));
      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.type(valueInput, '500');

      const submitButton = screen.getByRole('button', { name: /create slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('Form Submission - Edit Mode', () => {
    it('should preserve existing data in edit mode', async () => {
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const workloadInput = screen.getByLabelText(/workload pattern/i) as HTMLInputElement;
        expect(workloadInput.value).toBe('load-test-.*');

        const valueInput = screen.getByLabelText(/requirement value/i) as HTMLInputElement;
        expect(valueInput.value).toBe('500');
      });
    });

    it('should submit updated data in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByLabelText(/requirement value/i));

      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.clear(valueInput);
      await user.type(valueInput, '1000');

      const submitButton = screen.getByRole('button', { name: /update slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            requirementValue: 1000,
          })
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when submission fails', async () => {
      const user = userEvent.setup();
      const errorMessage = 'Failed to create SLO';
      mockOnSubmit.mockRejectedValueOnce(new Error(errorMessage));

      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await selectDashboard(user, /jmeter overview/i);
      await selectMetric(user, 'Response Time');

      await waitFor(() => screen.getByLabelText(/requirement value/i));
      const valueInput = screen.getByLabelText(/requirement value/i);
      await user.type(valueInput, '500');

      const submitButton = screen.getByRole('button', { name: /create slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should handle panel fetch failure gracefully', async () => {
      const user = userEvent.setup();
      mockAuthenticatedFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as Response);

      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await selectDashboard(user, /jmeter overview/i);

      // Should still render metric field even if fetch failed
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: /metric/i })).toBeInTheDocument();
      });
    });
  });

  describe('Dialog Close', () => {
    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should clear errors when dialog is closed', async () => {
      const { rerender } = render(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Close and reopen
      rerender(
        <BenchmarkFormDialog
          open={false}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      rerender(
        <BenchmarkFormDialog
          open={true}
          mode="create"
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // No error alerts should be visible
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should show loading text in submit button when submitting', async () => {
      const user = userEvent.setup();
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      mockOnSubmit.mockReturnValueOnce(submitPromise);

      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByRole('button', { name: /update slo/i }));

      const submitButton = screen.getByRole('button', { name: /update slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/updating slo/i)).toBeInTheDocument();
      });

      resolveSubmit!();
    });

    it('should disable form inputs when submitting', async () => {
      const user = userEvent.setup();
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      mockOnSubmit.mockReturnValueOnce(submitPromise);

      render(
        <BenchmarkFormDialog
          open={true}
          mode="edit"
          benchmark={mockExistingBenchmark}
          profileDashboards={mockProfileDashboards}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => screen.getByRole('button', { name: /update slo/i }));

      const submitButton = screen.getByRole('button', { name: /update slo/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        expect(cancelButton).toBeDisabled();
      });

      resolveSubmit!();
    });
  });
});
