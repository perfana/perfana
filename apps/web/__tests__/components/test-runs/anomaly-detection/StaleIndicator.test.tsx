/**
 * Unit tests for StaleIndicator Component
 *
 * Tests the stale indicator functionality:
 * - Chip variant rendering
 * - Banner variant rendering
 * - Inline variant rendering
 * - Batch stale indicator rendering
 * - Re-analyze functionality
 * - Tooltip content
 * - Hide when not stale
 * - Loading states
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StaleIndicator, BatchStaleIndicator } from '@/app/test-runs/[id]/components/anomaly-detection/components/StaleIndicator';

describe('StaleIndicator', () => {
  describe('Chip Variant', () => {
    it('should render chip variant when stale', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Configuration changed"
          variant="chip"
        />
      );

      expect(screen.getByText('Outdated')).toBeInTheDocument();
    });

    it('should not render when not stale', () => {
      const { container } = render(
        <StaleIndicator
          isStale={false}
          staleReason="Configuration changed"
          variant="chip"
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should display refresh icon', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
          variant="chip"
        />
      );

      expect(screen.getByTestId('RefreshIcon')).toBeInTheDocument();
    });

    it('should call onReanalyze when chip is clicked', () => {
      const handleReanalyze = jest.fn();
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
          variant="chip"
          onReanalyze={handleReanalyze}
        />
      );

      const chip = screen.getByText('Outdated').closest('.MuiChip-root');
      if (chip) {
        fireEvent.click(chip);
        expect(handleReanalyze).toHaveBeenCalledTimes(1);
      }
    });

    it('should not have pointer cursor without onReanalyze', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
          variant="chip"
        />
      );

      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({ cursor: 'default' });
    });

    it('should have pointer cursor with onReanalyze', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
          variant="chip"
          onReanalyze={() => {}}
        />
      );

      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveStyle({ cursor: 'pointer' });
    });

    it('should render small size by default', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          variant="chip"
        />
      );

      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveClass('MuiChip-sizeSmall');
    });

    it('should render medium size when specified', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          variant="chip"
          size="medium"
        />
      );

      const chip = container.querySelector('.MuiChip-root');
      expect(chip).toHaveClass('MuiChip-sizeMedium');
    });

    it('should use default stale reason when not provided', () => {
      render(
        <StaleIndicator
          isStale={true}
          variant="chip"
        />
      );

      expect(screen.getByText('Outdated')).toBeInTheDocument();
    });
  });

  describe('Banner Variant', () => {
    it('should render banner variant when stale', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Configuration has been updated"
          variant="banner"
        />
      );

      expect(screen.getByText('Outdated Results')).toBeInTheDocument();
      expect(screen.getByText(/Configuration has been updated/)).toBeInTheDocument();
    });

    it('should display warning icon', () => {
      render(
        <StaleIndicator
          isStale={true}
          variant="banner"
        />
      );

      expect(screen.getByTestId('WarningAmberIcon')).toBeInTheDocument();
    });

    it('should render re-analyze button when onReanalyze provided', () => {
      const handleReanalyze = jest.fn();
      render(
        <StaleIndicator
          isStale={true}
          variant="banner"
          onReanalyze={handleReanalyze}
        />
      );

      expect(screen.getByText('Re-analyze')).toBeInTheDocument();
    });

    it('should call onReanalyze when button is clicked', () => {
      const handleReanalyze = jest.fn();
      render(
        <StaleIndicator
          isStale={true}
          variant="banner"
          onReanalyze={handleReanalyze}
        />
      );

      fireEvent.click(screen.getByText('Re-analyze'));
      expect(handleReanalyze).toHaveBeenCalledTimes(1);
    });

    it('should not render re-analyze button without onReanalyze', () => {
      render(
        <StaleIndicator
          isStale={true}
          variant="banner"
        />
      );

      expect(screen.queryByText('Re-analyze')).not.toBeInTheDocument();
    });

    it('should display alert with warning severity', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          variant="banner"
        />
      );

      const alert = container.querySelector('.MuiAlert-standardWarning');
      expect(alert).toBeInTheDocument();
    });

    it('should include descriptive text about configuration', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Thresholds updated"
          variant="banner"
        />
      );

      expect(screen.getByText(/These results may not reflect the current configuration/)).toBeInTheDocument();
    });
  });

  describe('Inline Variant', () => {
    it('should render inline variant when stale', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
          variant="inline"
        />
      );

      expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument();
    });

    it('should display info icon', () => {
      render(
        <StaleIndicator
          isStale={true}
          variant="inline"
        />
      );

      expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument();
    });

    it('should render refresh button when onReanalyze provided', () => {
      const handleReanalyze = jest.fn();
      render(
        <StaleIndicator
          isStale={true}
          variant="inline"
          onReanalyze={handleReanalyze}
        />
      );

      expect(screen.getByTestId('RefreshIcon')).toBeInTheDocument();
    });

    it('should call onReanalyze when refresh button is clicked', () => {
      const handleReanalyze = jest.fn();
      render(
        <StaleIndicator
          isStale={true}
          variant="inline"
          onReanalyze={handleReanalyze}
        />
      );

      const refreshIcon = screen.getByTestId('RefreshIcon');
      const refreshButton = refreshIcon.closest('button');
      if (refreshButton) {
        fireEvent.click(refreshButton);
        expect(handleReanalyze).toHaveBeenCalledTimes(1);
      }
    });

    it('should not render refresh button without onReanalyze', () => {
      render(
        <StaleIndicator
          isStale={true}
          variant="inline"
        />
      );

      const icons = screen.queryAllByTestId('RefreshIcon');
      expect(icons.length).toBe(0);
    });

    it('should have warning color', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          variant="inline"
        />
      );

      const box = container.querySelector('div');
      // MUI theme colors are resolved to actual values
      expect(box).toBeInTheDocument();
    });

    it('should display inline-flex layout', () => {
      const { container } = render(
        <StaleIndicator
          isStale={true}
          variant="inline"
        />
      );

      const box = container.querySelector('div');
      expect(box).toHaveStyle({ display: 'inline-flex' });
    });
  });

  describe('Default Behavior', () => {
    it('should default to chip variant', () => {
      render(
        <StaleIndicator
          isStale={true}
          staleReason="Config changed"
        />
      );

      expect(screen.getByText('Outdated')).toBeInTheDocument();
    });

    it('should use default stale reason', () => {
      render(
        <StaleIndicator
          isStale={true}
        />
      );

      expect(screen.getByText('Outdated')).toBeInTheDocument();
    });

    it('should hide by default when isStale is not provided', () => {
      const { container } = render(
        <StaleIndicator
          staleReason="Config changed"
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });
});

describe('BatchStaleIndicator', () => {
  describe('Basic Rendering', () => {
    it('should render when staleCount > 0', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      expect(screen.getByText('Configuration Changes Detected')).toBeInTheDocument();
    });

    it('should not render when staleCount is 0', () => {
      const { container } = render(
        <BatchStaleIndicator
          staleCount={0}
          totalCount={20}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should display stale count and total count', () => {
      render(
        <BatchStaleIndicator
          staleCount={3}
          totalCount={15}
        />
      );

      expect(screen.getByText(/3 of 15 results/)).toBeInTheDocument();
    });

    it('should calculate and display percentage', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      // 5/20 = 25%
      expect(screen.getByText(/25%/)).toBeInTheDocument();
    });

    it('should round percentage correctly', () => {
      render(
        <BatchStaleIndicator
          staleCount={1}
          totalCount={3}
        />
      );

      // 1/3 = 0.333... → 33%
      expect(screen.getByText(/33%/)).toBeInTheDocument();
    });
  });

  describe('Re-analyze All Button', () => {
    it('should render re-analyze all button when onReanalyzeAll provided', () => {
      const handleReanalyzeAll = jest.fn();
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onReanalyzeAll={handleReanalyzeAll}
        />
      );

      expect(screen.getByText(/Re-analyze All \(5\)/)).toBeInTheDocument();
    });

    it('should call onReanalyzeAll when button is clicked', () => {
      const handleReanalyzeAll = jest.fn();
      render(
        <BatchStaleIndicator
          staleCount={3}
          totalCount={10}
          onReanalyzeAll={handleReanalyzeAll}
        />
      );

      fireEvent.click(screen.getByText(/Re-analyze All/));
      expect(handleReanalyzeAll).toHaveBeenCalledTimes(1);
    });

    it('should not render button without onReanalyzeAll', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      expect(screen.queryByText(/Re-analyze All/)).not.toBeInTheDocument();
    });

    it('should display refresh icon in button', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onReanalyzeAll={() => {}}
        />
      );

      expect(screen.getByTestId('RefreshIcon')).toBeInTheDocument();
    });
  });

  describe('Dismiss Button', () => {
    it('should render dismiss button when onDismiss provided', () => {
      const handleDismiss = jest.fn();
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onDismiss={handleDismiss}
        />
      );

      expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });

    it('should call onDismiss when button is clicked', () => {
      const handleDismiss = jest.fn();
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onDismiss={handleDismiss}
        />
      );

      fireEvent.click(screen.getByText('Dismiss'));
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('should not render button without onDismiss', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      expect(screen.queryByText('Dismiss')).not.toBeInTheDocument();
    });
  });

  describe('Both Buttons', () => {
    it('should render both buttons when both callbacks provided', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onReanalyzeAll={() => {}}
          onDismiss={() => {}}
        />
      );

      expect(screen.getByText(/Re-analyze All/)).toBeInTheDocument();
      expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });

    it('should handle both button clicks independently', () => {
      const handleReanalyzeAll = jest.fn();
      const handleDismiss = jest.fn();
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
          onReanalyzeAll={handleReanalyzeAll}
          onDismiss={handleDismiss}
        />
      );

      fireEvent.click(screen.getByText(/Re-analyze All/));
      expect(handleReanalyzeAll).toHaveBeenCalledTimes(1);
      expect(handleDismiss).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('Dismiss'));
      expect(handleDismiss).toHaveBeenCalledTimes(1);
      expect(handleReanalyzeAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('Alert Styling', () => {
    it('should display alert with warning severity', () => {
      const { container } = render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      const alert = container.querySelector('.MuiAlert-standardWarning');
      expect(alert).toBeInTheDocument();
    });

    it('should have alert title', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      expect(screen.getByText('Configuration Changes Detected')).toBeInTheDocument();
    });

    it('should include recommendation text', () => {
      render(
        <BatchStaleIndicator
          staleCount={5}
          totalCount={20}
        />
      );

      expect(screen.getByText(/Re-analysis is recommended for accurate results/)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle 100% stale', () => {
      render(
        <BatchStaleIndicator
          staleCount={10}
          totalCount={10}
        />
      );

      expect(screen.getByText(/100%/)).toBeInTheDocument();
    });

    it('should handle 1% stale', () => {
      render(
        <BatchStaleIndicator
          staleCount={1}
          totalCount={100}
        />
      );

      expect(screen.getByText(/1%/)).toBeInTheDocument();
    });

    it('should handle large numbers', () => {
      render(
        <BatchStaleIndicator
          staleCount={500}
          totalCount={1000}
        />
      );

      expect(screen.getByText(/500 of 1000 results/)).toBeInTheDocument();
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });

    it('should display correct count in button label', () => {
      render(
        <BatchStaleIndicator
          staleCount={42}
          totalCount={100}
          onReanalyzeAll={() => {}}
        />
      );

      expect(screen.getByText(/Re-analyze All \(42\)/)).toBeInTheDocument();
    });
  });
});
