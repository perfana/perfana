import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MetricSeriesStatusChip } from '../MetricSeriesStatusChip';
import type { MetricTarget, MetricSeriesResult } from '../../../types';

const trendResult: MetricSeriesResult = { evaluate_type: 'trend', metric_unit: '%/h', status: 'COMPLETE' };

function renderChip(target: MetricTarget, result: MetricSeriesResult = trendResult) {
  return render(<MetricSeriesStatusChip target={target} result={result} isStale={false} />);
}

describe('MetricSeriesStatusChip — trend rows', () => {
  it('renders "No clear trend" with an explanatory tooltip for a weak series, instead of Pass/Fail/-', async () => {
    renderChip({ target: 'MijnWerkNl', value: 20.2, meets_requirement: true, weak_trend: true, trend_corr: 0.1 });

    const chip = screen.getByText('No clear trend');
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
    expect(screen.queryByText('Fail')).not.toBeInTheDocument();
    expect(screen.queryByText('-')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.hover(chip);
    // Wording is presentation; what matters is that the row explains why it has no verdict.
    expect(
      await screen.findByText(/The slope is not a clear trend .*this series passes/),
    ).toBeInTheDocument();
  });

  it('keeps a plain verdict, an error and the legacy dash distinct from the weak-trend chip', () => {
    // A judged trend row is an ordinary Pass/Fail.
    const { unmount } = renderChip({ target: 'a', value: 26.4, meets_requirement: false, trend_corr: 0.66 });
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.queryByText('No clear trend')).not.toBeInTheDocument();
    unmount();

    // A weak trend passes, but says so rather than showing a bare Pass.
    const second = renderChip({ target: 'b', value: 1, meets_requirement: true, weak_trend: true });
    expect(screen.getByText('No clear trend')).toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
    second.unmount();

    // An errored result is Invalid whatever the target says.
    const third = renderChip({ target: 'c', value: 1, meets_requirement: true, weak_trend: true }, { ...trendResult, status: 'ERROR' });
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.queryByText('No clear trend')).not.toBeInTheDocument();
    third.unmount();

    // A null verdict without the flag (pattern-excluded, or a row from before the feature) stays a dash.
    renderChip({ target: 'd', value: 1, meets_requirement: null });
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('No clear trend')).not.toBeInTheDocument();
  });
});
