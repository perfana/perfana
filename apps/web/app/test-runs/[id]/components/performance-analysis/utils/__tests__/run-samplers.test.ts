jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

import { authenticatedFetch } from '@/lib/api';
import { fetchRunSamplers } from '../run-samplers';

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const res = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response;

const row = { transaction_name: 'T1', sampler_name: 'S1', url_pattern: null, avg_response_time: 1, passed_count: 1, failed_count: 0, total_count: 1 };

beforeEach(() => mockFetch.mockReset());

it('takes the one-shot samplers route when it answers 200', async () => {
  mockFetch.mockResolvedValueOnce(res(200, [row]));
  await expect(fetchRunSamplers('run', true)).resolves.toEqual([row]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][0]).toBe('/test-runs/run/samplers?excludeRampUp=true');
});

it('falls back to one samples call per transaction when the run has no rollup (404)', async () => {
  mockFetch
    .mockResolvedValueOnce(res(404, { message: 'no rollup' }))
    .mockResolvedValueOnce(res(200, [{ transaction_name: 'T1', scenario_name: 'sc' }, { transaction_name: 'T2' }]))
    .mockResolvedValueOnce(res(200, [{ sampler_name: 'S1', total_count: 1 }]))
    .mockResolvedValueOnce(res(202, { status: 'rollup-pending' })); // skipped, as before
  const out = await fetchRunSamplers('run', false);
  expect(out).toEqual([{ sampler_name: 'S1', total_count: 1, transaction_name: 'T1', scenario_name: 'sc' }]);
  expect(mockFetch).toHaveBeenCalledTimes(4);
  expect(mockFetch.mock.calls[2][0]).toBe('/test-runs/run/transactions/T1/samples?excludeRampUp=false');
});
