// Value: protects=the Top 10 transactions table's throughput divides analysis-window counts by the
// analysis window (duration - ramp-up - ramp-down) when the toggle is on, and by the whole run when it
// is off; fails_when=the hook goes back to `testRunData.duration`, drops the excludeRampUp argument, or
// reads the offsets under the wrong field names (the run endpoint spells them analysis_*_offset);
// why_new=throughput-seconds.test.ts pins the helper only, nothing pinned that a hook calls it with the
// /test-runs/:id payload; seam=none; no_claim=the two sibling lists (useTop10Data, Top10ListsUrls)
// make the identical one-line call and are covered by review, not by this test.
import { renderHook, waitFor } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { useTop10TableData } from '../useTop10TableData';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

// A 1000 s run with 100 s ramp-up and 300 s ramp-down: a 600 s analysis window.
const RUN = {
  duration: 1000,
  start_time: '2026-01-01T10:00:00.000Z',
  end_time: '2026-01-01T10:16:40.000Z',
  analysis_start_offset: 100,
  analysis_end_offset: 300,
};
const TX = [
  { scenario_name: 'scenario-a', transaction_name: 'tx-a', avg_response_time: 50, total_count: 6000, failed_count: 0 },
];

function throughputOf(excludeRampUp: boolean) {
  mockFetch.mockImplementation(async (url: string) => respond(url.includes('/transactions') ? TX : RUN));
  return renderHook(() => useTop10TableData({ testRunId: 'run-1', excludeRampUp }));
}

describe('useTop10TableData throughput divisor', () => {
  beforeEach(() => mockFetch.mockReset());

  it('divides by the analysis window with both offsets out when the toggle is on', async () => {
    const { result } = throughputOf(true);
    await waitFor(() => expect(result.current.top10Data).toHaveLength(1));
    expect(result.current.top10Data[0]!.throughput).toBe(10); // 6000 / 600, not 6000 / 1000
  });

  it('divides by the whole run when the toggle is off', async () => {
    const { result } = throughputOf(false);
    await waitFor(() => expect(result.current.top10Data).toHaveLength(1));
    expect(result.current.top10Data[0]!.throughput).toBe(6);
  });
});
