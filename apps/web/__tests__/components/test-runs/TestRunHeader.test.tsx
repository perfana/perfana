/**
 * Unit tests for TestRunHeader Component
 *
 * Tests the header component functionality:
 * - Rendering with test run data
 * - Breadcrumb navigation back to the (filtered) test runs list
 * - Previous/Next test run navigation
 * - Navigation button disabled states
 * - Tooltips for navigation buttons
 * - URL construction with query parameters
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import TestRunHeader from '@/app/test-runs/[id]/components/header/TestRunHeader';
import { TestRun } from '@/types/test-runs';

// Mock keycloak-js to avoid ESM import issues
jest.mock('keycloak-js', () => {
  return jest.fn(() => ({
    init: jest.fn().mockResolvedValue(true),
    login: jest.fn(),
    logout: jest.fn(),
    updateToken: jest.fn().mockResolvedValue(true),
    hasRealmRole: jest.fn().mockReturnValue(false),
    createAccountUrl: jest.fn().mockReturnValue(''),
    token: 'mock-token',
    refreshToken: 'mock-refresh-token',
    authenticated: true,
    subject: 'user-123',
    tokenParsed: { sub: 'user-123', email: 'test@example.com' },
  }));
});

// Mock authenticatedFetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

describe('TestRunHeader', () => {
  const mockPush = jest.fn();
  const mockBackHref = '/test-runs?system=my-system&environment=production&workload=load-test-1';

  const mockTestRun: TestRun = {
    id: 'test-uuid-123',
    test_run_id: 'test-run-001',
    test_environment: 'production',
    workload: 'load-test-1',
    system_under_test_id: 'system-123',
    systems_under_test: {
      id: 'system-123',
      name: 'my-system',
      domain: 'example.com',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    start_time: '2024-01-01T10:00:00Z',
    end_time: '2024-01-01T11:00:00Z',
    created_at: '2024-01-01T09:55:00Z',
    updated_at: '2024-01-01T11:05:00Z',
    completed: true,
    tags: [],
    annotations: [],
  };

  const mockPreviousTestRun = {
    test_run_id: 'test-run-000',
    created_at: '2023-12-31T10:00:00Z',
  };

  const mockNextTestRun = {
    test_run_id: 'test-run-002',
    created_at: '2024-01-02T10:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
  });

  describe('Rendering', () => {
    it('should render the breadcrumb with the test run id', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      expect(screen.getByText('test-run-001')).toBeInTheDocument();
    });

    it('should render navigation buttons', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
          previousTestRun={mockPreviousTestRun}
          nextTestRun={mockNextTestRun}
        />
      );

      // Navigation buttons are IconButtons without explicit names
      const buttons = screen.getAllByRole('button');
      // Should have: Previous button + Next button
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Back Navigation', () => {
    it('should render a Test Runs breadcrumb link with the provided href', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      const backLink = screen.getByRole('link', { name: 'Test Runs' });
      expect(backLink).toHaveAttribute('href', mockBackHref);
    });
  });

  describe('Previous/Next Navigation', () => {
    it('should enable previous button when previousTestRun is provided', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
          previousTestRun={mockPreviousTestRun}
        />
      );

      // Find the button within the labeled span
      const previousButtonWrapper = screen.getByLabelText(/previous test run: test-run-000/i);
      const previousButton = previousButtonWrapper.querySelector('button');
      expect(previousButton).toBeInTheDocument();
      expect(previousButton).not.toBeDisabled();
    });

    it('should enable next button when nextTestRun is provided', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
          nextTestRun={mockNextTestRun}
        />
      );

      // Find the button within the labeled span
      const nextButtonWrapper = screen.getByLabelText(/next test run: test-run-002/i);
      const nextButton = nextButtonWrapper.querySelector('button');
      expect(nextButton).toBeInTheDocument();
      expect(nextButton).not.toBeDisabled();
    });

    it('should show disabled state tooltip when no previous test run', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      const noPreviousButtonWrapper = screen.getByLabelText(/no previous test run/i);
      const noPreviousButton = noPreviousButtonWrapper.querySelector('button');
      expect(noPreviousButton).toBeInTheDocument();
      expect(noPreviousButton).toBeDisabled();
    });

    it('should show disabled state tooltip when no next test run', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      const noNextButtonWrapper = screen.getByLabelText(/no next test run/i);
      const noNextButton = noNextButtonWrapper.querySelector('button');
      expect(noNextButton).toBeInTheDocument();
      expect(noNextButton).toBeDisabled();
    });

    it('should navigate to previous test run with full query parameters', async () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
          previousTestRun={mockPreviousTestRun}
        />
      );

      const previousButtonWrapper = screen.getByLabelText(/previous test run: test-run-000/i);
      const previousButton = previousButtonWrapper.querySelector('button')!;
      fireEvent.click(previousButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('test-run-000')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('system=my-system')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('environment=production')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('workload=load-test-1')
        );
      });
    });

    it('should navigate to next test run with full query parameters', async () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
          nextTestRun={mockNextTestRun}
        />
      );

      const nextButtonWrapper = screen.getByLabelText(/next test run: test-run-002/i);
      const nextButton = nextButtonWrapper.querySelector('button')!;
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('test-run-002')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('system=my-system')
        );
      });
    });

    it('should navigate with UUID only when system data is incomplete', async () => {
      const incompleteTestRun: TestRun = {
        ...mockTestRun,
        systems_under_test: undefined,
        test_environment: '',
        workload: '',
      };

      render(
        <TestRunHeader
          testRun={incompleteTestRun}
          backHref={mockBackHref}
          previousTestRun={mockPreviousTestRun}
        />
      );

      const previousButtonWrapper = screen.getByLabelText(/previous test run: test-run-000/i);
      const previousButton = previousButtonWrapper.querySelector('button')!;
      fireEvent.click(previousButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/test-runs/test-run-000');
        // Should not include query parameters
        expect(mockPush).not.toHaveBeenCalledWith(
          expect.stringContaining('system=')
        );
      });
    });

    it('should not navigate when previousTestRun is undefined', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      const disabledButtonWrapper = screen.getByLabelText(/no previous test run/i);
      const disabledButton = disabledButtonWrapper.querySelector('button');
      expect(disabledButton).toBeDisabled();
    });

    it('should not navigate when nextTestRun is undefined', () => {
      render(
        <TestRunHeader
          testRun={mockTestRun}
          backHref={mockBackHref}
        />
      );

      const disabledButtonWrapper = screen.getByLabelText(/no next test run/i);
      const disabledButton = disabledButtonWrapper.querySelector('button');
      expect(disabledButton).toBeDisabled();
    });
  });

  describe('Null TestRun Handling', () => {
    it('should handle null testRun gracefully', () => {
      render(
        <TestRunHeader
          testRun={null}
          backHref={mockBackHref}
        />
      );

      expect(screen.getByText('Test Run Details')).toBeInTheDocument();
    });

    it('should not navigate when testRun is null', () => {
      render(
        <TestRunHeader
          testRun={null}
          backHref={mockBackHref}
          previousTestRun={mockPreviousTestRun}
        />
      );

      const previousButtonWrapper = screen.getByLabelText(/previous test run: test-run-000/i);
      const previousButton = previousButtonWrapper.querySelector('button')!;
      fireEvent.click(previousButton);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
