/**
 * REGRESSION: an Invalid SLO drew a chart of data that was not its own.
 *
 * Shape taken from a real export (sut-WBS, 2026-10-01): a trend SLO on
 * "Transaction RT Avg" whose series each hold one point, so the worker found no slope
 * and stored status ERROR / "No targets found for processing" with `targets: []`.
 * `targetName` was then undefined, the hook's deliberate "target matches no charted
 * series" fallback kicked in, and the chart drew a bar per transaction — fifteen
 * numbers that are not this SLO's, beside a series table correctly reading
 * "No values available for this SLO".
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import SLOMetricsChart from '../SLOMetricsChart';
import type { CheckResult } from '@/lib/types';

const fetchMock = jest.fn();
jest.mock('@/lib/api', () => ({
  authenticatedFetch: (...args: unknown[]) => fetchMock(...args),
}));

const INVALID_TREND_RESULT = {
  id: 'cr-1',
  test_run_id: 'run-1',
  benchmark_id: '37b2cd4d-775d-4dae-9c6b-e9f70849e5ab',
  panel_id: 101,
  panel_title: 'Transaction RT Avg',
  metric_name: null,
  evaluate_type: 'trend',
  status: 'ERROR',
  message: 'No targets found for processing',
  meets_requirement: null,
  targets: [],
} as unknown as CheckResult;

describe('SLOMetricsChart with an invalid SLO', () => {
  beforeEach(() => fetchMock.mockReset());

  it('shows the reason instead of a chart, and fetches nothing', () => {
    render(<SLOMetricsChart testRunId="run-1" checkResult={INVALID_TREND_RESULT} />);

    expect(screen.getByText('No targets found for processing')).toBeInTheDocument();
    expect(document.querySelector('.plotly-chart')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a generic line when the result carries no message', () => {
    render(
      <SLOMetricsChart
        testRunId="run-1"
        checkResult={{ ...INVALID_TREND_RESULT, message: undefined } as CheckResult}
      />
    );

    expect(screen.getByText('This SLO produced no values to chart')).toBeInTheDocument();
  });
});
