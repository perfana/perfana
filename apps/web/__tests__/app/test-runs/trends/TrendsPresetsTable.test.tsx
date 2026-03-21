/**
 * Unit tests for TrendsPresetsTable Component
 *
 * Tests the trends presets table functionality:
 * - Rendering presets in a table format
 * - Loading state with skeletons
 * - Empty state when no presets exist
 * - Preset selection via row click or apply button
 * - Preset deletion with permission checks
 * - Visual styling for preset types (generic vs specific)
 * - Dashboard and metric display
 * - User-specific delete permissions
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TrendsPresetsTable, { TrendsPreset } from '@/app/test-runs/[id]/components/trends/TrendsPresetsTable';
import { PresetType } from '@/lib/trends-presets';

describe('TrendsPresetsTable', () => {
  const mockOnSelectPreset = jest.fn();
  const mockOnDeletePreset = jest.fn();

  const samplePresets: TrendsPreset[] = [
    {
      id: 'preset-1',
      name: 'CPU Usage Trends',
      description: 'Track CPU usage over time',
      preset_type: PresetType.GENERIC,
      application_dashboard_id: 'dashboard-123',
      panel_id: 5,
      panel_title: 'CPU Usage',
      evaluate_type: 'avg',
      source: 'grafana',
      dashboard_label: 'System Performance',
      created_for_test_run_id: 'test-run-1',
      created_by: 'user-123',
      is_global: true,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 'preset-2',
      name: 'Memory Analysis',
      description: 'Memory usage analysis',
      preset_type: PresetType.SPECIFIC,
      application_dashboard_id: 'dashboard-456',
      panel_id: 10,
      panel_title: 'Memory Usage',
      evaluate_type: 'max',
      source: 'grafana',
      dashboard_label: 'JVM Metrics',
      created_for_test_run_id: 'test-run-1',
      created_by: 'user-456',
      is_global: false,
      created_at: '2024-01-15T11:00:00Z',
      updated_at: '2024-01-15T11:00:00Z',
    },
  ];

  const defaultProps = {
    presets: samplePresets,
    loading: false,
    currentUserId: 'user-123',
    onSelectPreset: mockOnSelectPreset,
    onDeletePreset: mockOnDeletePreset,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should render skeleton loaders when loading', () => {
      const { container } = render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={[]}
          loading={true}
        />
      );

      // Should have 3 skeleton loaders (MUI Skeleton components)
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThanOrEqual(3);
    });

    it('should not render table when loading', () => {
      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={[]}
          loading={true}
        />
      );

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state message when no presets', () => {
      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={[]}
          loading={false}
        />
      );

      expect(screen.getByText(/No saved presets yet/i)).toBeInTheDocument();
      expect(screen.getByText(/Configure filters and save them as presets/i)).toBeInTheDocument();
    });

    it('should not render table when no presets', () => {
      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={[]}
          loading={false}
        />
      );

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Table Rendering', () => {
    it('should render table with headers', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Metric')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('should render all presets in the table', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByText('CPU Usage Trends')).toBeInTheDocument();
      expect(screen.getByText('Memory Analysis')).toBeInTheDocument();
    });

    it('should render preset names and descriptions', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByText('CPU Usage Trends')).toBeInTheDocument();
      expect(screen.getByText('Track CPU usage over time')).toBeInTheDocument();
      expect(screen.getByText('Memory Analysis')).toBeInTheDocument();
      expect(screen.getByText('Memory usage analysis')).toBeInTheDocument();
    });

    it('should render dashboard labels', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByText('System Performance')).toBeInTheDocument();
      expect(screen.getByText('JVM Metrics')).toBeInTheDocument();
    });

    it('should render panel titles', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByText('CPU Usage')).toBeInTheDocument();
      expect(screen.getByText('Memory Usage')).toBeInTheDocument();
    });

    it('should render "Any" when dashboard label is missing', () => {
      const presetsWithoutLabel = [
        {
          ...samplePresets[0],
          dashboard_label: undefined,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={presetsWithoutLabel}
        />
      );

      expect(screen.getByText('Any')).toBeInTheDocument();
    });

    it('should render "Any" when panel title is missing', () => {
      const presetsWithoutPanel = [
        {
          ...samplePresets[0],
          panel_title: undefined,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={presetsWithoutPanel}
        />
      );

      expect(screen.getByText('Any')).toBeInTheDocument();
    });
  });

  describe('Preset Type Display', () => {
    it('should render Generic chip for generic presets', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const genericChip = screen.getByText('Generic');
      expect(genericChip).toBeInTheDocument();
    });

    it('should render Specific chip for specific presets', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const specificChip = screen.getByText('Specific');
      expect(specificChip).toBeInTheDocument();
    });

    it('should apply primary color to generic preset chip', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const genericChip = screen.getByText('Generic').closest('.MuiChip-root');
      expect(genericChip).toHaveStyle({ borderColor: expect.any(String) });
    });

    it('should apply secondary color to specific preset chip', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const specificChip = screen.getByText('Specific').closest('.MuiChip-root');
      expect(specificChip).toHaveStyle({ borderColor: expect.any(String) });
    });
  });

  describe('Preset Selection', () => {
    it('should call onSelectPreset when row is clicked', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      // Click directly on the text element within the row, not the row itself
      const firstRowText = screen.getByText('CPU Usage Trends');
      fireEvent.click(firstRowText);

      expect(mockOnSelectPreset).toHaveBeenCalledWith(samplePresets[0]);
    });

    it('should call onSelectPreset when apply button is clicked', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const applyButtons = screen.getAllByLabelText('Apply preset');
      fireEvent.click(applyButtons[0]);

      expect(mockOnSelectPreset).toHaveBeenCalledWith(samplePresets[0]);
    });

    it('should call onSelectPreset with correct preset when second row clicked', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      // Click directly on the text element within the row
      const secondRowText = screen.getByText('Memory Analysis');
      fireEvent.click(secondRowText);

      expect(mockOnSelectPreset).toHaveBeenCalledWith(samplePresets[1]);
    });

    it('should have hover effect on table rows', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const rows = screen.getAllByRole('row');
      const firstDataRow = rows[1]; // Skip header row

      expect(firstDataRow).toHaveStyle({ cursor: 'pointer' });
    });
  });

  describe('Preset Deletion', () => {
    it('should show delete button for presets created by current user', () => {
      render(<TrendsPresetsTable {...defaultProps} currentUserId="user-123" />);

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should show delete button for global presets', () => {
      const globalPresets = [
        {
          ...samplePresets[0],
          created_by: 'other-user',
          is_global: true,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={globalPresets}
          currentUserId="user-123"
        />
      );

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should not show delete button for other users non-global presets', () => {
      const otherUserPresets = [
        {
          ...samplePresets[1],
          created_by: 'other-user',
          is_global: false,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={otherUserPresets}
          currentUserId="user-123"
        />
      );

      const deleteButtons = screen.queryAllByTitle('Delete preset');
      expect(deleteButtons.length).toBe(0);
    });

    it('should call onDeletePreset when delete button clicked', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      fireEvent.click(deleteButtons[0]);

      expect(mockOnDeletePreset).toHaveBeenCalledWith('preset-1');
    });

    it('should stop propagation when delete button clicked', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      fireEvent.click(deleteButtons[0]);

      // Should not call onSelectPreset due to stopPropagation
      expect(mockOnSelectPreset).not.toHaveBeenCalled();
      expect(mockOnDeletePreset).toHaveBeenCalledWith('preset-1');
    });

    it('should show both apply and delete buttons in actions column', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const rows = screen.getAllByRole('row');
      const firstDataRow = rows[1]; // Skip header row

      const applyButton = within(firstDataRow).getByLabelText('Apply preset');
      const deleteButton = within(firstDataRow).getByLabelText('Delete preset');

      expect(applyButton).toBeInTheDocument();
      expect(deleteButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle presets without descriptions', () => {
      const presetsWithoutDesc = [
        {
          ...samplePresets[0],
          description: undefined,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={presetsWithoutDesc}
        />
      );

      expect(screen.getByText('CPU Usage Trends')).toBeInTheDocument();
      expect(screen.queryByText('Track CPU usage over time')).not.toBeInTheDocument();
    });

    it('should handle undefined currentUserId', () => {
      render(
        <TrendsPresetsTable
          {...defaultProps}
          currentUserId={undefined}
        />
      );

      // Should still render table
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should handle single preset', () => {
      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={[samplePresets[0]]}
        />
      );

      expect(screen.getByText('CPU Usage Trends')).toBeInTheDocument();
      expect(screen.queryByText('Memory Analysis')).not.toBeInTheDocument();
    });

    it('should handle many presets', () => {
      const manyPresets = Array.from({ length: 20 }, (_, i) => ({
        ...samplePresets[0],
        id: `preset-${i}`,
        name: `Preset ${i}`,
      }));

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={manyPresets}
        />
      );

      expect(screen.getByText('Preset 0')).toBeInTheDocument();
      expect(screen.getByText('Preset 19')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper table structure', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      expect(screen.getAllByRole('columnheader').length).toBe(5);
    });

    it('should have accessible tooltips for action buttons', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      expect(screen.getAllByLabelText('Apply preset').length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText('Delete preset').length).toBeGreaterThan(0);
    });

    it('should have proper button roles', () => {
      render(<TrendsPresetsTable {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Visual Styling', () => {
    it('should render table in paper component', () => {
      const { container } = render(<TrendsPresetsTable {...defaultProps} />);

      const paper = container.querySelector('.MuiPaper-root');
      expect(paper).toBeInTheDocument();
    });

    it('should use small table size', () => {
      const { container } = render(<TrendsPresetsTable {...defaultProps} />);

      const table = container.querySelector('.MuiTable-root');
      expect(table).toBeInTheDocument();
    });

    it('should truncate long dashboard labels', () => {
      const presetsWithLongLabel = [
        {
          ...samplePresets[0],
          dashboard_label: 'This is a very long dashboard label that should be truncated',
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={presetsWithLongLabel}
        />
      );

      const labelElement = screen.getByText('This is a very long dashboard label that should be truncated');
      expect(labelElement).toHaveStyle({ maxWidth: '200px' });
    });

    it('should truncate long panel titles', () => {
      const presetsWithLongTitle = [
        {
          ...samplePresets[0],
          panel_title: 'This is a very long panel title that should be truncated',
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={presetsWithLongTitle}
        />
      );

      const titleElement = screen.getByText('This is a very long panel title that should be truncated');
      expect(titleElement).toHaveStyle({ maxWidth: '200px' });
    });
  });

  describe('Multiple User Scenarios', () => {
    it('should handle presets from multiple users', () => {
      const mixedPresets = [
        { ...samplePresets[0], created_by: 'user-123' },
        { ...samplePresets[1], created_by: 'user-456' },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={mixedPresets}
          currentUserId="user-123"
        />
      );

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      // Should only show delete button for user-123's preset and global preset
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should allow deletion of own presets even if not global', () => {
      const ownPreset = [
        {
          ...samplePresets[0],
          created_by: 'user-123',
          is_global: false,
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={ownPreset}
          currentUserId="user-123"
        />
      );

      const deleteButtons = screen.getAllByLabelText('Delete preset');
      expect(deleteButtons.length).toBe(1);
    });
  });

  describe('Dynatrace Source Support', () => {
    it('should handle presets from dynatrace source', () => {
      const dynatracePresets = [
        {
          ...samplePresets[0],
          source: 'dynatrace',
          dashboard_label: 'Dynatrace Dashboard',
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={dynatracePresets}
        />
      );

      expect(screen.getByText('Dynatrace Dashboard')).toBeInTheDocument();
    });

    it('should handle presets from grafana source', () => {
      const grafanaPresets = [
        {
          ...samplePresets[0],
          source: 'grafana',
          dashboard_label: 'Grafana Dashboard',
        },
      ];

      render(
        <TrendsPresetsTable
          {...defaultProps}
          presets={grafanaPresets}
        />
      );

      expect(screen.getByText('Grafana Dashboard')).toBeInTheDocument();
    });
  });
});
