import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AbortTestRunButton } from '@/app/test-runs/components/AbortTestRunButton';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

jest.mock('keycloak-js', () => jest.fn(() => ({
  init: jest.fn().mockResolvedValue(true),
  token: 'mock-token',
  refreshToken: 'mock-refresh-token',
  authenticated: true,
  updateToken: jest.fn().mockResolvedValue(true),
})));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.Mock;

function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'tr-uuid-1',
    test_run_id: 'run-001',
    completed: false,
    abort: false,
    ...overrides,
  } as TestRun;
}

describe('AbortTestRunButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  describe('visibility guard', () => {
    it('renders null when test run is completed', () => {
      const { container } = render(
        <AbortTestRunButton testRun={makeTestRun({ completed: true })} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders null when test run is already aborted', () => {
      const { container } = render(
        <AbortTestRunButton testRun={makeTestRun({ abort: true })} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when test run is running (not completed and not aborted)', () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('icon variant (default)', () => {
    it('renders an icon button with abort aria-label', () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      expect(screen.getByRole('button', { name: 'abort test run' })).toBeInTheDocument();
    });

    it('stops propagation on click', () => {
      const parentClick = jest.fn();
      render(
        <div onClick={parentClick}>
          <AbortTestRunButton testRun={makeTestRun()} />
        </div>
      );
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe('button variant', () => {
    it('renders an outlined button with text "Abort"', () => {
      render(<AbortTestRunButton testRun={makeTestRun()} variant="button" />);
      expect(screen.getByRole('button', { name: /abort/i })).toBeInTheDocument();
    });
  });

  describe('confirm dialog', () => {
    it('opens confirm dialog on click', () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      expect(screen.getByText('Abort Test Run')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to abort "run-001"/)).toBeInTheDocument();
    });

    it('closes dialog on Cancel without calling API', async () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByText('Abort Test Run')).not.toBeInTheDocument();
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('abort action', () => {
    it('calls PATCH /test-runs/:id/abort on confirm', async () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      fireEvent.click(screen.getAllByRole('button', { name: /abort/i }).find(b => b.closest('[role="dialog"]'))!);
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/test-runs/tr-uuid-1/abort', { method: 'PATCH' });
      });
    });

    it('calls onAborted and showToast on success', async () => {
      const onAborted = jest.fn();
      const showToast = jest.fn();
      render(
        <AbortTestRunButton testRun={makeTestRun()} onAborted={onAborted} showToast={showToast} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      fireEvent.click(screen.getAllByRole('button', { name: /abort/i }).find(b => b.closest('[role="dialog"]'))!);
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Test run aborted successfully');
        expect(onAborted).toHaveBeenCalled();
      });
    });

    it('shows error toast and does not call onAborted on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Test run is already completed' }),
      });
      const onAborted = jest.fn();
      const showToast = jest.fn();
      render(
        <AbortTestRunButton testRun={makeTestRun()} onAborted={onAborted} showToast={showToast} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      fireEvent.click(screen.getAllByRole('button', { name: /abort/i }).find(b => b.closest('[role="dialog"]'))!);
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('Test run is already completed');
        expect(onAborted).not.toHaveBeenCalled();
      });
    });

    it('works without optional callbacks (no crash)', async () => {
      render(<AbortTestRunButton testRun={makeTestRun()} />);
      fireEvent.click(screen.getByRole('button', { name: 'abort test run' }));
      fireEvent.click(screen.getAllByRole('button', { name: /abort/i }).find(b => b.closest('[role="dialog"]'))!);
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });
});
