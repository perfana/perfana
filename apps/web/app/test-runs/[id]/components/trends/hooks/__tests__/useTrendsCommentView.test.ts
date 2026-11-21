// Value: protects=a Trends comment records the card's series, time range (with the custom window)
// and aggregation, an empty chart records nothing, and Restore view applies all three once per key
// with an Undo that puts the previous view back; fails_when=the capture drops the range or the
// aggregation, captures an empty chart (the API 400s), the replay skips one of the setters, replays a
// seen key, or Undo restores the replayed view; why_new=new hook; seam=none (the comments context is
// mocked at its module); no_claim=useTrendsData's own fetching.
import { renderHook } from '@testing-library/react';
import { useTrendsCommentView } from '../useTrendsCommentView';
import { TIME_RANGE_OPTIONS } from '../../types';
import type { CommentView, RunComment } from '@/lib/test-run-comments';

const ctx: Record<string, unknown> = {};
jest.mock('../../../comments/CommentsContext', () => ({ useComments: () => ctx }));

const series = (id: string) => ({ id, dashboardId: 'd', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: id, source: 'grafana' as const });
const week = TIME_RANGE_OPTIONS[3];
const requestKey = (id: string) => `comment:${id}:1`;
const custom = TIME_RANGE_OPTIONS.find((o) => o.label === 'Custom')!;

function trendsData(over: Record<string, unknown> = {}) {
  return {
    addedSeries: [series('used')],
    timeRange: week,
    customTimeRange: { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-20T00:00:00Z') },
    evaluateType: 'avg',
    setAddedSeries: jest.fn(),
    handleTimeRangeChange: jest.fn(),
    handleCustomTimeRangeChange: jest.fn(),
    handleEvaluateTypeChange: jest.fn(),
    ...over,
  } as never;
}

let capture: (() => CommentView | null) | undefined;
beforeEach(() => {
  capture = undefined;
  Object.assign(ctx, {
    viewRequest: null,
    registerViewCapture: jest.fn((_card: string, fn: () => CommentView | null) => {
      capture = fn;
      return () => undefined;
    }),
  });
});

describe('useTrendsCommentView', () => {
  it('records series, range with the custom window, and aggregation; nothing for an empty chart', () => {
    const { rerender } = renderHook(({ d }) => useTrendsCommentView(d, jest.fn()), {
      initialProps: { d: trendsData({ timeRange: custom, evaluateType: 'p95' }) },
    });
    expect(capture?.()).toEqual(expect.objectContaining({
      kind: 'trends',
      timeRange: 'Custom',
      customRange: ['2026-11-01T00:00:00.000Z', '2026-11-20T00:00:00.000Z'],
      evaluateType: 'p95',
      series: [expect.objectContaining({ metricName: 'used', panelId: 3 })],
    }));
    rerender({ d: trendsData({ addedSeries: [] }) });
    expect(capture?.()).toBeNull();
  });

  // A backwards custom window would have the API refuse the view and with it the comment.
  it('records nothing for a custom window that runs backwards', () => {
    renderHook(() => useTrendsCommentView(trendsData({ timeRange: custom, customTimeRange: { from: new Date('2026-11-20T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') } }), jest.fn()));
    expect(capture?.()).toBeNull();
  });

  // "Last week" is relative to now; replaying it next month would show other runs.
  it('records the absolute window of a relative range and replays it as a custom one', () => {
    renderHook(() => useTrendsCommentView(trendsData(), jest.fn()));
    const view = capture?.() as { timeRange: string; customRange: [string, string] };
    expect(view.timeRange).toBe('Last week');
    const [from, to] = view.customRange.map((t) => Date.parse(t));
    expect(Math.round((to! - from!) / 86_400_000)).toBe(7);

    const data = trendsData();
    ctx.viewRequest = {
      card: 'trends',
      key: requestKey('c2'),
      comment: { id: 'c2', cardKey: 'trends', chartContext: { kind: 'trends', series: [series('rt')], ...view, evaluateType: 'avg' } } as unknown as RunComment,
    };
    renderHook(() => useTrendsCommentView(data, jest.fn()));
    const d = data as unknown as Record<string, jest.Mock>;
    expect(d.handleTimeRangeChange!).toHaveBeenCalledWith(custom);
    expect(d.handleCustomTimeRangeChange!).toHaveBeenCalledWith('from', new Date(view.customRange[0]));
  });

  it('replays a view once per key and Undo restores the previous one', () => {
    const data = trendsData();
    const showToast = jest.fn();
    const comment = {
      id: 'c1',
      cardKey: 'trends',
      chartContext: { kind: 'trends', series: [series('rt')], timeRange: 'Last month', evaluateType: 'p99' },
    } as unknown as RunComment;
    ctx.viewRequest = { card: 'trends', key: 'comment:c1:1', comment };
    const { rerender } = renderHook(() => useTrendsCommentView(data, showToast));
    const d = data as unknown as Record<string, jest.Mock>;
    expect(d.setAddedSeries!).toHaveBeenCalledWith([expect.objectContaining({ metricName: 'rt' })]);
    expect(d.handleTimeRangeChange!).toHaveBeenCalledWith(expect.objectContaining({ label: 'Last month' }));
    expect(d.handleEvaluateTypeChange!).toHaveBeenCalledWith('p99');

    ctx.viewRequest = { ...(ctx.viewRequest as object) };
    rerender();
    expect(d.setAddedSeries!).toHaveBeenCalledTimes(1);

    const [, undo] = showToast.mock.calls[0]!;
    undo.onClick();
    expect(d.setAddedSeries!).toHaveBeenLastCalledWith([expect.objectContaining({ metricName: 'used' })]);
    expect(d.handleTimeRangeChange!).toHaveBeenLastCalledWith(week);
    expect(d.handleEvaluateTypeChange!).toHaveBeenLastCalledWith('avg');
  });

  // Stories design, "View preservation": a story step replays silently, and its Exit can put back an
  // empty chart without touching the range or the aggregation.
  it('replays a silent request without the Undo toast, and clears the series for the empty restore view', () => {
    const data = trendsData();
    const showToast = jest.fn();
    ctx.viewRequest = {
      card: 'trends',
      key: 'comment:c3:1',
      silent: true,
      comment: { id: 'c3', cardKey: 'trends', chartContext: { kind: 'trends', series: [series('rt')], timeRange: 'Last month', evaluateType: 'p99' } } as unknown as RunComment,
    };
    const { rerender } = renderHook(() => useTrendsCommentView(data, showToast));
    const d = data as unknown as Record<string, jest.Mock>;
    expect(d.setAddedSeries!).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();

    ctx.viewRequest = {
      card: 'trends',
      key: 'restore:trends:2',
      silent: true,
      comment: { id: 'restore-2', cardKey: 'trends', chartContext: { kind: 'trends', series: [], timeRange: '', evaluateType: '' } } as unknown as RunComment,
    };
    rerender();
    expect(d.setAddedSeries!).toHaveBeenLastCalledWith([]);
    expect(d.handleEvaluateTypeChange!).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });
});
