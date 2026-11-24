import { renderHook, waitFor } from '@testing-library/react';
import { useSystemData } from '../useSystemData';

let search = '';
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sut-1' }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(async () => ({ ok: true, json: async () => ({ id: 'sut-1', name: 'S', environments: [] }) })),
}));
for (const mod of ['@/lib/dynatrace', '@/lib/distributed-tracing', '@/lib/pyroscope', '@/lib/splunk', '@/lib/confluence']) {
  jest.mock(mod, () => new Proxy({}, { get: () => jest.fn(async () => []) }));
}

// The direct-id branch used to test the legacy numeric-index list, which lacks the newer tabs,
// so a reload on ?tab=confluence or ?tab=adapt-settings landed on Grafana dashboards.
it.each(['confluence', 'adapt-settings', 'dynatrace'])('opens ?tab=%s', async (tab) => {
  search = `tab=${tab}`;
  const { result } = renderHook(() => useSystemData());
  await waitFor(() => expect(result.current.activeTab).toBe(tab));
});
