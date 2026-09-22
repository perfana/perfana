/**
 * A drill-down from another card seeds one scenario's transaction filter. The scenario in the
 * filters is the worker's spelling — a NULL scenario is 'default' — while the table groups
 * those transactions under NO_SCENARIO_LABEL, so the key has to be mapped or the filter lands
 * on a group that does not exist and the user sees the unfiltered table.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TransactionsTable, TransactionsTableProps } from '../TransactionsTable';
import { NO_SCENARIO_LABEL } from '../ScenarioFilter';
import type { TransactionStat } from '../../types/performance-analysis.types';

const tx = (transaction_name: string, scenario_name: string | null): TransactionStat => ({
  transaction_name, scenario_name,
  avg_response_time: 10, p95_response_time: 20, p99_response_time: 30,
  passed_count: 10, failed_count: 0, total_count: 10, apdex_score: 1, active_threshold: 500,
} as unknown as TransactionStat);

const unscoped = [tx('checkout', null), tx('login', null)];
const main = [tx('search', 'main'), tx('checkout', 'main')];

function renderTable(initialTransactionFilters?: TransactionsTableProps['initialTransactionFilters']) {
  const props: TransactionsTableProps = {
    scenarioGroups: [[NO_SCENARIO_LABEL, unscoped], ['main', main]],
    transactions: [...unscoped, ...main],
    throughputStats: null,
    virtualUserStats: null,
    sortField: 'transaction_name',
    sortOrder: 'asc',
    onSort: jest.fn(),
    expandedRows: new Set(),
    rowSamples: {},
    loadingSamples: {},
    samplesError: {},
    onRowClick: jest.fn(),
    expandedScenarios: new Set([NO_SCENARIO_LABEL, 'main']),
    onToggleScenario: jest.fn(),
    onOpenActionMenu: jest.fn(),
    onOpenTransactionErrors: jest.fn(),
    onOpenSamplerActionMenu: jest.fn(),
    onOpenSamplerErrors: jest.fn(),
    initialTransactionFilters,
  };
  const view = render(<TransactionsTable {...props} />);
  return { rerender: (f?: TransactionsTableProps['initialTransactionFilters']) => view.rerender(<TransactionsTable {...props} initialTransactionFilters={f} />) };
}

/** One filter box per expanded scenario, in group order. */
const filterBoxes = () => screen.getAllByPlaceholderText('Filter transactions...') as HTMLInputElement[];

it("seeds the No Scenario group's filter for a 'default' scenario and leaves the other groups alone", () => {
  renderTable({ scenario: 'default', transaction: 'checkout' });

  expect(filterBoxes().map((b) => b.value)).toEqual(['checkout', '']);
  // The No Scenario group shows only its match; the main group still shows every row.
  expect(screen.queryByText('login')).not.toBeInTheDocument();
  expect(screen.getByText('search')).toBeInTheDocument();
  expect(screen.getAllByText('checkout')).toHaveLength(2);
});

it('keys a named scenario on its own group and merges a later drill-down instead of replacing the first', () => {
  const { rerender } = renderTable({ scenario: 'main', transaction: 'search' });
  expect(filterBoxes().map((b) => b.value)).toEqual(['', 'search']);

  // A second drill-down (a new object, so the effect runs) targets the other group.
  rerender({ scenario: undefined, transaction: 'login' });
  expect(filterBoxes().map((b) => b.value)).toEqual(['login', 'search']);
});

it('seeds nothing for a scenario-only drill-down', () => {
  renderTable({ scenario: 'main' });
  expect(filterBoxes().map((b) => b.value)).toEqual(['', '']);
  expect(screen.getByText('login')).toBeInTheDocument();
});
