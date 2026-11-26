import { act, renderHook } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { useGraphsData } from '../hooks/useGraphsData';
import type { SeriesConfig } from '../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceDashboards: jest.fn().mockResolvedValue([]) }));

const fetchMock = authenticatedFetch as jest.Mock;

const series = (id: string, panelId: number, metricName: string): SeriesConfig => ({
  id, dashboardId: 'd1', dashboardLabel: 'JVM', panelId, panelTitle: `P${panelId}`, metricName, source: 'grafana',
});
const ok = (rows: Array<{ metric_name: string; time: string; value: number }>) => ({ ok: true, json: async () => rows });

beforeEach(() => fetchMock.mockReset());

// Value: protects=a marker's "Restore view" / Undo replacing the Graphs chart wholesale, with a
// late reply for an earlier replay never overwriting the newer view, and the "N series no longer
// available" count matching the series that came back empty; fails_when=loadView drops its
// zoomRequestRef guard (last-arrival wins), merges instead of replacing, or counts missing series
// wrongly (e.g. counts the ones WITH data); why_new=no test exercised loadView at all, only
// applyZoomRange's guard is described in CLAUDE.md; seam=none (authenticatedFetch module mock);
// no_claim=the GraphsCard toast wording or Undo wiring (GraphsCard.markers.test.tsx).
describe('useGraphsData.loadView', () => {
  it('drops a late reply for an older replay and keeps the newer view', async () => {
    let releaseOld: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/1?')) return new Promise((r) => { releaseOld = r; });
      return Promise.resolve(ok([{ metric_name: 'c', time: '2026-11-20T10:00:00Z', value: 2 }]));
    });
    const { result } = renderHook(() => useGraphsData({ testRun: null, testRunId: 'run', graphsExpanded: true }));

    let oldDone!: Promise<number>;
    act(() => {
      oldDone = result.current.loadView({ series: [series('a', 1, 'a')], range: null, axisMode: 'overlay', title: 'old' });
    });
    await act(async () => {
      await result.current.loadView({ series: [series('c', 2, 'c')], range: { from: 'f', to: 't' }, axisMode: 'split', title: 'new' });
    });
    expect([...result.current.seriesData.keys()]).toEqual(['c']);

    await act(async () => {
      releaseOld(ok([{ metric_name: 'a', time: '2026-11-20T10:00:00Z', value: 1 }]));
      await oldDone;
    });
    expect([...result.current.seriesData.keys()]).toEqual(['c']);
    expect(result.current.addedSeries.map((s) => s.id)).toEqual(['c']);
    expect(result.current.zoomRange).toEqual({ from: 'f', to: 't' });
    expect(result.current.axisMode).toBe('split');
    expect(result.current.chartName).toBe('new');
    expect(result.current.chartDataLoading).toBe(false);
  });

  it('answers how many series came back with no points', async () => {
    fetchMock.mockResolvedValue(ok([{ metric_name: 'a', time: '2026-11-20T10:00:00Z', value: 1 }]));
    const { result } = renderHook(() => useGraphsData({ testRun: null, testRunId: 'run', graphsExpanded: true }));
    let missing = -1;
    await act(async () => {
      missing = await result.current.loadView({
        series: [series('a', 1, 'a'), series('b', 1, 'b'), series('z', 1, 'gone')],
        range: null, axisMode: 'overlay', title: null,
      });
    });
    expect(missing).toBe(2);
    // One request for the shared panel, plus its raw (members=true) answer for the series it lacked.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.seriesData.get('a')).toHaveLength(1);
    expect(result.current.seriesData.get('b')).toEqual([]);
  });
});
