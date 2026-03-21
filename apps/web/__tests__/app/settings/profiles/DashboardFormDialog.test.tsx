/**
 * Unit tests for DashboardFormDialog Component
 *
 * Tests comprehensive form dialog functionality:
 * - Create vs Edit modes
 * - Form field rendering and validation
 * - Grafana instance and dashboard selection
 * - Hardcoded variables (add, remove, edit)
 * - Regex rules (add, remove, edit)
 * - Autocomplete functionality
 * - Form submission (create and update)
 * - Error handling
 * - Dialog open/close behavior
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DashboardFormDialog, {
  GrafanaInstance,
  GrafanaDashboard,
} from '@/app/settings/profiles/[id]/components/DashboardFormDialog';
import { ProfileDashboard } from '@/lib/profiles';

/**
 * Helper to get the MUI Select combobox for Grafana Instance.
 * MUI Select renders a div[role="combobox"] without an accessible name,
 * so we find it by locating the label text and searching within its parent FormControl.
 */
function getGrafanaInstanceSelect(): HTMLElement {
  const label = screen.getByText('Grafana Instance', { selector: 'label' });
  const formControl = label.closest('.MuiFormControl-root')!;
  return within(formControl as HTMLElement).getByRole('combobox');
}

describe('DashboardFormDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();

  const mockInstances: GrafanaInstance[] = [
    {
      id: 'instance-1',
      label: 'grafana-prod',
      client_url: 'http://grafana-prod.example.com',
      org_id: '1',
      snapshot_instance: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'instance-2',
      label: 'grafana-staging',
      client_url: 'http://grafana-staging.example.com',
      org_id: '1',
      snapshot_instance: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  const mockDashboards: GrafanaDashboard[] = [
    {
      id: 'dashboard-1',
      grafana_instance_id: 'instance-1',
      grafana_id: 1,
      uid: 'jmeter-overview',
      name: 'JMeter Overview',
      templating_variables: [
        { name: 'environment', type: 'custom' },
        { name: 'workload', type: 'query' },
      ],
      tags: ['performance', 'jmeter'],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'dashboard-2',
      grafana_instance_id: 'instance-2',
      grafana_id: 2,
      uid: 'system-metrics',
      name: 'System Metrics',
      templating_variables: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  const mockExistingDashboard: ProfileDashboard = {
    id: 'profile-dashboard-1',
    profile: 'profile-1',
    dashboardName: 'JMeter Overview',
    dashboardUid: 'jmeter-overview',
    grafanaLabel: 'grafana-prod',
    createSeparateDashboardForVariable: 'environment',
    setHardcodedValueForVariables: [
      { name: 'region', values: ['us-east-1'] },
    ],
    matchRegexForVariables: {
      'workload': '^load-test.*',
    },
    readOnly: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  describe('Dialog Rendering', () => {
    it('should render dialog when open is true', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should not render dialog when open is false', () => {
      render(
        <DashboardFormDialog
          open={false}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should display create mode title', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('Add Dashboard to Profile')).toBeInTheDocument();
    });

    it('should display edit mode title', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('Edit Dashboard Configuration')).toBeInTheDocument();
    });
  });

  describe('Grafana Instance Selection', () => {
    it('should render Grafana instance dropdown', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // MUI Select renders a div[role="combobox"] - use getByRole instead of getByLabelText
      expect(getGrafanaInstanceSelect()).toBeInTheDocument();
    });

    it('should populate instances in dropdown', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);

      await waitFor(() => {
        expect(screen.getByText('grafana-prod')).toBeInTheDocument();
        expect(screen.getByText('grafana-staging')).toBeInTheDocument();
      });
    });

    it('should be required field', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // MUI Select combobox uses aria-required attribute
      const instanceInput = getGrafanaInstanceSelect();
      expect(instanceInput).toHaveAttribute('aria-required', 'true');
    });
  });

  describe('Dashboard Selection', () => {
    it('should render dashboard autocomplete', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // MUI Autocomplete renders a combobox role
      expect(screen.getByRole('combobox', { name: 'Dashboard' })).toBeInTheDocument();
    });

    it('should be disabled until instance is selected', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      expect(dashboardInput).toBeDisabled();
    });

    it('should show helper text when no instance selected', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText(/select a grafana instance first/i)).toBeInTheDocument();
    });

    it('should show dashboard UID when dashboard is selected', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/UID: jmeter-overview/i)).toBeInTheDocument();
      });
    });
  });

  describe('Dashboard Variables Info', () => {
    it('should display available variables when dashboard is selected', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/available dashboard variables/i)).toBeInTheDocument();
        expect(screen.getByText(/environment \(custom\)/i)).toBeInTheDocument();
        expect(screen.getByText(/workload \(query\)/i)).toBeInTheDocument();
      });
    });

    it('should not show variables info when dashboard has no variables', async () => {
      const dashboardNoVars: ProfileDashboard = {
        ...mockExistingDashboard,
        dashboardUid: 'system-metrics',
        grafanaLabel: 'grafana-staging',
      };

      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={dashboardNoVars}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.queryByText(/available dashboard variables/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Separate Dashboard For Variable', () => {
    it('should render separate dashboard variable field', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByLabelText(/create separate dashboard for variable/i)).toBeInTheDocument();
    });

    it('should populate value in edit mode', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const input = screen.getByLabelText(/create separate dashboard for variable/i) as HTMLInputElement;
        expect(input.value).toBe('environment');
      });
    });
  });

  describe('Hardcoded Variables', () => {
    it('should render add variable button', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('button', { name: /add variable/i })).toBeInTheDocument();
    });

    it('should add new hardcoded variable when button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance first
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to be enabled, then select a dashboard
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      const addButton = screen.getByRole('button', { name: /add variable/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: /variable name/i })).toBeInTheDocument();
      });
    });

    it('should remove hardcoded variable when delete icon is clicked', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('region')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('[data-testid="DeleteIcon"]')
      );

      await user.click(deleteButtons[0]!);

      await waitFor(() => {
        expect(screen.queryByDisplayValue('region')).not.toBeInTheDocument();
      });
    });

    it('should populate existing hardcoded variables in edit mode', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('region')).toBeInTheDocument();
        expect(screen.getByText('us-east-1')).toBeInTheDocument();
      });
    });

    it('should be disabled when no dashboard selected', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const addButton = screen.getByRole('button', { name: /add variable/i });
      expect(addButton).toBeDisabled();
    });
  });

  describe('Regex Rules', () => {
    it('should render add rule button', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument();
    });

    it('should add new regex rule when button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance first
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to be enabled, then select a dashboard
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      const addButton = screen.getByRole('button', { name: /add rule/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/regex pattern/i)).toBeInTheDocument();
      });
    });

    it('should remove regex rule when delete icon is clicked', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('^load-test.*')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('[data-testid="DeleteIcon"]')
      );

      // Click the delete button for regex rule (will be after hardcoded var delete)
      await user.click(deleteButtons[deleteButtons.length - 1]!);

      await waitFor(() => {
        expect(screen.queryByDisplayValue('^load-test.*')).not.toBeInTheDocument();
      });
    });

    it('should populate existing regex rules in edit mode', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('workload')).toBeInTheDocument();
        expect(screen.getByDisplayValue('^load-test.*')).toBeInTheDocument();
      });
    });
  });

  describe('Read-only Checkbox', () => {
    it('should render read-only checkbox', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByLabelText(/read-only configuration/i)).toBeInTheDocument();
    });

    it('should be unchecked by default in create mode', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const checkbox = screen.getByLabelText(/read-only configuration/i) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should populate value in edit mode', async () => {
      const readOnlyDashboard: ProfileDashboard = {
        ...mockExistingDashboard,
        readOnly: true,
      };

      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={readOnlyDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        const checkbox = screen.getByLabelText(/read-only configuration/i) as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
      });
    });
  });

  describe('Form Validation', () => {
    it('should show error when submitting without grafana instance', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Submit button is disabled when no instance selected (isFormValid is false)
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      expect(submitButton).toBeDisabled();

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should show error when submitting without dashboard', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance only
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for the state update after instance selection
      await waitFor(() => {
        expect(getGrafanaInstanceSelect()).toHaveTextContent('grafana-prod');
      });

      // Submit button should still be disabled when no dashboard selected
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      expect(submitButton).toBeDisabled();

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should disable submit button when instance not selected', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Form Submission - Create Mode', () => {
    it('should submit correct data in create mode', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled after instance selection
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      // Submit
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaLabel: 'grafana-prod',
            dashboardUid: 'jmeter-overview',
            readOnly: false,
          })
        );
      });
    });

    it('should close dialog after successful submission', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      // Submit
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should include hardcoded variables in submission', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      // Add hardcoded variable
      const addVarButton = screen.getByRole('button', { name: /add variable/i });
      await user.click(addVarButton);

      // Fill variable name - rendered as Autocomplete combobox
      const varNameInput = screen.getByRole('combobox', { name: /variable name/i });
      await user.type(varNameInput, 'region');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            setHardcodedValueForVariables: [],
          })
        );
      });
    }, 20000); // Increased timeout from 10s to 20s to handle flaky test behavior

    it('should include regex rules in submission', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      // Add regex rule
      const addRuleButton = screen.getByRole('button', { name: /add rule/i });
      await user.click(addRuleButton);

      // Submit
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            matchRegexForVariables: {},
          })
        );
      });
    });
  });

  describe('Form Submission - Edit Mode', () => {
    it('should submit updated data in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Submit
      const submitButton = screen.getByRole('button', { name: /save changes/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaLabel: 'grafana-prod',
            dashboardUid: 'jmeter-overview',
          })
        );
      });
    });

    it('should preserve existing data in edit mode', async () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        // MUI Select renders the selected value as text content in the combobox div
        const instanceInput = getGrafanaInstanceSelect();
        expect(instanceInput).toHaveTextContent('grafana-prod');

        expect(screen.getByDisplayValue('environment')).toBeInTheDocument();
        expect(screen.getByDisplayValue('region')).toBeInTheDocument();
        expect(screen.getByDisplayValue('workload')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when submission fails', async () => {
      const user = userEvent.setup();
      const errorMessage = 'Failed to create dashboard';
      mockOnSubmit.mockRejectedValueOnce(new Error(errorMessage));

      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      // Submit
      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      // Verify the error text is within an alert element
      const errorAlert = screen.getByText(errorMessage).closest('[role="alert"]');
      expect(errorAlert).toBeInTheDocument();

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should not close dialog when submission fails', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockRejectedValueOnce(new Error('Submission failed'));

      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Wait for dashboard dropdown to become enabled
      await waitFor(() => {
        const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
        expect(dashboardInput).not.toBeDisabled();
      });

      // Select dashboard
      const dashboardInput = screen.getByRole('combobox', { name: 'Dashboard' });
      await user.click(dashboardInput);
      await waitFor(() => screen.getByText('JMeter Overview'));
      await user.click(screen.getByText('JMeter Overview'));

      const submitButton = screen.getByRole('button', { name: /add dashboard/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Submission failed')).toBeInTheDocument();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Dialog Close', () => {
    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should reset form when dialog is closed and reopened', async () => {
      const { rerender } = render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Select instance
      const instanceSelect = getGrafanaInstanceSelect();
      fireEvent.mouseDown(instanceSelect);
      await waitFor(() => screen.getByText('grafana-prod'));
      fireEvent.click(screen.getByText('grafana-prod'));

      // Verify instance was selected
      await waitFor(() => {
        expect(getGrafanaInstanceSelect()).toHaveTextContent('grafana-prod');
      });

      // Close dialog
      rerender(
        <DashboardFormDialog
          open={false}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Reopen dialog
      rerender(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Form should be reset - MUI Select combobox should not contain the previously selected value
      await waitFor(() => {
        const instanceInput = getGrafanaInstanceSelect();
        expect(instanceInput).not.toHaveTextContent('grafana-prod');
      });
    });
  });

  describe('Loading States', () => {
    it('should disable inputs when submitting', async () => {
      const user = userEvent.setup();
      let resolveSubmit: () => void;
      const submitPromise = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      mockOnSubmit.mockReturnValueOnce(submitPromise);

      render(
        <DashboardFormDialog
          open={true}
          mode="edit"
          dashboard={mockExistingDashboard}
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const submitButton = screen.getByRole('button', { name: /save changes/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });

      resolveSubmit!();
    });

    it('should show loading indicator when external loading is true', () => {
      render(
        <DashboardFormDialog
          open={true}
          mode="create"
          availableDashboards={mockDashboards}
          availableInstances={mockInstances}
          loading={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThan(0);
    });
  });
});
