/**
 * "View in Performance Analysis" from another card hands the page a DrillDownFilters object,
 * and the card applies it: Overview tab, the row's scenario as the only scenario filter, that
 * scenario expanded, and the transaction filter seeded — including for the worker's 'default'
 * scenario, which the overview groups as "No Scenario".
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PerformanceAnalysisCard from '@/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const tx = (transaction_name: string, scenario_name: string | null) => ({
  transaction_name, scenario_name,
  avg_response_time: 10, p95_response_time: 20, p99_response_time: 30,
  passed_count: 10, failed_count: 0, total_count: 10, ranking: 1, apdex_score: 1, active_threshold: 500,
});
const transactions = [tx('database_call', 'load_test'), tx('api_endpoint', 'load_test'), tx('external_service', 'stress_test'), tx('orphan_call', null)];

beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockReset().mockImplementation((url: string) => {
    if (url.includes('/throughput')) return Promise.resolve({ ok: true, json: async () => ({ overall: {}, by_scenario: [] }) });
    if (url.includes('/virtual-users')) return Promise.resolve({ ok: true, json: async () => ({ overall: {}, by_scenario: [] }) });
    if (url.includes('/apdex-threshold')) return Promise.resolve({ ok: true, json: async () => ({ threshold: 500, has_explicit_threshold: false }) });
    if (url.includes('/transactions')) return Promise.resolve({ ok: true, json: async () => transactions });
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
});

function renderCard(initialFilters?: { scenario?: string; transaction?: string }) {
  const props = { testRunId: 'run-1', expanded: true, onExpand: jest.fn(), showToast: jest.fn() };
  const view = render(<PerformanceAnalysisCard {...props} initialFilters={initialFilters} />);
  return {
    rerender: (f?: { scenario?: string; transaction?: string }) => view.rerender(<PerformanceAnalysisCard {...props} initialFilters={f} />),
  };
}

/** Scenario names that appear as a table row (the filter chips are outside the table). */
const scenarioRows = (name: string) => screen.queryAllByText(name).filter((el) => el.closest('tr'));

it('switches back to Overview, filters on the scenario, expands it and seeds its transaction filter', async () => {
  const { rerender } = renderCard();
  await screen.findAllByText('load_test');

  // Leave Overview first, so the drill-down has a tab switch to prove.
  fireEvent.click(screen.getByRole('tab', { name: 'Top 10 Lists Transactions' }));
  expect(screen.getByRole('tab', { name: 'Top 10 Lists Transactions' })).toHaveAttribute('aria-selected', 'true');

  rerender({ scenario: 'stress_test', transaction: 'external_service' });

  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(scenarioRows('stress_test')).not.toHaveLength(0));
  // The other scenarios are filtered out of the table (their chips stay, so the user can widen it).
  expect(scenarioRows('load_test')).toHaveLength(0);
  expect(screen.getAllByText('load_test')).not.toHaveLength(0);
  // Expanded and seeded: the filter box exists (collapsed scenarios have none) and holds the transaction.
  expect((screen.getByPlaceholderText('Filter transactions...') as HTMLInputElement).value).toBe('external_service');
  expect(screen.getByText('external_service')).toBeInTheDocument();
});

it("maps the worker's 'default' scenario onto the No Scenario group", async () => {
  renderCard({ scenario: 'default', transaction: 'orphan_call' });

  await waitFor(() => expect(scenarioRows('No Scenario')).not.toHaveLength(0));
  expect(scenarioRows('load_test')).toHaveLength(0);
  expect(scenarioRows('stress_test')).toHaveLength(0);
  expect((screen.getByPlaceholderText('Filter transactions...') as HTMLInputElement).value).toBe('orphan_call');
  expect(screen.getByText('orphan_call')).toBeInTheDocument();
});
