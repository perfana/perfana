import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import OverallTestMetrics from '@/app/test-runs/[id]/components/performance-analysis/components/OverallTestMetrics';

/**
 * The tiles show percentiles of the run, which the transactions cannot produce: the same figure,
 * averaged over them, reads far too low whenever a slow minority forms the tail. That average is
 * only a stand-in for an API that cannot answer, and it must not be called a percentile.
 */
describe('OverallTestMetrics percentile tiles', () => {
  const transaction = {
    total_count: 100,
    passed_count: 100,
    failed_count: 0,
    avg_response_time: 100,
    p95_response_time: 200,
    p99_response_time: 300,
    apdex_score: 1,
  };

  const renderWith = (percentiles: { p95_response_time: number; p99_response_time: number } | null | undefined) =>
    render(
      <OverallTestMetrics
        transactions={[transaction] as never}
        throughputStats={null}
        virtualUserStats={null}
        testLevelThreshold={500}
        percentiles={percentiles}
      />,
    );

  it('shows the percentiles of the scope, called percentiles', () => {
    renderWith({ p95_response_time: 844.19, p99_response_time: 1122.87 });

    expect(screen.getByText('844.19 ms')).toBeInTheDocument();
    expect(screen.getByText('1122.87 ms')).toBeInTheDocument();
    expect(screen.getByText('95th percentile')).toBeInTheDocument();
    expect(screen.getByText('99th percentile')).toBeInTheDocument();
    expect(screen.queryByText('200.00 ms')).not.toBeInTheDocument();
  });

  it('labels the weighted figure as an average when the API cannot answer', () => {
    renderWith(null);

    expect(screen.getByText('200.00 ms')).toBeInTheDocument();
    expect(screen.getByText('300.00 ms')).toBeInTheDocument();
    expect(screen.getByText('Average of transaction P95s')).toBeInTheDocument();
    expect(screen.getByText('Average of transaction P99s')).toBeInTheDocument();
    expect(screen.queryByText('95th percentile')).not.toBeInTheDocument();
    expect(screen.queryByText('99th percentile')).not.toBeInTheDocument();
  });

  it('shows no figure while waiting, rather than a lower one that then jumps', () => {
    renderWith(undefined);

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('200.00 ms')).not.toBeInTheDocument();
    expect(screen.queryByText('Average of transaction P95s')).not.toBeInTheDocument();
  });
});
