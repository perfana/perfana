/**
 * The axis layout a preset remembers.
 *
 * `axisMode` is the only chart-level option the Graphs card persists, and it travels
 * through `chartOptions` — a loosely typed bag on both sides of the API. So neither end
 * of this round trip is protected by a type: drop it from the POST body and a reopened
 * preset silently reverts to overlay; read the wrong key back and a split-lane chart
 * comes back overlaid, with four unit families crushed onto two axes.
 *
 * The backward-compatible branch matters just as much. Every preset saved before the
 * chart standard has no `chartOptions` at all, and those were all drawn overlaid, so the
 * absent case has to resolve to `'overlay'` rather than to `undefined` — the setter is
 * typed `'overlay' | 'split'` and an undefined would leave the card's state untouched at
 * whatever the previous preset set it to.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGraphsPresets } from '@/app/test-runs/[id]/components/graphs/hooks/useGraphsPresets';
import type { GraphPreset } from '@/lib/graph-presets';

const authenticatedFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  authenticatedFetch: (...args: unknown[]) => authenticatedFetch(...args),
}));

// `fetchPresets` goes through the typed client; the saves go through `authenticatedFetch`
// directly. Both have to be in hand to reach the upsert branch.
const getAll = jest.fn().mockResolvedValue([]);
jest.mock('@/lib/graph-presets', () => ({
  ...jest.requireActual('@/lib/graph-presets'),
  GraphPresetsAPI: { getAll: (...args: unknown[]) => getAll(...args) },
}));

const ok = (body: unknown = []) => ({
  ok: true,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const setup = (axisMode: 'overlay' | 'split' = 'overlay') => {
  const setAxisMode = jest.fn();
  const showToast = jest.fn();
  const { result } = renderHook(() =>
    useGraphsPresets({
      testRun: null,
      testRunId: 'run-001',
      showToast,
      addedSeries: [],
      axisMode,
      setAxisMode,
      setAddedSeries: jest.fn(),
      setSeriesData: jest.fn(),
      setChartDataLoading: jest.fn(),
      fetchSeriesData: jest.fn().mockResolvedValue([]),
    } as never),
  );
  return { result, setAxisMode, showToast };
};

const preset = (over: Partial<GraphPreset> = {}): GraphPreset => ({
  id: 'p1',
  name: 'Heap',
  seriesConfig: [],
  testRunId: 'run-001',
  isGlobal: false,
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
  ...over,
} as GraphPreset);

/**
 * The hook reads the caller's id out of the stored JWT, and the upsert match requires it:
 * `presets` legitimately contains OTHER people's global presets, so a preset only counts
 * as "the same one" when the caller owns it. Without a token every save is a create.
 */
const token = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString('base64')}.s`;

beforeEach(() => {
  authenticatedFetch.mockReset();
  authenticatedFetch.mockResolvedValue(ok());
  getAll.mockReset();
  getAll.mockResolvedValue([]);
  sessionStorage.setItem('perfana_access_token', token('u1'));
});

afterEach(() => {
  sessionStorage.clear();
});

describe('saving the axis mode', () => {
  it('sends the card\'s current mode on a create', async () => {
    const { result } = setup('split');

    await act(async () => {
      await result.current.handleSavePreset({
        name: 'Heap', description: '', is_global: false, test_run_id: 'run-001',
      } as never);
    });

    const create = authenticatedFetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(create).toBeDefined();
    expect(JSON.parse((create![1] as { body: string }).body).chartOptions)
      .toEqual({ axisMode: 'split' });
  });

  it('sends it on an upsert too, so editing a preset cannot silently reset its layout', async () => {
    // A preset the caller owns, same name and scope: handleSavePreset PATCHes it.
    // Not `mockResolvedValueOnce`: the hook fetches on mount, which would consume it.
    getAll.mockResolvedValue([preset()]);
    const { result } = setup('split');
    await act(async () => { await result.current.fetchPresets(); });
    await waitFor(() => expect(result.current.presets).toHaveLength(1));

    await act(async () => {
      await result.current.handleSavePreset({
        name: 'Heap', description: '', is_global: false, test_run_id: 'run-001',
      } as never);
    });

    const patch = authenticatedFetch.mock.calls.find((c) => c[1]?.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(JSON.parse((patch![1] as { body: string }).body).chartOptions)
      .toEqual({ axisMode: 'split' });
  });
});

describe('restoring the axis mode', () => {
  it('applies a stored split', async () => {
    const { result, setAxisMode } = setup();
    await act(async () => {
      await result.current.handleLoadPreset(preset({ chartOptions: { axisMode: 'split' } }));
    });
    expect(setAxisMode).toHaveBeenCalledWith('split');
  });

  it('falls back to overlay for a preset saved before the standard', async () => {
    const { result, setAxisMode } = setup('split');
    await act(async () => { await result.current.handleLoadPreset(preset()); });
    // Explicitly 'overlay', not undefined: the card would otherwise keep whatever the
    // previously loaded preset left it at.
    expect(setAxisMode).toHaveBeenCalledWith('overlay');
  });

  it('falls back to overlay for a chartOptions carrying some other key', async () => {
    const { result, setAxisMode } = setup('split');
    await act(async () => {
      await result.current.handleLoadPreset(
        preset({ chartOptions: { showLegend: true } as never }),
      );
    });
    expect(setAxisMode).toHaveBeenCalledWith('overlay');
  });
});
