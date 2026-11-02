/**
 * The AWR report list polls every 10s while the card is expanded. The RCA tab stays mounted when
 * the user leaves it, so the poll must stop while the tab is hidden and check once on its return.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AwrReportCard } from '../AwrReportCard';
import { useAwrReports } from '../hooks/useAwrReports';
import { TabActiveContext } from '../../../context/TabActiveContext';

jest.mock('../hooks/useAwrReports', () => ({ useAwrReports: jest.fn() }));
jest.mock('../hooks/useAwrAnalysis', () => ({
  useAwrAnalysis: jest.fn(() => ({ analysis: null, loading: false, error: null, refetch: jest.fn() })),
}));

const run = { id: 'run-1', test_run_id: 'TR-1' } as never;
const refetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useAwrReports as jest.Mock).mockReturnValue({
    reports: [], total: 0, loading: false, error: null, refetch, invalidateCache: jest.fn(),
  });
});

// Other panels inside the card read react-query; the app's providers.tsx supplies the client.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = (active: boolean, expanded = true) => (
  <QueryClientProvider client={queryClient}>
    <TabActiveContext.Provider value={active}>
      <AwrReportCard testRun={run} expanded={expanded} onExpand={jest.fn()} />
    </TabActiveContext.Provider>
  </QueryClientProvider>
);
const lastInterval = () => (useAwrReports as jest.Mock).mock.calls.at(-1)![1].refetchInterval;

it('polls only while expanded and on screen, and refetches once when its tab is shown again', () => {
  // Value: protects=no AWR polling from a hidden RCA tab, and an immediate check on return; fails_when=the TabActiveContext guard is dropped or the resume refetch is lost; why_new=testing+design review cycle 3: AwrReportCard had no tests; seam=none; no_claim=react-query honouring refetchInterval
  const { rerender } = render(tree(true));
  expect(lastInterval()).toBe(10000);
  expect(refetch).not.toHaveBeenCalled();

  rerender(tree(false));
  expect(lastInterval()).toBe(0);

  rerender(tree(true));
  expect(lastInterval()).toBe(10000);
  expect(refetch).toHaveBeenCalledTimes(1);

  rerender(tree(true, false));
  expect(lastInterval()).toBe(0);
});
