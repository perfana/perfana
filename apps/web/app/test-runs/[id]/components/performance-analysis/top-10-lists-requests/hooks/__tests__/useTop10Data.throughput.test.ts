// Value: protects=the Top 10 requests list's throughput divides analysis-window sampler counts by the
// analysis window (duration - ramp-up - ramp-down) when the toggle is on, and by the whole run when
// it is off; fails_when=the hook goes back to `testRunData.duration` or drops the excludeRampUp
// argument; why_new=useTop10TableData.throughput.test.ts covers the transactions list only, and this
// hook computes its rate separately (prepareTop10Data in top-10-lists-requests); seam=none;
// no_claim=fetchRunSamplers is mocked, so the samplers endpoint and its 404/202 fallback are not exercised.
import { renderHook, waitFor } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { fetchRunSamplers } from '../../../utils/run-samplers';
import { useTop10Data } from '../useTop10Data';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../../../utils/run-samplers', () => ({ fetchRunSamplers: jest.fn() }));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const mockSamplers = fetchRunSamplers as jest.MockedFunction<typeof fetchRunSamplers>;

// A 1000 s run with 100 s ramp-up and 300 s ramp-down: a 600 s analysis window.
const RUN = {
  duration: 1000,
  start_time: '2026-01-01T10:00:00.000Z',
  end_time: '2026-01-01T10:16:40.000Z',
  analysis_start_offset: 100,
  analysis_end_offset: 300,
};

function throughputOf(excludeRampUp: boolean) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => RUN } as Response);
  mockSamplers.mockResolvedValue([
    {
      transaction_name: 'tx-a',
      sampler_name: 'GET /a',
      scenario_name: 'scenario-a',
      url_pattern: '/a',
      avg_response_time: 50,
      passed_count: 6000,
      failed_count: 0,
      total_count: 6000,
    },
  ]);
  return renderHook(() => useTop10Data({ testRunId: 'run-1', excludeRampUp }));
}

describe('useTop10Data throughput divisor', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSamplers.mockReset();
  });

  it('divides by the analysis window with both offsets out when the toggle is on', async () => {
    const { result } = throughputOf(true);
    await waitFor(() => expect(result.current.top10Data).toHaveLength(1));
    expect(result.current.top10Data[0]!.throughput).toBe(10); // 6000 / 600, not 6000 / 1000
    expect(mockSamplers).toHaveBeenCalledWith('run-1', true);
  });

  it('divides by the whole run when the toggle is off', async () => {
    const { result } = throughputOf(false);
    await waitFor(() => expect(result.current.top10Data).toHaveLength(1));
    expect(result.current.top10Data[0]!.throughput).toBe(6);
  });
});
