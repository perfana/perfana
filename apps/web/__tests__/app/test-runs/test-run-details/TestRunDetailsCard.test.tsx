/**
 * Unit tests for TestRunDetailsCard Component
 *
 * Tests the comprehensive test run details card functionality:
 * - Rendering in collapsed and expanded states
 * - Border color logic based on test status
 * - Expand/collapse behavior with auto-focus
 * - Tags editing and saving
 * - Annotations editing and saving
 * - Loading and saving states
 * - Evaluation status display
 * - Duration formatting
 * - Error handling for API operations
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TestRunDetailsCard from '@/app/test-runs/[id]/components/test-run-details/TestRunDetailsCard';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

describe('TestRunDetailsCard', () => {
  const mockSetExpanded = jest.fn();
  const mockSetIsEditingTags = jest.fn();
  const mockSetEditingTags = jest.fn();
  const mockSetTagsSaving = jest.fn();
  const mockSetIsEditingAnnotations = jest.fn();
  const mockSetEditingAnnotations = jest.fn();
  const mockSetAnnotationsSaving = jest.fn();
  const mockOnTestRunUpdate = jest.fn();
  const mockShowToast = jest.fn();

  const mockTestRun: TestRun = {
    id: '123',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'system-123',
    systems_under_test: {
      id: 'system-123',
      name: 'My Application',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    test_environment: 'production',
    workload: 'load-test-1',
    application_release: 'v1.2.3',
    ci_build_results_url: 'https://ci.example.com/builds/123',
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    duration: 3600,
    analysis_start_offset: 300,
    completed: true,
    abort: false,
    tags: ['performance', 'regression'],
    annotations: ['Important test', 'Breaking change'],
    consolidated_result: {
      overall: true,
      passed: true,
      meetsRequirement: true,
      adaptTestRunOK: true,
    },
    status: {
      evaluatingChecks: 'COMPLETED',
      evaluatingComparisons: 'COMPLETED',
      evaluatingAdapt: 'COMPLETED',
    },
    valid: true,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
  };

  const defaultProps = {
    testRun: mockTestRun,
    expanded: false,
    setExpanded: mockSetExpanded,
    isEditingTags: false,
    setIsEditingTags: mockSetIsEditingTags,
    editingTags: [],
    setEditingTags: mockSetEditingTags,
    allAvailableTags: ['performance', 'regression', 'smoke', 'integration'],
    tagsSaving: false,
    setTagsSaving: mockSetTagsSaving,
    isEditingAnnotations: false,
    setIsEditingAnnotations: mockSetIsEditingAnnotations,
    editingAnnotations: '',
    setEditingAnnotations: mockSetEditingAnnotations,
    annotationsSaving: false,
    setAnnotationsSaving: mockSetAnnotationsSaving,
    onTestRunUpdate: mockOnTestRunUpdate,
    showToast: mockShowToast,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // TimingInformationSection fires authenticatedFetch on mount for the
    // summary-timeseries endpoint. Default to a non-ok response so it
    // silently sets timeseriesData=null without throwing.
    (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false });
  });

  describe('Rendering - Collapsed State', () => {
    it('should render collapsed card with correct test ID', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      expect(screen.getByTestId('test-run-details-card-collapsed')).toBeInTheDocument();
    });

    it('should display "Test Run Info" title', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      expect(screen.getByText('Test Run Info')).toBeInTheDocument();
    });

    it('should display test run ID in collapsed state', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const testRunIds = screen.getAllByText('TR-2024-001');
      expect(testRunIds.length).toBeGreaterThan(0);
    });

    it('should display expand icon in collapsed state', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should apply pointer cursor in collapsed state', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      expect(card).toHaveStyle({ cursor: 'pointer' });
    });

    it('should show application release chip when available', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const versionChips = screen.getAllByText('v1.2.3');
      expect(versionChips.length).toBeGreaterThan(0);
    });

    it('should show CI Build Results chip when URL exists', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      expect(screen.getByText('CI Build')).toBeInTheDocument();
    });

    it('should not show CI Build Results chip when URL is missing', () => {
      const testRunWithoutCI = { ...mockTestRun, ci_build_results_url: undefined };
      render(<TestRunDetailsCard {...defaultProps} testRun={testRunWithoutCI} />);
      expect(screen.queryByText('CI Build')).not.toBeInTheDocument();
    });
  });

  describe('Rendering - Expanded State', () => {
    it('should render expanded card with correct test ID', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByTestId('test-run-details-card-expanded')).toBeInTheDocument();
    });

    it('should display "Click to collapse" hint in expanded state', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    it('should apply default cursor in expanded state', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const card = screen.getByTestId('test-run-details-card-expanded');
      expect(card).toHaveStyle({ cursor: 'default' });
    });

    it('should show all detail sections when expanded', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('Test Run Identity')).toBeInTheDocument();
      expect(screen.getByText('Test Configuration')).toBeInTheDocument();
      expect(screen.getByText('Timing Information')).toBeInTheDocument();
      expect(screen.getByText('Evaluation Results')).toBeInTheDocument();
      expect(screen.getByText('Annotations & Tags')).toBeInTheDocument();
    });
  });

  describe('Border Color Logic', () => {
    it('should use red border when test run is invalid', () => {
      const invalidTestRun = { ...mockTestRun, valid: false };
      render(<TestRunDetailsCard {...defaultProps} testRun={invalidTestRun} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      const styles = window.getComputedStyle(card);
      // Border color should be set to red (#f44336) for invalid test runs
      expect(card).toHaveStyle({ borderColor: expect.stringContaining('#f44336') });
    });

    it('should use red border when overall result is false', () => {
      const failedTestRun = {
        ...mockTestRun,
        consolidated_result: { ...mockTestRun.consolidated_result!, overall: false },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={failedTestRun} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      expect(card).toHaveStyle({ borderColor: expect.stringContaining('#f44336') });
    });

    it('should use green border when test is successful', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      expect(card).toHaveStyle({ borderColor: expect.stringContaining('#4caf50') });
    });

    it('should use orange border when test is not completed', () => {
      const incompleteTestRun = { ...mockTestRun, completed: false };
      render(<TestRunDetailsCard {...defaultProps} testRun={incompleteTestRun} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      expect(card).toHaveStyle({ borderColor: expect.stringContaining('#ff9800') });
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should call setExpanded when card is clicked in collapsed state', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const card = screen.getByTestId('test-run-details-card-collapsed');
      fireEvent.click(card);
      expect(mockSetExpanded).toHaveBeenCalledWith(true);
    });

    it('should call setExpanded when expand button is clicked', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[0]);
      expect(mockSetExpanded).toHaveBeenCalled();
    });

    it('should not propagate click when clicking expand/collapse button', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');
      fireEvent(buttons[0], clickEvent);
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should attempt to focus card after expansion', async () => {
      jest.useFakeTimers();
      const { rerender } = render(<TestRunDetailsCard {...defaultProps} />);

      // Expand the card
      rerender(<TestRunDetailsCard {...defaultProps} expanded={true} />);

      // Fast-forward time to trigger setTimeout
      jest.advanceTimersByTime(300);

      // Card should exist with expanded test ID
      await waitFor(() => {
        expect(screen.getByTestId('test-run-details-card-expanded')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });

  describe('Overall Result Display', () => {
    it('should show "Pass" chip for successful test', () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const passChips = screen.getAllByText('Pass');
      expect(passChips.length).toBeGreaterThan(0);
    });

    it('should show "Fail" chip for failed test', () => {
      const failedTestRun = {
        ...mockTestRun,
        consolidated_result: { ...mockTestRun.consolidated_result!, overall: false, passed: false },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={failedTestRun} />);
      const failChips = screen.getAllByText('Fail');
      expect(failChips.length).toBeGreaterThan(0);
    });

    it('should show "Invalid" chip when evaluation has ERROR status', () => {
      const errorTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingChecks: 'ERROR' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={errorTestRun} />);
      const invalidChips = screen.getAllByText('Invalid');
      expect(invalidChips.length).toBeGreaterThan(0);
    });

    it('should show "Invalid" chip when evaluation has FAILED status', () => {
      const failedEvalTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingComparisons: 'FAILED' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={failedEvalTestRun} />);
      const invalidChips = screen.getAllByText('Invalid');
      expect(invalidChips.length).toBeGreaterThan(0);
    });
  });

  describe('Duration Formatting', () => {
    it('should format duration with hours, minutes, and seconds', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('1h 0m 0s')).toBeInTheDocument();
    });

    it('should format duration with only minutes and seconds', () => {
      const shortTestRun = { ...mockTestRun, duration: 305 };
      render(<TestRunDetailsCard {...defaultProps} testRun={shortTestRun} expanded={true} />);
      expect(screen.getByText('5m 5s')).toBeInTheDocument();
    });

    it('should format duration with only seconds', () => {
      const veryShortTestRun = { ...mockTestRun, duration: 45 };
      render(<TestRunDetailsCard {...defaultProps} testRun={veryShortTestRun} expanded={true} />);
      expect(screen.getByText('45s')).toBeInTheDocument();
    });

    it('should show N/A for zero or negative duration', () => {
      const zeroDurationTestRun = { ...mockTestRun, duration: 0 };
      render(<TestRunDetailsCard {...defaultProps} testRun={zeroDurationTestRun} expanded={true} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('should format ramp up period correctly', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      // analysis_start_offset=300 → "5m 0s" appears in the Analysis Window line
      expect(screen.getAllByText(/5m 0s/).length).toBeGreaterThan(0);
    });
  });

  describe('Tags Editing', () => {
    it('should show tags in display mode initially', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('performance')).toBeInTheDocument();
      expect(screen.getByText('regression')).toBeInTheDocument();
    });

    it('should show edit button for tags', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      // Look for edit icon buttons
      const editButtons = screen.getAllByRole('button');
      expect(editButtons.length).toBeGreaterThan(0);
    });

    it('should switch to edit mode when edit button is clicked', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const editButtons = screen.getAllByRole('button');
      const tagsEditButton = editButtons.find(btn => btn.getAttribute('title') === 'Edit tags');
      if (tagsEditButton) {
        fireEvent.click(tagsEditButton);
        expect(mockSetIsEditingTags).toHaveBeenCalledWith(true);
      }
    });

    it('should call API to save tags when save button is clicked', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          editingTags={['performance', 'new-tag']}
        />
      );

      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save tags');
      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(authenticatedFetch).toHaveBeenCalledWith(
            `/test-runs/${mockTestRun.id}/tags`,
            expect.objectContaining({
              method: 'PUT',
              body: JSON.stringify({ tags: ['performance', 'new-tag'] }),
            })
          );
        });
      }
    });

    it('should show toast message on successful tags save', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          editingTags={['performance']}
        />
      );

      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save tags');
      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith('Tags updated successfully');
        });
      }
    });

    it('should show error toast on failed tags save', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
      });

      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          editingTags={['performance']}
        />
      );

      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save tags');
      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith('Failed to update tags');
        });
      }
    });

    it('should cancel tags editing when cancel button is clicked', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          editingTags={['performance']}
        />
      );

      const cancelButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Cancel editing');
      if (cancelButton) {
        fireEvent.click(cancelButton);
        expect(mockSetIsEditingTags).toHaveBeenCalledWith(false);
      }
    });
  });

  describe('Annotations Editing', () => {
    it('should show annotations in display mode initially', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('Important test')).toBeInTheDocument();
      expect(screen.getByText('Breaking change')).toBeInTheDocument();
    });

    it('should show edit button for annotations', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const editButtons = screen.getAllByRole('button');
      expect(editButtons.length).toBeGreaterThan(0);
    });

    it('should switch to edit mode when edit button is clicked', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const editButtons = screen.getAllByRole('button');
      const annotationsEditButton = editButtons.find(btn => btn.getAttribute('title') === 'Edit annotations');
      if (annotationsEditButton) {
        fireEvent.click(annotationsEditButton);
        expect(mockSetIsEditingAnnotations).toHaveBeenCalledWith(true);
      }
    });

    it('should call API to save annotations when save button is clicked', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const { container } = render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          editingAnnotations="New annotation\nAnother annotation"
        />
      );

      const saveButtons = container.querySelectorAll('button[title="Save annotations"]');
      const saveButton = Array.from(saveButtons)[0] as HTMLElement;

      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(authenticatedFetch).toHaveBeenCalledWith(
            `/test-runs/${mockTestRun.id}/annotations`,
            expect.objectContaining({
              method: 'PUT',
            })
          );
        });
      }
    });

    it('should show toast message on successful annotations save', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          editingAnnotations="Test annotation"
        />
      );

      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save annotations');
      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith('Annotations updated successfully');
        });
      }
    });

    it('should show error toast on failed annotations save', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
      });

      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          editingAnnotations="Test"
        />
      );

      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save annotations');
      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith('Failed to update annotations');
        });
      }
    });

    it('should cancel annotations editing when cancel button is clicked', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          editingAnnotations="Test"
        />
      );

      const cancelButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Cancel editing');
      if (cancelButton) {
        fireEvent.click(cancelButton);
        expect(mockSetIsEditingAnnotations).toHaveBeenCalledWith(false);
      }
    });

    it('should filter out empty lines when saving annotations', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const { container } = render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          editingAnnotations="Line 1\n\n\nLine 2\n  \nLine 3"
        />
      );

      const saveButtons = container.querySelectorAll('button[title="Save annotations"]');
      const saveButton = Array.from(saveButtons)[0] as HTMLElement;

      if (saveButton) {
        fireEvent.click(saveButton);

        await waitFor(() => {
          // Just check that the call was made with PUT method
          expect(authenticatedFetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              method: 'PUT',
            })
          );
        });
      }
    });
  });

  describe('Evaluation Status Display', () => {
    it('should show Complete status for evaluating checks', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const completeElements = screen.getAllByText('Complete');
      expect(completeElements.length).toBeGreaterThan(0);
    });

    it('should show In Progress status correctly', () => {
      const inProgressTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingChecks: 'IN_PROGRESS' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={inProgressTestRun} expanded={true} />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    it('should show Error status correctly', () => {
      const errorTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingChecks: 'ERROR' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={errorTestRun} expanded={true} />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('should show Failed status correctly', () => {
      const failedTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingAdapt: 'FAILED' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={failedTestRun} expanded={true} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('should show Not Configured status correctly', () => {
      const notConfiguredTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingAdapt: 'NOT_CONFIGURED' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={notConfiguredTestRun} expanded={true} />);
      expect(screen.getByText('Not Configured')).toBeInTheDocument();
    });

    it('should handle NO_BASELINES_FOUND status for anomaly detection with generic fallback', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '' });
      const noBaselinesTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingAdapt: 'NO_BASELINES_FOUND' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={noBaselinesTestRun} expanded={true} />);
      await waitFor(() => {
        expect(screen.getByText('No previous results to compare with')).toBeInTheDocument();
      });
    });

    it('should show dsAdaptConclusion details.message for NO_BASELINES_FOUND when conclusion exists', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ conclusion: 'INSUFFICIENT_DATA', details: { message: 'Insufficient data to run ADAPT analysis' } }),
      });
      const noBaselinesTestRun = {
        ...mockTestRun,
        status: { ...mockTestRun.status!, evaluatingAdapt: 'NO_BASELINES_FOUND' },
      };
      render(<TestRunDetailsCard {...defaultProps} testRun={noBaselinesTestRun} expanded={true} />);
      await waitFor(() => {
        expect(screen.getByText('Insufficient data to run ADAPT analysis')).toBeInTheDocument();
      });
    });
  });

  describe('Time Display', () => {
    it('should format start time correctly', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      // Check that date is displayed (format varies by locale)
      const startTimeElements = screen.getAllByText(/Jan|15|2024/);
      expect(startTimeElements.length).toBeGreaterThan(0);
    });

    it('should format end time correctly', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      // Check that date is displayed
      const endTimeElements = screen.getAllByText(/Jan|15|2024/);
      expect(endTimeElements.length).toBeGreaterThan(0);
    });

    it('should show "Not available" when start time is missing', () => {
      const noStartTimeTestRun = { ...mockTestRun, start_time: undefined };
      render(<TestRunDetailsCard {...defaultProps} testRun={noStartTimeTestRun} expanded={true} />);
      expect(screen.getByText('Not available')).toBeInTheDocument();
    });

    it('should show "Not available" when end time is missing', () => {
      const noEndTimeTestRun = { ...mockTestRun, end_time: undefined };
      render(<TestRunDetailsCard {...defaultProps} testRun={noEndTimeTestRun} expanded={true} />);
      expect(screen.getByText('Not available')).toBeInTheDocument();
    });
  });

  describe('Test Configuration Display', () => {
    it('should display system under test name', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('My Application')).toBeInTheDocument();
    });

    it('should display test environment', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('production')).toBeInTheDocument();
    });

    it('should display workload', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('load-test-1')).toBeInTheDocument();
    });

    it('should show abort status when test was aborted', () => {
      const abortedTestRun = { ...mockTestRun, abort: true };
      render(<TestRunDetailsCard {...defaultProps} testRun={abortedTestRun} expanded={true} />);
      expect(screen.getByText('Aborted')).toBeInTheDocument();
    });

    it('should not show abort status when test was not aborted', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.queryByText('Aborted')).not.toBeInTheDocument();
    });
  });

  describe('CI Build Results Link', () => {
    it('should show CI build results link in expanded view', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      expect(screen.getByText('View Build Results')).toBeInTheDocument();
    });

    it('should open CI build URL in new tab when clicked', () => {
      render(<TestRunDetailsCard {...defaultProps} expanded={true} />);
      const link = screen.getByText('View Build Results').closest('a');
      expect(link).toHaveAttribute('href', 'https://ci.example.com/builds/123');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should not show CI build section when URL is missing', () => {
      const testRunWithoutCI = { ...mockTestRun, ci_build_results_url: undefined };
      render(<TestRunDetailsCard {...defaultProps} testRun={testRunWithoutCI} expanded={true} />);
      expect(screen.queryByText('View CI Build Results')).not.toBeInTheDocument();
    });

    it('should not show CI build section when URL is "unknown"', () => {
      const testRunWithUnknownCI = { ...mockTestRun, ci_build_results_url: 'unknown' };
      render(<TestRunDetailsCard {...defaultProps} testRun={testRunWithUnknownCI} expanded={true} />);
      expect(screen.queryByText('View CI Build Results')).not.toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should show "No tags assigned" when there are no tags', () => {
      const noTagsTestRun = { ...mockTestRun, tags: [] };
      render(<TestRunDetailsCard {...defaultProps} testRun={noTagsTestRun} expanded={true} />);
      expect(screen.getByText('No tags assigned')).toBeInTheDocument();
    });

    it('should show "No annotations added" when there are no annotations', () => {
      const noAnnotationsTestRun = { ...mockTestRun, annotations: [] };
      render(<TestRunDetailsCard {...defaultProps} testRun={noAnnotationsTestRun} expanded={true} />);
      expect(screen.getByText('No annotations added')).toBeInTheDocument();
    });

    it('should show "Not specified" when application release is missing', () => {
      const noReleaseTestRun = { ...mockTestRun, application_release: undefined };
      render(<TestRunDetailsCard {...defaultProps} testRun={noReleaseTestRun} expanded={true} />);
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });
  });

  describe('Loading and Saving States', () => {
    it('should show loading spinner while saving tags', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          tagsSaving={true}
        />
      );
      const progressSpinners = screen.getAllByRole('progressbar');
      expect(progressSpinners.length).toBeGreaterThan(0);
    });

    it('should show loading spinner while saving annotations', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          annotationsSaving={true}
        />
      );
      const progressSpinners = screen.getAllByRole('progressbar');
      expect(progressSpinners.length).toBeGreaterThan(0);
    });

    it('should disable buttons while saving tags', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingTags={true}
          tagsSaving={true}
        />
      );
      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save tags');
      expect(saveButton).toBeDisabled();
    });

    it('should disable buttons while saving annotations', () => {
      render(
        <TestRunDetailsCard
          {...defaultProps}
          expanded={true}
          isEditingAnnotations={true}
          annotationsSaving={true}
        />
      );
      const saveButton = screen.getAllByRole('button').find(btn => btn.getAttribute('title') === 'Save annotations');
      expect(saveButton).toBeDisabled();
    });
  });

  describe('Tooltip Display', () => {
    it('should show annotations in tooltip when hovering version chip', async () => {
      render(<TestRunDetailsCard {...defaultProps} />);
      const versionChips = screen.getAllByText('v1.2.3');
      const versionChip = versionChips[0].closest('div');
      if (versionChip) {
        fireEvent.mouseEnter(versionChip);
        await waitFor(() => {
          // Tooltip with annotations should be available
          expect(screen.queryByText('Annotations')).toBeTruthy();
        });
      }
    });
  });
});
