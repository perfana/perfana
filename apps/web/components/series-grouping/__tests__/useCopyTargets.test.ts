import { renderHook, waitFor } from '@testing-library/react';
import { copyTargetsFrom, useCopyTargets } from '@/components/series-grouping/useCopyTargets';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const environments = [
  { environment: 'prod', workloads: ['peak', 'soak'] },
  { environment: 'acc', workloads: ['peak'] },
  { environment: 'empty' },
];

describe('copyTargetsFrom', () => {
  it('lists every other workload of the system, across environments', () => {
    expect(copyTargetsFrom(environments, 'prod', 'peak')).toEqual([
      { testEnvironment: 'prod', workload: 'soak' },
      { testEnvironment: 'acc', workload: 'peak' },
    ]);
  });

  it('tolerates a system without environments', () => {
    expect(copyTargetsFrom(undefined, 'prod', 'peak')).toEqual([]);
  });
});

describe('useCopyTargets', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches nothing until enabled', () => {
    renderHook(() => useCopyTargets('sut-1', 'prod', 'peak', false));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads the system once enabled', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ environments }) } as unknown as Response);
    const { result } = renderHook(() => useCopyTargets('sut-1', 'prod', 'peak', true));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(mockFetch).toHaveBeenCalledWith('/systems-under-test/sut-1');
  });

  it('offers no targets when the system cannot be read', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as unknown as Response);
    const { result } = renderHook(() => useCopyTargets('sut-1', 'prod', 'peak', true));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
