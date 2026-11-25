// Value: protects=within mode sends this run as its own baseline with the two ranges' ISO bounds, and a
// Compare Traces reply that lands after the choice changed is dropped; fails_when=windowToIso is not applied,
// another run's id is sent, or the request-sequence guard is removed; why_new=no TracesDiffTab test existed;
// seam=none (compareTraces, authenticatedFetch and the report component mocked); no_claim=the tracing backend
// honouring the windows
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TracesDiffTab from '../TracesDiffTab';
import { compareTraces } from '@/lib/trace-analysis-api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));
jest.mock('@/lib/trace-analysis-api', () => ({ compareTraces: jest.fn() }));
jest.mock('../TraceAnalysisReport', () => ({
  __esModule: true,
  default: () => <div data-testid="trace-report">report</div>,
}));

const mockedCompare = compareTraces as jest.MockedFunction<typeof compareTraces>;

// A 30-minute run: the default ranges are its first and last 10 minutes.
const testRun = {
  id: 'uuid-1',
  test_run_id: 'Shop-acc-load-00009',
  system_under_test_id: 'sut-1',
  start_time: '2026-11-25T10:00:00.000Z',
  end_time: '2026-11-25T10:30:00.000Z',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'Shop' },
};

const tab = (serviceName = 'orders', onDiffStateChange?: (s: unknown) => void) => (
  <TracesDiffTab
    testRun={testRun}
    tracingInstanceId="tracing-1"
    serviceName={serviceName}
    scenario="Checkout"
    transaction="Pay"
    sampler={null}
    onDiffStateChange={onDiffStateChange}
  />
);
const renderTab = () => render(tab());

const result = { summary: { currentTraceCount: 1 } } as never;

describe('TracesDiffTab within mode', () => {
  beforeEach(() => mockedCompare.mockReset());

  it('compares two ranges of this run, with the run itself as the baseline', async () => {
    mockedCompare.mockResolvedValue(result);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Two time ranges in this run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Traces' }));

    await waitFor(() => expect(mockedCompare).toHaveBeenCalledTimes(1));
    expect(mockedCompare.mock.calls[0]![0]).toMatchObject({
      currentTestRunId: 'Shop-acc-load-00009',
      baselineTestRunId: 'Shop-acc-load-00009',
      baselineStartTime: '2026-11-25T10:00:00.000Z',
      baselineEndTime: '2026-11-25T10:10:00.000Z',
      currentStartTime: '2026-11-25T10:20:00.000Z',
      currentEndTime: '2026-11-25T10:30:00.000Z',
    });
    expect(await screen.findByTestId('trace-report')).toBeTruthy();
  });

  it('drops a reply that lands after the comparison mode changed', async () => {
    let resolve!: (r: never) => void;
    mockedCompare.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Two time ranges in this run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Traces' }));
    await waitFor(() => expect(mockedCompare).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Another test run' }));
    await act(async () => { resolve(result); });

    expect(screen.queryByTestId('trace-report')).toBeNull();
  });

  // Value: protects=an error from one comparison choice does not stay on screen under the next; fails_when=
  // invalidateCompare stops clearing the error; why_new=adversarial review; seam=none; no_claim=the wording
  it('clears a comparison error when the mode changes', async () => {
    mockedCompare.mockRejectedValue(new Error('Tempo unreachable'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Two time ranges in this run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Traces' }));
    expect(await screen.findByText('Tempo unreachable')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Another test run' }));
    await waitFor(() => expect(screen.queryByText('Tempo unreachable')).toBeNull());
  });

  // Value: protects=the recorded result names its service and does not outlive a service switch;
  // fails_when=resultFor drops the service or the scope reset is removed; why_new=a comment could store
  // service A's result under service B; seam=none; no_claim=the card's own service tabs (props driven here)
  it('names the service in the recorded result and clears it when the service changes', async () => {
    mockedCompare.mockResolvedValue(result);
    const reports: Array<{ result: unknown; resultFor: string | null } | null> = [];
    const onState = (s: unknown) => reports.push(s as never);
    const { rerender } = render(tab('orders', onState));
    fireEvent.click(screen.getByRole('button', { name: 'Two time ranges in this run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare Traces' }));
    expect(await screen.findByTestId('trace-report')).toBeTruthy();
    expect(reports[reports.length - 1]!.resultFor).toMatch(/^orders: Checkout \/ Pay /);

    rerender(tab('payments', onState));
    await waitFor(() => expect(screen.queryByTestId('trace-report')).toBeNull());
    expect(reports[reports.length - 1]!.result).toBeNull();
  });
});
