import { useEffect, useRef } from 'react';
import { useComments } from '../../comments/CommentsContext';
import { viewOf, type TrendsView } from '@/lib/test-run-comments';
import { TIME_RANGE_OPTIONS, type TrendsSeries } from '../types';
import { resolveTimeRange } from '../utils/trends-utils';
import type { ToastAction } from '../../../types';
import type { useTrendsData } from './useTrendsData';

/** Most series a comment records, as for Graphs markers (the API's MARKER_MAX_SERIES). */
const MAX_SERIES = 50;

type TrendsData = ReturnType<typeof useTrendsData>;

/**
 * Trends comments record the card's view (series, time range, aggregation) and "Restore view" /
 * the ?comment= deep link replace the chart with it, once per request key, with an Undo
 * (design: test-run comments PR2). An empty chart records nothing.
 */
export function useTrendsCommentView(trends: TrendsData, showToast: (message: string, action?: ToastAction) => void) {
  const comments = useComments();
  const latest = useRef(trends);
  latest.current = trends;

  const register = comments?.registerViewCapture;
  useEffect(
    () =>
      register?.('trends', (): TrendsView | null => {
        const t = latest.current;
        if (t.addedSeries.length === 0) return null;
        // The absolute window, so a relative range ("Last week") replays what the author saw.
        const { from, to } = resolveTimeRange(t.timeRange, t.customTimeRange);
        // A window that cannot be read or runs backwards records no view rather than block the comment.
        if (!(from.getTime() < to.getTime())) return null;
        if (t.addedSeries.length > MAX_SERIES) showToast(`The comment records the first ${MAX_SERIES} of ${t.addedSeries.length} series`);
        return {
          kind: 'trends',
          series: t.addedSeries.slice(0, MAX_SERIES).map((s) => ({
            dashboardId: s.dashboardId,
            dashboardLabel: s.dashboardLabel ?? '',
            panelId: s.panelId,
            panelTitle: s.panelTitle ?? '',
            metricName: s.metricName,
            source: s.source,
            yAxisFormat: s.yAxisFormat,
            metricsSourceId: s.metricsSourceId,
            isAggregated: s.isAggregated,
            colorSlot: s.colorSlot,
            hidden: s.hidden,
          })),
          timeRange: t.timeRange.label,
          customRange: [from.toISOString(), to.toISOString()],
          evaluateType: t.evaluateType,
        };
      }),
    [register, showToast],
  );

  const consumed = useRef(new Set<string>());
  const request = comments?.viewRequest?.card === 'trends' ? comments.viewRequest : null;
  useEffect(() => {
    const view = request ? viewOf(request.comment, 'trends') : null;
    if (!request || !view || consumed.current.has(request.key)) return;
    consumed.current.add(request.key);
    const t = latest.current;
    const previous = {
      series: t.addedSeries,
      timeRange: t.timeRange,
      customTimeRange: t.customTimeRange,
      evaluateType: t.evaluateType,
    };
    const apply = (v: typeof previous) => {
      const now = latest.current;
      now.setAddedSeries(v.series);
      now.handleTimeRangeChange(v.timeRange);
      now.handleCustomTimeRangeChange('from', v.customTimeRange.from);
      now.handleCustomTimeRangeChange('to', v.customTimeRange.to);
      now.handleEvaluateTypeChange(v.evaluateType);
    };
    // A recorded window replays as a custom range; only a view without one keeps its option.
    const range = view.customRange
      ? TIME_RANGE_OPTIONS.find((o) => o.value === 'custom')!
      : (TIME_RANGE_OPTIONS.find((o) => o.label === view.timeRange) ?? t.timeRange);
    apply({
      series: view.series.map(
        (s, i): TrendsSeries => ({
          ...s,
          id: `comment-${request.comment.id}-${s.dashboardId}-${s.panelId}-${s.metricName}-${i}`,
          dashboardLabel: s.dashboardLabel ?? '',
          panelTitle: s.panelTitle ?? '',
          source: s.source as TrendsSeries['source'],
        }),
      ),
      timeRange: range,
      customTimeRange: view.customRange
        ? { from: new Date(view.customRange[0]), to: new Date(view.customRange[1]) }
        : t.customTimeRange,
      evaluateType: view.evaluateType,
    });
    showToast("Showing the comment's view", { label: 'Undo', onClick: () => apply(previous) });
  }, [request, showToast]);
}
