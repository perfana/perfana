/**
 * Unit tests for StatusBadge Component
 *
 * Tests the status badge functionality:
 * - Rendering different status types
 * - Custom labels
 * - Size variants
 * - Tooltip display
 * - Icon rendering and animations
 * - Color theming
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatusBadge from '@/app/test-runs/[id]/components/shared/StatusBadge';

describe('StatusBadge', () => {
  describe('Status Types', () => {
    it('should render success status with default label', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });

    it('should render failure status with default label', () => {
      render(<StatusBadge status="failure" />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('should render warning status with default label', () => {
      render(<StatusBadge status="warning" />);
      expect(screen.getByText('Warning')).toBeInTheDocument();
    });

    it('should render running status with default label', () => {
      render(<StatusBadge status="running" />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('should render neutral status with default label', () => {
      render(<StatusBadge status="neutral" />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  describe('Custom Labels', () => {
    it('should render custom label for success status', () => {
      render(<StatusBadge status="success" label="Test Passed" />);
      expect(screen.getByText('Test Passed')).toBeInTheDocument();
      expect(screen.queryByText('Passed')).not.toBeInTheDocument();
    });

    it('should render custom label for failure status', () => {
      render(<StatusBadge status="failure" label="Test Failed" />);
      expect(screen.getByText('Test Failed')).toBeInTheDocument();
    });

    it('should render custom label for warning status', () => {
      render(<StatusBadge status="warning" label="Check Required" />);
      expect(screen.getByText('Check Required')).toBeInTheDocument();
    });

    it('should render custom label for running status', () => {
      render(<StatusBadge status="running" label="In Progress" />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    it('should render small size badge', () => {
      const { container } = render(
        <StatusBadge status="success" size="small" />
      );
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveClass('MuiChip-sizeSmall');
    });

    it('should render medium size badge by default', () => {
      const { container } = render(
        <StatusBadge status="success" />
      );
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveClass('MuiChip-sizeMedium');
    });

    it('should render medium size badge explicitly', () => {
      const { container } = render(
        <StatusBadge status="success" size="medium" />
      );
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveClass('MuiChip-sizeMedium');
    });
  });

  describe('Icons', () => {
    it('should render CheckCircle icon for success status', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByTestId('CheckCircleIcon')).toBeInTheDocument();
    });

    it('should render Error icon for failure status', () => {
      render(<StatusBadge status="failure" />);
      expect(screen.getByTestId('ErrorIcon')).toBeInTheDocument();
    });

    it('should render Warning icon for warning status', () => {
      render(<StatusBadge status="warning" />);
      expect(screen.getByTestId('WarningIcon')).toBeInTheDocument();
    });

    it('should render Autorenew icon for running status', () => {
      render(<StatusBadge status="running" />);
      expect(screen.getByTestId('AutorenewIcon')).toBeInTheDocument();
    });

    it('should render Schedule icon for neutral status', () => {
      render(<StatusBadge status="neutral" />);
      expect(screen.getByTestId('ScheduleIcon')).toBeInTheDocument();
    });
  });

  describe('Tooltip', () => {
    it('should render tooltip with default label via aria-label', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByLabelText('Status: Passed')).toBeInTheDocument();
    });

    it('should render tooltip with custom label via aria-label', () => {
      render(<StatusBadge status="success" label="All Tests Passed" />);
      expect(screen.getByLabelText('Status: All Tests Passed')).toBeInTheDocument();
    });

    it('should not render tooltip when showTooltip is false', () => {
      render(<StatusBadge status="success" showTooltip={false} />);
      expect(screen.queryByLabelText('Status: Passed')).not.toBeInTheDocument();
      // Should still render the label
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });

    it('should render tooltip by default via aria-label', () => {
      render(<StatusBadge status="failure" />);
      expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();
    });

    it('should render tooltip for all status types via aria-label', () => {
      const { rerender } = render(<StatusBadge status="success" />);
      expect(screen.getByLabelText('Status: Passed')).toBeInTheDocument();

      rerender(<StatusBadge status="failure" />);
      expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();

      rerender(<StatusBadge status="warning" />);
      expect(screen.getByLabelText('Status: Warning')).toBeInTheDocument();

      rerender(<StatusBadge status="running" />);
      expect(screen.getByLabelText('Status: Running')).toBeInTheDocument();

      rerender(<StatusBadge status="neutral" />);
      expect(screen.getByLabelText('Status: Pending')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply success color theme', () => {
      const { container } = render(<StatusBadge status="success" />);
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
      });
    });

    it('should apply failure color theme', () => {
      const { container } = render(<StatusBadge status="failure" />);
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({
        backgroundColor: 'rgba(244, 67, 54, 0.1)',
      });
    });

    it('should apply warning color theme', () => {
      const { container } = render(<StatusBadge status="warning" />);
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
      });
    });

    it('should apply running color theme', () => {
      const { container } = render(<StatusBadge status="running" />);
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({
        backgroundColor: 'rgba(33, 150, 243, 0.1)',
      });
    });

    it('should apply neutral color theme', () => {
      const { container } = render(<StatusBadge status="neutral" />);
      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({
        backgroundColor: 'rgba(158, 158, 158, 0.1)',
      });
    });
  });

  describe('Accessibility', () => {
    it('should render as a chip component', () => {
      const { container } = render(<StatusBadge status="success" />);
      expect(container.querySelector('.MuiChip-root')).toBeInTheDocument();
    });

    it('should have proper ARIA structure with tooltip', () => {
      render(<StatusBadge status="success" label="Test Status" />);
      // Tooltip should be accessible via aria-label
      expect(screen.getByLabelText('Status: Test Status')).toBeInTheDocument();
    });

    it('should be accessible without tooltip', () => {
      render(<StatusBadge status="success" showTooltip={false} />);
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle all status types with custom labels and sizes', () => {
      const { rerender } = render(
        <StatusBadge status="success" label="Custom" size="small" />
      );
      expect(screen.getByText('Custom')).toBeInTheDocument();

      rerender(<StatusBadge status="failure" label="Error" size="medium" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('should maintain consistency across re-renders', () => {
      const { rerender } = render(<StatusBadge status="success" />);
      expect(screen.getByText('Passed')).toBeInTheDocument();

      rerender(<StatusBadge status="success" />);
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });

    it('should handle rapid status changes', () => {
      const { rerender } = render(<StatusBadge status="neutral" />);
      expect(screen.getByText('Pending')).toBeInTheDocument();

      rerender(<StatusBadge status="running" />);
      expect(screen.getByText('Running')).toBeInTheDocument();

      rerender(<StatusBadge status="success" />);
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });
  });

  describe('Component Composition', () => {
    it('should render multiple badges independently', () => {
      render(
        <div>
          <StatusBadge status="success" />
          <StatusBadge status="failure" />
          <StatusBadge status="warning" />
        </div>
      );

      expect(screen.getByText('Passed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Warning')).toBeInTheDocument();
    });

    it('should handle different sizes in the same view', () => {
      const { container } = render(
        <div>
          <StatusBadge status="success" size="small" />
          <StatusBadge status="failure" size="medium" />
        </div>
      );

      const chips = container.querySelectorAll('.MuiChip-root');
      expect(chips).toHaveLength(2);
    });
  });
});
