/**
 * Tests for the "Recalculate statistics" action (#552).
 *
 * This is the only route a user has out of an ADAPT dead-end where the baseline's
 * `ds_metric_statistics` rows are missing their `pct_agg` sketch, so the menu item
 * has to be present, POST to the right endpoint, and tell the user either way.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActionsMenu } from './ActionsMenu';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
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

/** Open the menu and click "Recalculate statistics". */
const openAndClickRecalculate = () => {
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByText('Recalculate statistics'));
};

const renderMenu = (testRun: TestRun = makeTestRun()) => {
  const showToast = jest.fn();
  render(
    <ActionsMenu
      testRun={testRun}
      onDelete={jest.fn()}
      showToast={showToast}
      onRefresh={jest.fn()}
    />,
  );
  return { showToast };
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

it('offers the action in the menu', () => {
  renderMenu();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Recalculate statistics')).toBeInTheDocument();
});

it('POSTs to the recalculate endpoint and confirms to the user', async () => {
  const { showToast } = renderMenu();

  openAndClickRecalculate();

  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/data/recalculate-statistics/PerfanaWebshop-acc-loadTest-00018',
      { method: 'POST' },
    ),
  );
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Statistics recalculation started'));
});

it('percent-encodes a test run id containing URL-unsafe characters', async () => {
  renderMenu(makeTestRun({ test_run_id: 'My App/acc load#1' }));

  openAndClickRecalculate();

  await waitFor(() =>
    expect(mockFetch).toHaveBeenCalledWith(
      '/data/recalculate-statistics/My%20App%2Facc%20load%231',
      { method: 'POST' },
    ),
  );
});

it('tells the user when the API refuses the request', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
  const { showToast } = renderMenu();

  openAndClickRecalculate();

  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('Failed to start statistics recalculation'),
  );
  expect(showToast).not.toHaveBeenCalledWith('Statistics recalculation started');
});

it('tells the user when the request never reaches the API', async () => {
  mockFetch.mockRejectedValue(new Error('Network down'));
  const { showToast } = renderMenu();

  openAndClickRecalculate();

  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('Failed to start statistics recalculation'),
  );
});

it('closes the menu after the action, on success and on failure', async () => {
  const { showToast } = renderMenu();

  openAndClickRecalculate();
  await waitFor(() => expect(showToast).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByText('Recalculate statistics')).not.toBeInTheDocument(),
  );

  mockFetch.mockRejectedValue(new Error('Network down'));
  showToast.mockClear();

  openAndClickRecalculate();
  await waitFor(() => expect(showToast).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByText('Recalculate statistics')).not.toBeInTheDocument(),
  );
});
