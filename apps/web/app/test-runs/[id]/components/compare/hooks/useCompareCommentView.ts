import { useEffect, useRef } from 'react';
import { useComments } from '../../comments/CommentsContext';
import { viewOf, type CompareView } from '@/lib/test-run-comments';
import type { CompareSeries } from '../types/compare.types';
import type { ToastAction } from '../../../types';
import type { useCompareData } from './useCompareData';

/** Most series a comment records, as for Graphs markers (the API's MARKER_MAX_SERIES). */
const MAX_SERIES = 50;

type CompareData = ReturnType<typeof useCompareData>;

/**
 * Compare comments record the card's view (series and baseline), and "Restore view" / the
 * ?comment= deep link replace the table with it, once per request key, with an Undo (design:
 * test-run comments PR2). A baseline that is no longer offered leaves the picker alone, as a
 * preset's does. An empty table records nothing.
 */
export function useCompareCommentView(compare: CompareData, showToast: (message: string, action?: ToastAction) => void) {
  const comments = useComments();
  const latest = useRef(compare);
  latest.current = compare;

  const register = comments?.registerViewCapture;
  useEffect(
    () =>
      register?.('compare', (): CompareView | null => {
        const c = latest.current;
        if (c.addedSeries.length === 0) return null;
        if (c.addedSeries.length > MAX_SERIES) showToast(`The comment records the first ${MAX_SERIES} of ${c.addedSeries.length} series`);
        return {
          kind: 'compare',
          series: c.addedSeries.slice(0, MAX_SERIES).map((s) => ({
            dashboardId: s.dashboardId,
            // The API's series shape requires both strings; a missing one would refuse the whole view.
            dashboardLabel: s.dashboardLabel ?? '',
            panelId: s.panelId,
            panelTitle: s.panelTitle ?? '',
            metricName: s.metricName,
            source: s.source,
            metricsSourceId: s.metricsSourceId,
            yAxesFormat: s.yAxesFormat,
            isAggregated: s.isAggregated,
          })),
          ...(c.selectedTestRun ? { baselineTestRunId: c.selectedTestRun.test_run_id } : {}),
        };
      }),
    [register, showToast],
  );

  const consumed = useRef(new Set<string>());
  // A baseline asked for before the card has loaded its options (a deep link or Restore view on a
  // collapsed card expands it in the same commit). Resolved once the options arrive.
  const pendingBaseline = useRef<string | null>(null);
  const request = comments?.viewRequest?.card === 'compare' ? comments.viewRequest : null;
  useEffect(() => {
    const view = request ? viewOf(request.comment, 'compare') : null;
    if (!request || !view || consumed.current.has(request.key)) return;
    consumed.current.add(request.key);
    const c = latest.current;
    const previous = { series: c.addedSeries, baseline: c.selectedTestRun };
    const apply = (v: typeof previous) => {
      latest.current.setAddedSeries(v.series);
      latest.current.setSelectedTestRun(v.baseline);
    };
    const wanted = view.baselineTestRunId ?? null;
    const baseline = wanted ? (c.baselineOptions.find((r) => r.test_run_id === wanted) ?? null) : null;
    // Not offered yet and the options are still loading: settle it once both halves have answered.
    pendingBaseline.current = wanted && !baseline && !c.baselineOptionsLoaded ? wanted : null;
    apply({
      series: view.series.map(
        (s, i): CompareSeries => ({
          ...s,
          id: `comment-${request.comment.id}-${s.dashboardId}-${s.panelId}-${s.metricName}-${i}`,
          dashboardLabel: s.dashboardLabel ?? '',
          panelTitle: s.panelTitle ?? '',
          source: s.source as CompareSeries['source'],
        }),
      ),
      // A baseline no longer offered keeps the current one rather than clearing it.
      baseline: baseline ?? c.selectedTestRun,
    });
    const lost = wanted && !baseline && !pendingBaseline.current ? ` · baseline ${wanted} is no longer available` : '';
    showToast(`Showing the comment's view${lost}`, {
      label: 'Undo',
      onClick: () => {
        pendingBaseline.current = null;
        apply(previous);
      },
    });
  }, [request, showToast]);

  const options = compare.baselineOptions;
  const loaded = compare.baselineOptionsLoaded;
  const chosen = compare.selectedTestRun?.test_run_id;
  useEffect(() => {
    const wanted = pendingBaseline.current;
    if (!wanted) return;
    const found = options.find((r) => r.test_run_id === wanted);
    if (found) {
      pendingBaseline.current = null;
      latest.current.setSelectedTestRun(found);
    } else if (loaded) {
      pendingBaseline.current = null;
      showToast(`The comment's baseline ${wanted} is no longer available`);
    }
  }, [options, loaded, showToast]);

  // A baseline the user picks while one is still pending wins: drop the pending one.
  const pickedAt = useRef(chosen);
  useEffect(() => {
    if (pickedAt.current !== chosen && chosen !== undefined && chosen !== pendingBaseline.current) pendingBaseline.current = null;
    pickedAt.current = chosen;
  }, [chosen]);
}
