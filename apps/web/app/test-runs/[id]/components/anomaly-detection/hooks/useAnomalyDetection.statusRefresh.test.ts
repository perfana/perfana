/**
 * The collapsed anomaly card must follow a re-evaluate: when the realtime test-run update
 * moves status.evaluatingAdapt, the hook refetches (the SLO card already does the same).
 * The card reads counts from /anomaly-detection/summary; the rows are fetched on expand only.
 */
import { act, renderHook } from '@testing-library/react';
import { useAnomalyDetection } from './useAnomalyDetection';
import type { TestRun } from '@/types/test-runs';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('./useUpdateAdaptConfig', () => ({ useUpdateAdaptConfig: () => ({ updateAdaptConfig: jest.fn() }) }));

import { authenticatedFetch } from '@/lib/api';
const fetchMock = authenticatedFetch as jest.Mock;

const runWith = (evaluatingAdapt: string) =>
  ({ id: 'r1', test_run_id: 'r1', completed: true, status: { evaluatingAdapt } }) as unknown as TestRun;

const callsTo = (suffix: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
const summaryCalls = () => callsTo('/anomaly-detection/summary');
const rowCalls = () => callsTo('/anomaly-detection');

describe('useAnomalyDetection status refresh', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
  });

  const props = {
    testRunId: 'r1',
    anomalyExpanded: false,
    onAnomalyExpand: jest.fn(),
    conclusionFilter: 'all',
    setConclusionFilter: jest.fn(),
    showToast: jest.fn(),
    cardRef: { current: null },
  };

  it('refetches the summary when evaluatingAdapt changes, and not on unrelated rerenders', async () => {
    const { rerender } = renderHook(
      ({ testRun }) => useAnomalyDetection({ ...props, testRun }),
      { initialProps: { testRun: runWith('IN_PROGRESS') } },
    );
    await act(async () => {});
    expect(summaryCalls()).toBe(1);

    await act(async () => rerender({ testRun: runWith('IN_PROGRESS') })); // new object, same status
    expect(summaryCalls()).toBe(1);

    await act(async () => rerender({ testRun: runWith('COMPLETED') }));
    expect(summaryCalls()).toBe(2);
  });

  // The row list runs to 20k+ entries on a large run; the collapsed card must never pull it.
  it('fetches the rows only while the card is expanded', async () => {
    const { rerender } = renderHook(
      ({ testRun, anomalyExpanded }) => useAnomalyDetection({ ...props, testRun, anomalyExpanded }),
      { initialProps: { testRun: runWith('IN_PROGRESS'), anomalyExpanded: false } },
    );
    await act(async () => {});
    await act(async () => rerender({ testRun: runWith('COMPLETED'), anomalyExpanded: false }));
    expect(rowCalls()).toBe(0);

    await act(async () => rerender({ testRun: runWith('COMPLETED'), anomalyExpanded: true }));
    expect(rowCalls()).toBe(1); // on expand

    await act(async () => rerender({ testRun: runWith('IN_PROGRESS'), anomalyExpanded: true }));
    expect(rowCalls()).toBe(2); // status moved while open
    expect(summaryCalls()).toBe(3);
  });
});
