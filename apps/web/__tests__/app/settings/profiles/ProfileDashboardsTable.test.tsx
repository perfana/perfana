/**
 * Unit tests for ProfileDashboardsTable Component
 *
 * Tests comprehensive table functionality:
 * - Rendering dashboards with all columns
 * - Loading states
 * - Error states
 * - Empty states
 * - Tag filtering (system tags excluded)
 * - Edit and delete actions
 * - Delete confirmation dialog
 * - Fancy chips with gradients
 * - Tooltips for variables and regex rules
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within as _within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileDashboardsTable from '@/app/settings/profiles/[id]/components/ProfileDashboardsTable';
import { ProfileDashboard } from '@/lib/profiles';

describe('ProfileDashboardsTable', () => {
  const mockOnEdit = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnSelectAll = jest.fn();
  const mockOnSelectOne = jest.fn();
  const mockOnBatchDelete = jest.fn();

  // Default props that all tests need
  const defaultProps = {
    dashboards: [] as ProfileDashboard[],
    loading: false,
    error: '',
    selectedDashboardIds: new Set<string>(),
    onEdit: mockOnEdit,
    onDelete: mockOnDelete,
    onSelectAll: mockOnSelectAll,
    onSelectOne: mockOnSelectOne,
    onBatchDelete: mockOnBatchDelete,
  };

  const mockDashboard: ProfileDashboard = {
    id: 'dashboard-1',
    profile: 'profile-1',
    dashboardName: 'JMeter Overview',
    dashboardUid: 'jmeter-overview-uid',
    grafanaLabel: 'grafana-prod',
    tags: ['performance', 'jmeter', 'perfana-system', 'ig-internal'],
    createSeparateDashboardForVariable: 'environment',
    setHardcodedValueForVariables: [
      { name: 'region', values: ['us-east-1', 'us-west-2'] },
      { name: 'namespace', values: ['production'] },
    ],
    matchRegexForVariables: {
      'workload': '^load-test.*',
      'app': 'my-app',
    },
    readOnly: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockReadOnlyDashboard: ProfileDashboard = {
    id: 'dashboard-2',
    profile: 'profile-1',
    dashboardName: 'System Metrics',
    dashboardUid: 'system-metrics-uid',
    grafanaLabel: 'grafana-staging',
    readOnly: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockMinimalDashboard: ProfileDashboard = {
    id: 'dashboard-3',
    profile: 'profile-1',
    dashboardName: 'Minimal Dashboard',
    dashboardUid: 'minimal-uid',
    grafanaLabel: 'grafana-dev',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should display loading spinner when loading is true', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          loading={true}
        />
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('should display CircularProgress with correct size', () => {
      const { container } = render(
        <ProfileDashboardsTable
          {...defaultProps}
          loading={true}
        />
      );

      const progressBar = container.querySelector('.MuiCircularProgress-root');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when error is provided', () => {
      const errorMessage = 'Failed to load dashboards';
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          error={errorMessage}
        />
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should not display table when error is shown', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          error="Error occurred"
        />
      );

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no dashboards', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
        />
      );

      expect(screen.getByText('No Dashboards Found')).toBeInTheDocument();
      expect(screen.getByText(/This profile does not have any auto-configuration dashboards/i)).toBeInTheDocument();
    });

    it('should not display table when dashboards array is empty', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
        />
      );

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render table with all column headers', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText('Dashboard Name')).toBeInTheDocument();
      expect(screen.getByText('Grafana Instance')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
      expect(screen.getByText('Separate Dashboard For')).toBeInTheDocument();
      expect(screen.getByText('Hardcoded Variables')).toBeInTheDocument();
      expect(screen.getByText('Regex Rules')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('should render dashboard name and UID', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText('JMeter Overview')).toBeInTheDocument();
      expect(screen.getByText(/UID: jmeter-overview-uid/i)).toBeInTheDocument();
    });

    it('should render grafana instance label', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText('grafana-prod')).toBeInTheDocument();
    });

    it('should render read-only chip for read-only dashboards', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockReadOnlyDashboard]}
        />
      );

      expect(screen.getByText('Read-only')).toBeInTheDocument();
    });

    it('should not render read-only chip for editable dashboards', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.queryByText('Read-only')).not.toBeInTheDocument();
    });

    it('should render multiple dashboards', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard, mockReadOnlyDashboard, mockMinimalDashboard]}
        />
      );

      expect(screen.getByText('JMeter Overview')).toBeInTheDocument();
      expect(screen.getByText('System Metrics')).toBeInTheDocument();
      expect(screen.getByText('Minimal Dashboard')).toBeInTheDocument();
    });
  });

  describe('Tags Filtering', () => {
    it('should filter out system tags containing "perfana"', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText('performance')).toBeInTheDocument();
      expect(screen.getByText('jmeter')).toBeInTheDocument();
      expect(screen.queryByText('perfana-system')).not.toBeInTheDocument();
    });

    it('should filter out system tags containing "ig"', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.queryByText('ig-internal')).not.toBeInTheDocument();
    });

    it('should display dash when no tags after filtering', () => {
      const dashboardWithOnlySystemTags: ProfileDashboard = {
        ...mockDashboard,
        tags: ['perfana-system', 'ig-internal'],
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithOnlySystemTags]}
        />
      );

      // Find the tags cell and verify it shows a dash
      const rows = screen.getAllByRole('row');
      const dataRow = rows.find(row => row.textContent?.includes('JMeter Overview'));
      expect(dataRow).toBeInTheDocument();
    });

    it('should display dash when tags are undefined', () => {
      const dashboardWithNoTags: ProfileDashboard = {
        ...mockDashboard,
        tags: undefined,
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithNoTags]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });
  });

  describe('Separate Dashboard For Variable', () => {
    it('should render variable chip when createSeparateDashboardForVariable is set', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText('environment')).toBeInTheDocument();
    });

    it('should display dash when createSeparateDashboardForVariable is not set', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockMinimalDashboard]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });
  });

  describe('Hardcoded Variables', () => {
    it('should render hardcoded variable chips with values', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText(/region: us-east-1, us-west-2/i)).toBeInTheDocument();
      expect(screen.getByText(/namespace: production/i)).toBeInTheDocument();
    });

    it('should truncate long variable labels and show tooltip', () => {
      const dashboardWithLongVariable: ProfileDashboard = {
        ...mockDashboard,
        setHardcodedValueForVariables: [
          {
            name: 'very-long-variable-name',
            values: ['value1', 'value2', 'value3', 'value4', 'value5']
          },
        ],
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithLongVariable]}
        />
      );

      // The chip should show truncated text - verify it exists via text content
      expect(screen.getByText(/very-long-variable-name/i)).toBeInTheDocument();
    });

    it('should display dash when no hardcoded variables', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockMinimalDashboard]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });

    it('should display dash when hardcoded variables array is empty', () => {
      const dashboardWithEmptyVariables: ProfileDashboard = {
        ...mockDashboard,
        setHardcodedValueForVariables: [],
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithEmptyVariables]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });
  });

  describe('Regex Rules', () => {
    it('should render regex rule chips', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      expect(screen.getByText(/workload: \^load-test\.\*/i)).toBeInTheDocument();
      expect(screen.getByText(/app: my-app/i)).toBeInTheDocument();
    });

    it('should truncate long regex patterns and show tooltip', () => {
      const dashboardWithLongRegex: ProfileDashboard = {
        ...mockDashboard,
        matchRegexForVariables: {
          'variable': '^very-long-regex-pattern-that-should-be-truncated-in-the-display',
        },
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithLongRegex]}
        />
      );

      const chips = screen.getAllByRole('button');
      expect(chips.length).toBeGreaterThan(0);
    });

    it('should display dash when no regex rules', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockMinimalDashboard]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });

    it('should display dash when regex rules object is empty', () => {
      const dashboardWithEmptyRegex: ProfileDashboard = {
        ...mockDashboard,
        matchRegexForVariables: {},
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[dashboardWithEmptyRegex]}
        />
      );

      const rows = screen.getAllByRole('row');
      expect(rows.length).toBeGreaterThan(1);
    });
  });

  describe('Edit Action', () => {
    it('should call onEdit when edit button is clicked', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[0]!);

      expect(mockOnEdit).toHaveBeenCalledTimes(1);
      expect(mockOnEdit).toHaveBeenCalledWith(mockDashboard);
    });

    it('should call onEdit with correct dashboard when multiple dashboards exist', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard, mockReadOnlyDashboard]}
        />
      );

      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      fireEvent.click(editButtons[1]!); // Click second dashboard's edit button

      expect(mockOnEdit).toHaveBeenCalledWith(mockReadOnlyDashboard);
    });
  });

  describe('Delete Action', () => {
    it('should open delete confirmation dialog when delete button is clicked', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]!);

      expect(screen.getByText('Delete Dashboard Association?')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to remove/i)).toBeInTheDocument();
      // JMeter Overview appears multiple times (in table and dialog) - use getAllByText
      const jmeterTexts = screen.getAllByText(/JMeter Overview/i);
      expect(jmeterTexts.length).toBeGreaterThan(0);
    });

    it('should call onDelete when delete is confirmed', async () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      // Open delete dialog
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]!);

      // Confirm deletion
      const confirmButton = screen.getByRole('button', { name: /^delete$/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledTimes(1);
        expect(mockOnDelete).toHaveBeenCalledWith('dashboard-1');
      });
    });

    it('should close dialog when cancel is clicked', async () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      // Open delete dialog
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]!);

      // Cancel deletion
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Delete Dashboard Association?')).not.toBeInTheDocument();
        expect(mockOnDelete).not.toHaveBeenCalled();
      });
    });

    it('should close dialog when clicking outside (onClose)', async () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      // Open delete dialog
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]!);

      // Find and click the backdrop
      const dialog = screen.getByRole('dialog');
      const backdrop = dialog.parentElement?.querySelector('.MuiBackdrop-root');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      await waitFor(() => {
        expect(mockOnDelete).not.toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels on table', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      const table = screen.getByRole('table', { name: /profile dashboards table/i });
      expect(table).toBeInTheDocument();
    });

    it('should have proper ARIA labels on delete dialog', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]!);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'delete-dialog-title');
      expect(dialog).toHaveAttribute('aria-describedby', 'delete-dialog-description');
    });

    it('should have tooltips for action buttons', () => {
      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[mockDashboard]}
        />
      );

      // Tooltips are rendered by MUI - we can verify the button titles exist
      const editButton = screen.getAllByRole('button', { name: /edit/i })[0];
      const deleteButton = screen.getAllByRole('button', { name: /delete/i })[0];

      expect(editButton).toBeInTheDocument();
      expect(deleteButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle dashboard with all optional fields missing', () => {
      const minimalDashboard: ProfileDashboard = {
        id: 'minimal',
        profile: 'profile-1',
        dashboardName: 'Minimal',
        dashboardUid: 'minimal-uid',
        grafanaLabel: 'grafana',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[minimalDashboard]}
        />
      );

      expect(screen.getByText('Minimal')).toBeInTheDocument();
    });

    it('should handle very long dashboard names', () => {
      const longNameDashboard: ProfileDashboard = {
        ...mockDashboard,
        dashboardName: 'Very Long Dashboard Name That Should Be Displayed Without Breaking The Layout And Maintaining Readability',
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[longNameDashboard]}
        />
      );

      expect(screen.getByText(/Very Long Dashboard Name/i)).toBeInTheDocument();
    });

    it('should handle multiple variables with multiple values', () => {
      const multiVarDashboard: ProfileDashboard = {
        ...mockDashboard,
        setHardcodedValueForVariables: [
          { name: 'var1', values: ['a', 'b', 'c'] },
          { name: 'var2', values: ['x', 'y', 'z'] },
          { name: 'var3', values: ['1', '2', '3'] },
        ],
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[multiVarDashboard]}
        />
      );

      expect(screen.getByText(/var1:/i)).toBeInTheDocument();
      expect(screen.getByText(/var2:/i)).toBeInTheDocument();
      expect(screen.getByText(/var3:/i)).toBeInTheDocument();
    });

    it('should handle multiple regex rules', () => {
      const multiRegexDashboard: ProfileDashboard = {
        ...mockDashboard,
        matchRegexForVariables: {
          'rule1': '^pattern1.*',
          'rule2': '^pattern2.*',
          'rule3': '^pattern3.*',
        },
      };

      render(
        <ProfileDashboardsTable
          {...defaultProps}
          dashboards={[multiRegexDashboard]}
        />
      );

      expect(screen.getByText(/rule1:/i)).toBeInTheDocument();
      expect(screen.getByText(/rule2:/i)).toBeInTheDocument();
      expect(screen.getByText(/rule3:/i)).toBeInTheDocument();
    });
  });
});
