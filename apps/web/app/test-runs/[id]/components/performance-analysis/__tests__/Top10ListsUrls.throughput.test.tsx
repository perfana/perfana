// Value: protects=the Top 10 URLs list shows analysis-window counts per second of the analysis window
// (duration - ramp-up - ramp-down) when the toggle is on, and per second of the whole run when it is
// off; fails_when=the component goes back to `testRunData.duration` or drops the excludeRampUp
// argument; why_new=the transactions and requests lists have hook tests, this one computes its rate
// inside the component and had none; seam=none; no_claim=fetchRunSamplers is mocked, so the samplers
// endpoint and its fallback are not exercised.
import { render, screen } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { fetchRunSamplers } from '../utils/run-samplers';
import Top10ListsUrls from '../Top10ListsUrls';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../utils/run-samplers', () => ({ fetchRunSamplers: jest.fn() }));

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

function renderWith(excludeRampUp: boolean) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => RUN } as Response);
  // Two samplers on one URL: the list sums them before dividing.
  mockSamplers.mockResolvedValue(
    [4000, 2000].map((n, i) => ({
      transaction_name: 'tx-a',
      sampler_name: `GET /a #${i}`,
      scenario_name: 'scenario-a',
      url_pattern: '/a',
      avg_response_time: 50,
      passed_count: n,
      failed_count: 0,
      total_count: n,
    })),
  );
  render(<Top10ListsUrls testRunId="run-1" excludeRampUp={excludeRampUp} />);
}

describe('Top10ListsUrls throughput divisor', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSamplers.mockReset();
  });

  it('divides by the analysis window with both offsets out when the toggle is on', async () => {
    renderWith(true);
    expect(await screen.findByText('10.0/s')).toBeInTheDocument(); // 6000 / 600, not 6000 / 1000
    expect(mockSamplers).toHaveBeenCalledWith('run-1', true);
  });

  it('divides by the whole run when the toggle is off', async () => {
    renderWith(false);
    expect(await screen.findByText('6.00/s')).toBeInTheDocument();
  });
});
