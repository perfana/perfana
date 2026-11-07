/**
 * A scenario's P95 and P99 come from the server. The average of its transactions' percentiles is
 * only a stand-in, and the row says so on hover.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TransactionsTable, TransactionsTableProps } from '../TransactionsTable';
import { ScenarioMetricsRow } from '../ScenarioMetricsRow';
import { NO_SCENARIO_LABEL } from '../ScenarioFilter';
import type { ScenarioMetrics } from '../../utils/performance-formatters';
import type { TransactionStat } from '../../types/performance-analysis.types';

const metrics = {
  errorRate: 0,
  weightedAvgResponseTime: 100,
  weightedP95ResponseTime: 200,
  weightedP99ResponseTime: 300,
  weightedApdexScore: 1,
  apdexSampleCount: 10,
  totalRequests: 10,
} as unknown as ScenarioMetrics;

const renderRow = (percentiles: { p95_response_time: number; p99_response_time: number } | null | undefined) =>
  render(
    <table>
      <tbody>
        <ScenarioMetricsRow
          scenarioName="Checkout"
          metrics={metrics}
          throughputStats={null}
          virtualUserStats={null}
          percentiles={percentiles}
          onToggleScenario={jest.fn()}
        />
      </tbody>
    </table>,
  );

describe('ScenarioMetricsRow percentiles', () => {
  it('shows the true figures with no caveat', () => {
    renderRow({ p95_response_time: 990.83, p99_response_time: 1190.6 });

    expect(screen.getByText('990.83')).toBeInTheDocument();
    expect(screen.getByText('1190.60')).toBeInTheDocument();
    expect(screen.getByText('P95 (ms)')).not.toHaveAttribute('title');
    expect(screen.getByText('P99 (ms)')).not.toHaveAttribute('title');
  });

  it('says what the weighted stand-in is', () => {
    renderRow(null);

    expect(screen.getByText('200.00')).toBeInTheDocument();
    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(screen.getByText('P95 (ms)')).toHaveAttribute('title', expect.stringContaining('Not a percentile'));
    expect(screen.getByText('P99 (ms)')).toHaveAttribute('title', expect.stringContaining('Not a percentile'));
  });

  it('shows no figure while waiting', () => {
    renderRow(undefined);

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('200.00')).not.toBeInTheDocument();
    expect(screen.getByText('P95 (ms)')).not.toHaveAttribute('title');
  });
});

describe('TransactionsTable hands each scenario its own figures', () => {
  const tx = (transaction_name: string, scenario_name: string | null): TransactionStat => ({
    transaction_name, scenario_name,
    avg_response_time: 10, p95_response_time: 20, p99_response_time: 30,
    passed_count: 10, failed_count: 0, total_count: 10, apdex_score: 1, active_threshold: 500,
  } as unknown as TransactionStat);

  const renderTable = (scopePercentiles: TransactionsTableProps['scopePercentiles']) => {
    const unscoped = [tx('login', null)];
    const main = [tx('search', 'main')];
    const props: TransactionsTableProps = {
      scenarioGroups: [[NO_SCENARIO_LABEL, unscoped], ['main', main]],
      transactions: [...unscoped, ...main],
      throughputStats: null,
      virtualUserStats: null,
      scopePercentiles,
      sortField: 'transaction_name',
      sortOrder: 'asc',
      onSort: jest.fn(),
      expandedRows: new Set(),
      rowSamples: {},
      loadingSamples: {},
      samplesError: {},
      onRowClick: jest.fn(),
      expandedScenarios: new Set(),
      onToggleScenario: jest.fn(),
      onOpenActionMenu: jest.fn(),
      onOpenTransactionErrors: jest.fn(),
      onOpenSamplerActionMenu: jest.fn(),
      onOpenSamplerErrors: jest.fn(),
    };
    return render(<TransactionsTable {...props} />);
  };

  it('looks each one up by the label it is grouped under, the overall figure reaching neither', () => {
    renderTable({
      overall: { p95_response_time: 999, p99_response_time: 999 },
      byScenario: new Map([
        [NO_SCENARIO_LABEL, { p95_response_time: 111, p99_response_time: 112 }],
        ['main', { p95_response_time: 221, p99_response_time: 222 }],
      ]),
    });

    for (const value of ['111.00', '112.00', '221.00', '222.00']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByText('999.00')).not.toBeInTheDocument();
  });

  it('falls back per scenario when the answer does not name one', () => {
    renderTable({
      overall: null,
      byScenario: new Map([['main', { p95_response_time: 221, p99_response_time: 222 }]]),
    });

    expect(screen.getByText('221.00')).toBeInTheDocument();
    // The unnamed scenario's rows are all p95 20, so its average is 20.
    expect(screen.getByText('20.00')).toBeInTheDocument();
  });

  it('stays blank while the answer is out', () => {
    renderTable(undefined);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('falls back everywhere when the API cannot answer', () => {
    renderTable(null);
    expect(screen.getAllByText('20.00')).toHaveLength(2);
    expect(screen.getAllByText('30.00')).toHaveLength(2);
  });
});
