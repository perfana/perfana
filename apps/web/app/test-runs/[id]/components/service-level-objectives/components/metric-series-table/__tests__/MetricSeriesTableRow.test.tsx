/**
 * The per-series actions menu on an SLO row. It exists only when the check result names the
 * series (dashboard label + panel id + target name); "View in Performance Analysis" is added
 * only for a performance-test series the drill-down can filter on.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useParams } from 'next/navigation';
import { MetricSeriesTableRow } from '../MetricSeriesTableRow';
import { PerformanceAnalysisDrillDownContext } from '../../../../shared/metric-card-links';
import type { MetricSeriesResult, MetricTarget } from '../../../types';

const perfResult: MetricSeriesResult = {
  status: 'COMPLETE', evaluate_type: 'avg', metric_unit: 'ms',
  dashboard_label: 'Performance test metrics S', panel_id: 101, panel_title: 'Transaction RT Avg',
};
const target: MetricTarget = { target: 'checkout', value: 120, meets_requirement: true };

function renderRow(result: MetricSeriesResult, t: MetricTarget = target, drillDown = jest.fn()) {
  const onClick = jest.fn();
  render(
    <PerformanceAnalysisDrillDownContext.Provider value={drillDown}>
      <MetricSeriesTableRow target={t} sortedIndex={0} totalCount={1} isSelected={false} result={result} isStale={false} onClick={onClick} />
    </PerformanceAnalysisDrillDownContext.Provider>,
  );
  return { onClick, drillDown };
}

beforeEach(() => {
  (useParams as jest.Mock).mockReturnValue({ id: 'run-1' });
});

it('opens the menu without selecting the row, links the series to the cards and drills into Performance Analysis', () => {
  const { onClick, drillDown } = renderRow(perfResult);

  fireEvent.click(screen.getByLabelText('Actions'));
  expect(onClick).not.toHaveBeenCalled();

  const href = screen.getByText('Open in Compare').closest('a')!.getAttribute('href')!;
  const q = new URL(href, 'http://x').searchParams;
  expect(href.startsWith('/test-runs/run-1?')).toBe(true);
  expect([q.get('card'), q.get('dashboard'), q.get('panel'), q.get('metric')]).toEqual(['compare', perfResult.dashboard_label, '101', 'checkout']);

  fireEvent.click(screen.getByText('View in Performance Analysis'));
  expect(drillDown).toHaveBeenCalledWith({ scenario: 'S', transaction: 'checkout' });
  expect(onClick).not.toHaveBeenCalled();
});

it('offers the card links but no Performance Analysis drill-down for a Grafana series', () => {
  renderRow({ ...perfResult, dashboard_label: 'JVM', panel_id: 5, panel_title: 'Heap' });

  fireEvent.click(screen.getByLabelText('Actions'));
  expect(screen.getByText('Open in Graphs')).toBeInTheDocument();
  expect(screen.queryByText('View in Performance Analysis')).not.toBeInTheDocument();
});

it('renders no actions button when the result cannot name the series', () => {
  // Results from before the API exposed the panel identity, and a nameless target.
  const cases: [MetricSeriesResult, MetricTarget][] = [
    [{ ...perfResult, dashboard_label: undefined }, target],
    [{ ...perfResult, panel_id: undefined }, target],
    [perfResult, { ...target, target: '' }],
  ];
  for (const [result, t] of cases) {
    const { unmount } = render(
      <MetricSeriesTableRow target={t} sortedIndex={0} totalCount={1} isSelected={false} result={result} isStale={false} onClick={jest.fn()} />,
    );
    expect(screen.queryByLabelText('Actions')).not.toBeInTheDocument();
    unmount();
  }
});
