/**
 * The collapsed anomaly card must follow a re-evaluate: when the realtime test-run update
 * moves status.evaluatingAdapt, the hook refetches (the SLO card already does the same).
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

const anomalyCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/anomaly-detection')).length;

describe('useAnomalyDetection status refresh', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('refetches anomaly data when evaluatingAdapt changes, and not on unrelated rerenders', async () => {
    const props = {
      testRunId: 'r1',
      anomalyExpanded: false,
      onAnomalyExpand: jest.fn(),
      conclusionFilter: 'all',
      setConclusionFilter: jest.fn(),
      showToast: jest.fn(),
      cardRef: { current: null },
    };
    const { rerender } = renderHook(
      ({ testRun }) => useAnomalyDetection({ ...props, testRun }),
      { initialProps: { testRun: runWith('IN_PROGRESS') } },
    );
    await act(async () => {});
    expect(anomalyCalls()).toBe(1);

    await act(async () => rerender({ testRun: runWith('IN_PROGRESS') })); // new object, same status
    expect(anomalyCalls()).toBe(1);

    await act(async () => rerender({ testRun: runWith('COMPLETED') }));
    expect(anomalyCalls()).toBe(2);
  });
});
