/**
 * The collapsed Performance Analysis card gained an error-rate badge (v0.2.96.27).
 *
 * Three things about it are a single edit away from being wrong and none of them throw:
 * the rate is **pooled** (total failed over total requests, not the mean of per-row
 * rates — the same trap that made the error-rate SLO over-report, issue #32), the badge
 * is hidden entirely at zero rather than rendered as "0.00% errors", and it turns red
 * only above 5%, matching OverallTestMetrics in the expanded view.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PerformanceAnalysisCollapsedView } from '../PerformanceAnalysisCollapsedView';
import type { TransactionStat } from '../../types/performance-analysis.types';
import type { ApdexRating } from '../../utils/performance-formatters';

const tx = (total_count: number, failed_count: number): TransactionStat =>
  ({
    transaction_name: `t-${total_count}-${failed_count}`,
    scenario_name: 'default',
    avg_response_time: 100,
    p95_response_time: 200,
    p99_response_time: 300,
    passed_count: total_count - failed_count,
    failed_count,
    total_count,
    apdex_score: 1,
  }) as unknown as TransactionStat;

const APDEX: ApdexRating = {
  label: 'Excellent',
  score: '1.000',
  scoreValue: 1,
  color: '#2e7d32',
  reason: null,
};

function renderView(transactions: TransactionStat[]) {
  return render(
    <PerformanceAnalysisCollapsedView
      loading={false}
      error={null}
      transactions={transactions}
      throughputStats={null}
      overallApdex={APDEX}
      poorApdexTransactions={[]}
      testRun={null}
      excludeRampUp={false}
      onExcludeRampUpChange={jest.fn()}
      rollupPending={null}
    />,
  );
}

describe('the collapsed view error-rate badge', () => {
  it('is absent when nothing failed', () => {
    renderView([tx(1000, 0), tx(500, 0)]);

    expect(screen.queryByText(/% errors/)).toBeNull();
  });

  // Pooled, not averaged: one failure in a 10-request transaction is 10% on its own,
  // but 0.10% of the run. Averaging the two rows would read 5.00%.
  it('pools failures across transactions instead of averaging per-transaction rates', () => {
    renderView([tx(10, 1), tx(990, 0)]);

    expect(screen.getByText('0.10% errors')).toBeInTheDocument();
  });

  // The collapsed badge and the expanded Transaction Error Rate tile report the same
  // number; the tile is green below 5%. The badge was amber there, so at 1% the card
  // warned and expanding it said healthy. Both read ERROR_RATE_WARN_PCT now.
  // Asserted via data-color rather than SoftBadge's private hex, which differs by theme
  // mode and would fail on a palette retune that has nothing to do with the threshold.
  it('stays green at or below the 5% threshold, matching the expanded tile', () => {
    renderView([tx(1000, 50)]);

    expect(screen.getByText('5.00% errors')).toBeInTheDocument();
    expect(screen.getByText('5.00% errors').closest('[data-color]'))
      .toHaveAttribute('data-color', 'green');
  });

  it('turns red above the 5% threshold', () => {
    renderView([tx(1000, 51)]);

    expect(screen.getByText('5.10% errors')).toBeInTheDocument();
    expect(screen.getByText('5.10% errors').closest('[data-color]'))
      .toHaveAttribute('data-color', 'red');
  });

  it('does not divide by zero on rows that recorded no requests', () => {
    renderView([tx(0, 0)]);

    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/% errors/)).toBeNull();
  });

  it('is hidden while the card is still loading', () => {
    render(
      <PerformanceAnalysisCollapsedView
        loading
        error={null}
        transactions={[tx(1000, 100)]}
        throughputStats={null}
        overallApdex={APDEX}
        poorApdexTransactions={[]}
        testRun={null}
        excludeRampUp={false}
        onExcludeRampUpChange={jest.fn()}
        rollupPending={null}
      />,
    );

    expect(screen.queryByText(/% errors/)).toBeNull();
  });

  // REGRESSION: the gate was `errorRate > 0` while the label was `.toFixed(2)`, so three
  // failures in 100k transactions rendered an alarm-coloured pill reading "0.00% errors"
  // — the one state the badge exists to rule out.
  it('never renders a badge that reads zero', () => {
    renderView([tx(100000, 3)]);

    expect(screen.queryByText('0.00% errors')).not.toBeInTheDocument();
    expect(screen.getByText('<0.01% errors')).toBeInTheDocument();
  });

  // The numbers come from TransactionStat.total_count, and "req/s" two pills left means
  // something genuinely different in this product.
  it('counts transactions, not requests, in the tooltip', () => {
    renderView([tx(1000, 10)]);

    expect(screen.getByText('1.00% errors').closest('[aria-label], [title]') ?? document.body)
      .toBeTruthy();
    expect(document.body.innerHTML).toContain('transactions failed');
    expect(document.body.innerHTML).not.toContain('requests failed');
  });

  // REGRESSION: `NaN <= 0` and `undefined <= 0` are both false, so a severity check by
  // comparison alone fell through to a badge reading "NaN% errors" in a green pill.
  it('shows nothing rather than NaN when a count is missing from the response', () => {
    renderView([{ ...tx(1000, 0), failed_count: undefined as unknown as number }]);

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/errors$/)).not.toBeInTheDocument();
  });
});
