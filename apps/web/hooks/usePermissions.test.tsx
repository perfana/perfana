import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePermissions } from './usePermissions';

jest.mock('@/lib/api/permissions', () => ({
  fetchPermissions: jest.fn(),
}));
const { fetchPermissions } = require('@/lib/api/permissions');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePermissions', () => {
  beforeEach(() => fetchPermissions.mockReset());

  it('returns can(action, ctx) that resolves from byOrg map', async () => {
    fetchPermissions.mockResolvedValue({
      userId: 'u',
      global: [],
      byOrg: { 'org-a': ['integration:dynatrace:update'] },
    });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-a' })).toBe(true);
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-b' })).toBe(false);
  });

  it('returns can(action) that resolves from global capabilities', async () => {
    fetchPermissions.mockResolvedValue({
      userId: 'u',
      global: ['system:manage-users'],
      byOrg: {},
    });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.can('system:manage-users')).toBe(true);
  });

  it('returns false during initial load', () => {
    fetchPermissions.mockResolvedValue({ userId: 'u', global: [], byOrg: {} });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.can('anything')).toBe(false);
  });

  it('reads resourcePermissions when prop is provided, ignores capabilities', async () => {
    fetchPermissions.mockResolvedValue({ userId: 'u', global: [], byOrg: {} });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    // Resource grants update, capabilities don't — resource wins.
    expect(
      result.current.can('integration:dynatrace:update', {
        organizationId: 'org-a',
        resourcePermissions: { 'integration:dynatrace:update': true },
      }),
    ).toBe(true);
  });

  it('falls back to capabilities when action is not in resourcePermissions', async () => {
    fetchPermissions.mockResolvedValue({
      userId: 'u',
      global: [],
      byOrg: { 'org-a': ['integration:dynatrace:update'] },
    });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    // resourcePermissions doesn't list this action — fall through to byOrg.
    expect(
      result.current.can('integration:dynatrace:update', {
        organizationId: 'org-a',
        resourcePermissions: { delete: true },
      }),
    ).toBe(true);
  });

  it('returns false in error state (isError = true)', async () => {
    fetchPermissions.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(false));
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-a' })).toBe(false);
  });

  it('refetches on org-switch via React Query invalidation', async () => {
    fetchPermissions
      .mockResolvedValueOnce({ userId: 'u', global: [], byOrg: { 'org-a': ['integration:dynatrace:update'] } })
      .mockResolvedValueOnce({ userId: 'u', global: [], byOrg: { 'org-b': [] } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePermissions(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-a' })).toBe(true);

    // Simulate org switch — context calls this on every change.
    queryClient.invalidateQueries({ queryKey: ['permissions'] });

    await waitFor(() => expect(fetchPermissions).toHaveBeenCalledTimes(2));
    // Wait for the refetch to complete and the new data to be reflected in the hook.
    await waitFor(() =>
      expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-a' })).toBe(false),
    );
  });
});
