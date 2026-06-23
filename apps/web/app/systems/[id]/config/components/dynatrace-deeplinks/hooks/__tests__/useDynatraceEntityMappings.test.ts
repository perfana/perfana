/**
 * Unit tests for useDynatraceEntityMappings.
 *
 * Focus: the multi-select + delete-confirmation logic added alongside the
 * Entities-tab feature parity (select-all/one, single-delete confirmation,
 * and batch delete with per-response error detection). The fetch-on-mount
 * paths are mocked; these tests exercise the in-memory selection/delete state
 * machine, which is where a wiring bug would actually bite.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useDynatraceEntityMappings } from '../useDynatraceEntityMappings';
import { DynatraceEntityMapping } from '../../types';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

function makeResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

// Two system-level (level: 'sut') mappings — always visible regardless of the
// selected environment/workload, so filteredMappings is a stable length 2.
const MAPPINGS: DynatraceEntityMapping[] = [
  {
    id: 'm1',
    dynatraceConfigId: 'cfg1',
    systemUnderTestId: 'sut1',
    entityId: 'HOST-1',
    entityDisplayName: 'host-one',
    entityType: 'HOST',
    level: 'sut',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'm2',
    dynatraceConfigId: 'cfg1',
    systemUnderTestId: 'sut1',
    entityId: 'HOST-2',
    entityDisplayName: 'host-two',
    entityType: 'HOST',
    level: 'sut',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const PROPS = { systemId: 'sut1', selectedEnvironment: 'test', selectedWorkload: 'load' };

// Route the mount fetches (GET instances, GET mappings) to stable payloads.
// DELETE handling is overridden per-test where needed.
function routeReadsOk(url: string): Response {
  if (url.startsWith('/dynatrace/entities/mappings')) return makeResponse(MAPPINGS);
  if (url.startsWith('/dynatrace')) return makeResponse([{ id: 'cfg1', label: 'inst' }]);
  return makeResponse([]);
}

async function renderLoaded(onHostQueriesCreated?: () => void) {
  const hook = renderHook(() =>
    useDynatraceEntityMappings({ ...PROPS, onHostQueriesCreated })
  );
  await waitFor(() => expect(hook.result.current.filteredMappings).toHaveLength(2));
  return hook;
}

beforeEach(() => {
  mockAuthFetch.mockReset();
  mockAuthFetch.mockImplementation(async (url: string) => routeReadsOk(url));
});

describe('useDynatraceEntityMappings — selection', () => {
  it('handleSelectAll selects every visible mapping, then clears on a second call', async () => {
    const { result } = await renderLoaded();

    act(() => result.current.handleSelectAll());
    expect(result.current.selectedMappingIds).toEqual(new Set(['m1', 'm2']));

    act(() => result.current.handleSelectAll());
    expect(result.current.selectedMappingIds.size).toBe(0);
  });

  it('handleSelectOne toggles a single id on and off', async () => {
    const { result } = await renderLoaded();

    act(() => result.current.handleSelectOne('m1'));
    expect(result.current.selectedMappingIds).toEqual(new Set(['m1']));

    act(() => result.current.handleSelectOne('m2'));
    expect(result.current.selectedMappingIds).toEqual(new Set(['m1', 'm2']));

    act(() => result.current.handleSelectOne('m1'));
    expect(result.current.selectedMappingIds).toEqual(new Set(['m2']));
  });

  it('handleClearSelection empties the selection', async () => {
    const { result } = await renderLoaded();

    act(() => result.current.handleSelectOne('m1'));
    act(() => result.current.handleClearSelection());
    expect(result.current.selectedMappingIds.size).toBe(0);
  });
});

describe('useDynatraceEntityMappings — single delete confirmation', () => {
  it('handleDeleteEntity opens the dialog without deleting; confirm issues the DELETE', async () => {
    const { result } = await renderLoaded();

    act(() => result.current.handleDeleteEntity(MAPPINGS[0]));
    expect(result.current.deleteDialogOpen).toBe(true);
    expect(result.current.deletingMapping?.id).toBe('m1');
    // Opening the dialog must NOT have fired a DELETE yet.
    expect(mockAuthFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/dynatrace/entities/mappings/m1'),
      expect.objectContaining({ method: 'DELETE' })
    );

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      '/dynatrace/entities/mappings/m1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.deletingMapping).toBeNull();
  });
});

describe('useDynatraceEntityMappings — batch delete', () => {
  it('deletes every selected mapping and clears selection on success', async () => {
    const { result } = await renderLoaded();

    act(() => result.current.handleSelectAll());
    act(() => result.current.handleBatchDeleteClick());
    expect(result.current.batchDeleteDialogOpen).toBe(true);

    await act(async () => {
      await result.current.handleBatchDeleteConfirm();
    });

    const deleteCalls = mockAuthFetch.mock.calls.filter(
      ([, opts]) => (opts as RequestInit | undefined)?.method === 'DELETE'
    );
    expect(deleteCalls.map(([url]) => url).sort()).toEqual([
      '/dynatrace/entities/mappings/m1',
      '/dynatrace/entities/mappings/m2',
    ]);
    expect(result.current.batchDeleteDialogOpen).toBe(false);
    expect(result.current.selectedMappingIds.size).toBe(0);
  });

  it('surfaces an error and keeps the dialog open when any DELETE fails', async () => {
    const { result } = await renderLoaded();

    // m2's DELETE returns a non-ok response; reads stay ok.
    mockAuthFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') {
        return makeResponse({}, !url.includes('/m2'));
      }
      return routeReadsOk(url);
    });

    act(() => result.current.handleSelectAll());
    act(() => result.current.handleBatchDeleteClick());

    await act(async () => {
      await result.current.handleBatchDeleteConfirm();
    });

    expect(result.current.error).toBe('Failed to delete some entity mappings');
    expect(result.current.batchDeleteDialogOpen).toBe(true);
  });
});

describe('useDynatraceEntityMappings — host query refetch callback', () => {
  it('does not fire onHostQueriesCreated for a non-host single delete', async () => {
    const onHostQueriesCreated = jest.fn();
    const { result } = await renderLoaded(onHostQueriesCreated);

    act(() => result.current.handleDeleteEntity(MAPPINGS[0]));
    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    // The callback is only for HOST *adds* (which auto-create queries), never deletes.
    expect(onHostQueriesCreated).not.toHaveBeenCalled();
  });
});
