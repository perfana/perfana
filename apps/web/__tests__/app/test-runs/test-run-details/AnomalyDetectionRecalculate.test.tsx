/**
 * Regression tests for #552 — the "Recalculate baseline statistics" action.
 *
 * The action lives beside the ADAPT message rather than in the test-run menus,
 * because it only helps for one of the four causes and it applies to the CONTROL
 * runs, not to the run the user is looking at.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvaluationResultsSection } from '@/app/test-runs/[id]/components/test-run-details/components/EvaluationResultsSection';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const testRun = {
  id: 'uuid-3',
  test_run_id: 'run-00003',
  status: { evaluatingAdapt: 'NO_BASELINES_FOUND' },
  valid: true,
} as unknown as TestRun;

/** Answer the conclusion GET with these `details`; POSTs resolve per `postOk`. */
function mockConclusion(details: Record<string, unknown>, postOk: boolean | boolean[] = true) {
  const postResults = Array.isArray(postOk) ? [...postOk] : null;
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const ok = postResults ? (postResults.shift() ?? true) : (postOk as boolean);
      return Promise.resolve({ ok, status: ok ? 200 : 500 } as Response);
    }
    return Promise.resolve({
      ok: true,
      text: async () => JSON.stringify({ details }),
    } as Response);
  });
}

describe('Recalculate baseline statistics action (#552)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers the action when the baseline aggregation failed, naming the control run count', async () => {
    mockConclusion({
      message: 'ADAPT could not build a baseline.',
      cause: 'baseline-aggregation-failed',
      controlRuns: ['run-00001', 'run-00002'],
    });

    render(<EvaluationResultsSection testRun={testRun} />);

    expect(await screen.findByRole('button', { name: /Recalculate baseline statistics \(2 runs\)/ })).toBeInTheDocument();
  });

  it('posts a recalculation for each control run, not for the run being viewed', async () => {
    const showToast = jest.fn();
    mockConclusion({
      message: 'ADAPT could not build a baseline.',
      cause: 'baseline-aggregation-failed',
      controlRuns: ['run-00001'],
    });

    render(<EvaluationResultsSection testRun={testRun} showToast={showToast} />);
    await userEvent.click(await screen.findByRole('button', { name: /Recalculate baseline statistics/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalled());

    const posts = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe('/data/recalculate-statistics/run-00001');
    // The remedy belongs to the baseline; posting for the viewed run would be a no-op.
    expect(posts[0]?.[0]).not.toContain('run-00003');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('1 control run'));
  });

  it.each([
    ['metrics-source-mismatch'],
    ['baseline-insufficient-data'],
    ['run-too-short'],
    ['changepoint'],
  ])('does not offer the action for cause %s', async (cause) => {
    mockConclusion({ message: 'Some other cause.', cause, controlRuns: ['run-00001'] });

    render(<EvaluationResultsSection testRun={testRun} />);

    expect(await screen.findByText('Some other cause.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalculate baseline statistics/ })).not.toBeInTheDocument();
  });

  it('does not offer the action for a conclusion written before cause was recorded', async () => {
    mockConclusion({ message: 'An older conclusion with no cause field.' });

    render(<EvaluationResultsSection testRun={testRun} />);

    expect(await screen.findByText('An older conclusion with no cause field.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalculate baseline statistics/ })).not.toBeInTheDocument();
  });

  it('reports failure and re-enables the button when every recalculation is refused', async () => {
    const showToast = jest.fn();
    mockConclusion(
      { message: 'ADAPT could not build a baseline.', cause: 'baseline-aggregation-failed', controlRuns: ['run-00001'] },
      false,
    );

    render(<EvaluationResultsSection testRun={testRun} showToast={showToast} />);
    const button = await screen.findByRole('button', { name: /Recalculate baseline statistics/ });
    await userEvent.click(button);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to start baseline statistics recalculation'),
    );
    // Cleared in `finally`, so the user can retry.
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('says how many started when only some control runs could be queued', async () => {
    const showToast = jest.fn();
    mockConclusion(
      {
        message: 'ADAPT could not build a baseline.',
        cause: 'baseline-aggregation-failed',
        controlRuns: ['run-00001', 'run-00002'],
      },
      [true, false],
    );

    render(<EvaluationResultsSection testRun={testRun} showToast={showToast} />);
    await userEvent.click(await screen.findByRole('button', { name: /Recalculate baseline statistics/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Started 1 of 2 control runs — the rest could not be started'));
  });
});
