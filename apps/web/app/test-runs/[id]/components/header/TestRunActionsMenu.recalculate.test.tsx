/**
 * Tests for "Recalculate statistics" on the test-run detail page (#552).
 *
 * The ADAPT "could not build a baseline" message tells the user to run this on the
 * *baseline* run, so they arrive on that run's detail page — this menu, not the list
 * page one, is where the remedy has to be reachable.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TestRunActionsMenu from './TestRunActionsMenu';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/hooks/useJobProgress', () => ({
  useJobProgress: () => ({
    isRunning: false,
    isBlocked: false,
    isStuck: false,
    blockingInfo: null,
    progress: null,
  }),
}));

const mockFetch = authenticatedFetch as jest.Mock;

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    test_run_id: 'PerfanaWebshop-acc-loadTest-00018',
    system_under_test_id: 'sut-1',
    test_environment: 'acc',
    workload: 'loadTest',
    completed: true,
    ...overrides,
  }) as TestRun;

const renderMenu = (testRun: TestRun = makeTestRun()) => {
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const onJobTriggered = jest.fn();
  render(
    <TestRunActionsMenu
      testRun={testRun}
      onSuccess={onSuccess}
      onError={onError}
      onJobTriggered={onJobTriggered}
    />,
  );
  return { onSuccess, onError, onJobTriggered };
};

const clickRecalculate = () => {
  fireEvent.click(screen.getAllByRole('button')[0]);
  fireEvent.click(screen.getByText('Recalculate statistics'));
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

it('POSTs to the recalculate endpoint and reports success', async () => {
  const { onSuccess, onError, onJobTriggered } = renderMenu();

  clickRecalculate();

  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/data/recalculate-statistics/PerfanaWebshop-acc-loadTest-00018',
      { method: 'POST' },
    ),
  );
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Statistics recalculation started'));
  // The header polls job progress off this callback.
  expect(onJobTriggered).toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it('reports an error and does not signal a job when the API refuses', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
  const { onSuccess, onError, onJobTriggered } = renderMenu();

  clickRecalculate();

  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith('Failed to start statistics recalculation'),
  );
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onJobTriggered).not.toHaveBeenCalled();
});

it('reports an error when the request never reaches the API', async () => {
  mockFetch.mockRejectedValue(new Error('Network down'));
  const { onError } = renderMenu();

  clickRecalculate();

  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith('Failed to start statistics recalculation'),
  );
});

it('re-enables the action after a failure so the user can retry', async () => {
  mockFetch.mockRejectedValue(new Error('Network down'));
  const { onError } = renderMenu();

  clickRecalculate();
  await waitFor(() => expect(onError).toHaveBeenCalled());

  // isLoading must be cleared in the finally block, or the menu item stays disabled forever.
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  fireEvent.click(screen.getAllByRole('button')[0]);
  const item = screen.getByText('Recalculate statistics').closest('li');
  expect(item).not.toHaveAttribute('aria-disabled', 'true');
});

it('percent-encodes a test run id containing URL-unsafe characters', async () => {
  renderMenu(makeTestRun({ test_run_id: 'My App/acc load#1' }));

  clickRecalculate();

  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/data/recalculate-statistics/My%20App%2Facc%20load%231',
      { method: 'POST' },
    ),
  );
});
