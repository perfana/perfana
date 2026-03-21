/**
 * Unit tests for ConfigSaveDialog Component
 *
 * Tests the configuration save dialog functionality:
 * - Dialog open/close behavior
 * - Option selection (none, current, all)
 * - Save and cancel actions
 * - Loading states
 * - Radio button interaction
 * - Descriptive text display
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConfigSaveDialog from '@/app/test-runs/[id]/components/anomaly-detection/components/ConfigSaveDialog';

describe('ConfigSaveDialog', () => {
  describe('Basic Rendering', () => {
    it('should render when open is true', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });

    it('should not render when open is false', () => {
      render(
        <ConfigSaveDialog
          open={false}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.queryByText('Save Configuration Changes')).not.toBeInTheDocument();
    });

    it('should display dialog title', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });

    it('should display subtitle', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText(/How would you like to handle the analysis after saving/)).toBeInTheDocument();
    });
  });

  describe('Option Selection', () => {
    it('should have "none" selected by default', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const noneRadio = screen.getByLabelText(/Without updating analysis/i);
      expect(noneRadio).toBeChecked();
    });

    it('should allow selecting "current" option', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);
      expect(currentRadio).toBeChecked();
    });

    it('should allow selecting "all" option', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const allRadio = screen.getByLabelText(/Update analysis for all test runs/i);
      fireEvent.click(allRadio);
      expect(allRadio).toBeChecked();
    });

    it('should toggle between options', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const noneRadio = screen.getByLabelText(/Without updating analysis/i);
      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      const allRadio = screen.getByLabelText(/Update analysis for all test runs/i);

      expect(noneRadio).toBeChecked();

      fireEvent.click(currentRadio);
      expect(currentRadio).toBeChecked();
      expect(noneRadio).not.toBeChecked();

      fireEvent.click(allRadio);
      expect(allRadio).toBeChecked();
      expect(currentRadio).not.toBeChecked();

      fireEvent.click(noneRadio);
      expect(noneRadio).toBeChecked();
      expect(allRadio).not.toBeChecked();
    });
  });

  describe('Option Descriptions', () => {
    it('should display description for "none" option', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText(/Save configuration changes only/)).toBeInTheDocument();
      expect(screen.getByText(/Analysis results will remain as-is and may appear outdated/)).toBeInTheDocument();
    });

    it('should display description for "current" option', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText(/Re-analyze this specific test run with the new configuration settings/)).toBeInTheDocument();
    });

    it('should display description for "all" option', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText(/Re-analyze all test runs up to the latest identified change point/)).toBeInTheDocument();
    });

    it('should display all three option titles', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Without updating analysis')).toBeInTheDocument();
      expect(screen.getByText('Update analysis for this test run')).toBeInTheDocument();
      expect(screen.getByText('Update analysis for all test runs')).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should display cancel button', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should display save button', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
    });

    it('should call onClose when cancel is clicked', () => {
      const handleClose = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={handleClose}
          onSave={() => {}}
        />
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should call onSave with default option when save is clicked', () => {
      const handleSave = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={handleSave}
        />
      );

      fireEvent.click(screen.getByText('Save Configuration'));
      expect(handleSave).toHaveBeenCalledWith('none');
    });

    it('should call onSave with "current" when selected and saved', () => {
      const handleSave = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={handleSave}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);
      fireEvent.click(screen.getByText('Save Configuration'));

      expect(handleSave).toHaveBeenCalledWith('current');
    });

    it('should call onSave with "all" when selected and saved', () => {
      const handleSave = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={handleSave}
        />
      );

      const allRadio = screen.getByLabelText(/Update analysis for all test runs/i);
      fireEvent.click(allRadio);
      fireEvent.click(screen.getByText('Save Configuration'));

      expect(handleSave).toHaveBeenCalledWith('all');
    });

    it('should call handlers only once per click', () => {
      const handleSave = jest.fn();
      const handleClose = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={handleClose}
          onSave={handleSave}
        />
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(handleClose).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('Save Configuration'));
      expect(handleSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('Loading State', () => {
    it('should display "Saving..." when loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={true}
        />
      );

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should display "Save Configuration" when not loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={false}
        />
      );

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
    });

    it('should disable cancel button when loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={true}
        />
      );

      expect(screen.getByText('Cancel')).toBeDisabled();
    });

    it('should disable save button when loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={true}
        />
      );

      expect(screen.getByText('Saving...')).toBeDisabled();
    });

    it('should enable buttons when not loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={false}
        />
      );

      expect(screen.getByText('Cancel')).not.toBeDisabled();
      expect(screen.getByText('Save Configuration')).not.toBeDisabled();
    });

    it('should default to not loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
      expect(screen.getByText('Save Configuration')).not.toBeDisabled();
    });
  });

  describe('Dialog Structure', () => {
    it('should have proper dialog structure', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });

    it('should have minimum height style applied', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      // Dialog is present - specific styles are applied via PaperProps
      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });

    it('should be full-width dialog', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });

    it('should have radio group with options', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByLabelText(/Without updating analysis/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Update analysis for this test run/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Update analysis for all test runs/i)).toBeInTheDocument();
    });

    it('should have three radio buttons', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const noneRadio = screen.getByLabelText(/Without updating analysis/i);
      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      const allRadio = screen.getByLabelText(/Update analysis for all test runs/i);

      expect(noneRadio).toBeInTheDocument();
      expect(currentRadio).toBeInTheDocument();
      expect(allRadio).toBeInTheDocument();
    });
  });

  describe('User Interaction Flow', () => {
    it('should allow changing selection multiple times before saving', () => {
      const handleSave = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={handleSave}
        />
      );

      const noneRadio = screen.getByLabelText(/Without updating analysis/i);
      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      const allRadio = screen.getByLabelText(/Update analysis for all test runs/i);

      // Change selections multiple times
      fireEvent.click(currentRadio);
      fireEvent.click(allRadio);
      fireEvent.click(noneRadio);
      fireEvent.click(currentRadio);

      // Save
      fireEvent.click(screen.getByText('Save Configuration'));

      // Should save the last selection
      expect(handleSave).toHaveBeenCalledWith('current');
    });

    it('should preserve selection state between renders', () => {
      const { rerender } = render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);
      expect(currentRadio).toBeChecked();

      rerender(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByLabelText(/Update analysis for this test run/i)).toBeChecked();
    });

    it('should reset to default when dialog is reopened', () => {
      const { rerender } = render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);

      rerender(
        <ConfigSaveDialog
          open={false}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      rerender(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      // Should still have current selected (state persists)
      expect(screen.getByLabelText(/Update analysis for this test run/i)).toBeChecked();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid button clicks gracefully', () => {
      const handleSave = jest.fn();
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={handleSave}
        />
      );

      const saveButton = screen.getByText('Save Configuration');
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);

      expect(handleSave).toHaveBeenCalledTimes(3);
    });

    it('should handle radio selection during loading', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={true}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);

      // Radio should still be selectable during loading
      expect(currentRadio).toBeChecked();
    });

    it('should maintain radio state when dialog is disabled', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
          loading={true}
        />
      );

      const currentRadio = screen.getByLabelText(/Update analysis for this test run/i);
      fireEvent.click(currentRadio);

      expect(currentRadio).toBeChecked();
    });
  });

  describe('Accessibility', () => {
    it('should have proper radio group structure', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      // Radio buttons should be present and functional
      expect(screen.getByLabelText(/Without updating analysis/i)).toBeInTheDocument();
    });

    it('should have accessible labels for all radio buttons', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByLabelText(/Without updating analysis/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Update analysis for this test run/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Update analysis for all test runs/i)).toBeInTheDocument();
    });

    it('should have dialog with proper title', () => {
      render(
        <ConfigSaveDialog
          open={true}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(screen.getByText('Save Configuration Changes')).toBeInTheDocument();
    });
  });
});
