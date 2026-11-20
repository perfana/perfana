// Value: protects=a Compare comment records the card's series and baseline, an empty table records
// nothing, and Restore view applies both once with an Undo; a baseline no longer offered keeps the
// current one and says so; fails_when=the capture drops the baseline, captures an empty table, the
// replay clears the picker for a missing baseline, or Undo restores the replayed view; why_new=new
// hook; seam=none (the comments context is mocked at its module); no_claim=useCompareData's fetching.
import { renderHook } from '@testing-library/react';
import { useCompareCommentView } from '../useCompareCommentView';
import type { CommentView, RunComment } from '@/lib/test-run-comments';

const ctx: Record<string, unknown> = {};
jest.mock('../../../comments/CommentsContext', () => ({ useComments: () => ctx }));

const series = (id: string) => ({ id, dashboardId: 'd', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: id, source: 'grafana' as const });
const run = (id: string) => ({ test_run_id: id }) as never;

function compareData(over: Record<string, unknown> = {}) {
  return {
    addedSeries: [series('used')],
    selectedTestRun: run('App-00006'),
    baselineOptions: [run('control-group'), run('App-00006'), run('App-00007')],
    baselineOptionsLoaded: true,
    setAddedSeries: jest.fn(),
    setSelectedTestRun: jest.fn(),
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

const request = (baselineTestRunId?: string) => ({
  card: 'compare',
  key: 'comment:c1:1',
  comment: { id: 'c1', cardKey: 'compare', chartContext: { kind: 'compare', series: [series('rt')], baselineTestRunId } } as unknown as RunComment,
});

describe('useCompareCommentView', () => {
  it('records series and baseline; nothing for an empty table', () => {
    const { rerender } = renderHook(({ d }) => useCompareCommentView(d, jest.fn()), { initialProps: { d: compareData() } });
    expect(capture?.()).toEqual(expect.objectContaining({
      kind: 'compare',
      baselineTestRunId: 'App-00006',
      series: [expect.objectContaining({ metricName: 'used' })],
    }));
    rerender({ d: compareData({ addedSeries: [] }) });
    expect(capture?.()).toBeNull();
  });

  it('replays series and baseline, and Undo restores the previous ones', () => {
    const data = compareData();
    const showToast = jest.fn();
    ctx.viewRequest = request('App-00007');
    renderHook(() => useCompareCommentView(data, showToast));
    const d = data as unknown as Record<string, jest.Mock>;
    expect(d.setAddedSeries!).toHaveBeenCalledWith([expect.objectContaining({ metricName: 'rt' })]);
    expect(d.setSelectedTestRun!).toHaveBeenCalledWith(expect.objectContaining({ test_run_id: 'App-00007' }));
    showToast.mock.calls[0]![1].onClick();
    expect(d.setSelectedTestRun!).toHaveBeenLastCalledWith(expect.objectContaining({ test_run_id: 'App-00006' }));
    expect(d.setAddedSeries!).toHaveBeenLastCalledWith([expect.objectContaining({ metricName: 'used' })]);
  });

  it('keeps the current baseline when the recorded one is no longer offered', () => {
    const data = compareData();
    const showToast = jest.fn();
    ctx.viewRequest = request('App-00001');
    renderHook(() => useCompareCommentView(data, showToast));
    expect((data as unknown as Record<string, jest.Mock>).setSelectedTestRun!).toHaveBeenCalledWith(expect.objectContaining({ test_run_id: 'App-00006' }));
    expect(showToast.mock.calls[0]![0]).toMatch(/baseline App-00001 is no longer available/);
  });

  // A deep link or Restore view on a collapsed card replays before the card has loaded its options,
  // and the control group and the related runs then arrive separately, in either order.
  it.each([
    ['the control group first', [run('control-group')], 'App-00007'],
    ['the related runs first', [run('App-00006'), run('App-00007')], 'control-group'],
  ])('waits for both halves when %s arrives', (_label, partial, wanted) => {
    const showToast = jest.fn();
    ctx.viewRequest = request(wanted as string);
    const d = (over: Record<string, unknown>) => compareData({ selectedTestRun: null, ...over });
    const { rerender } = renderHook(({ x }) => useCompareCommentView(x, showToast), {
      initialProps: { x: d({ baselineOptions: [], baselineOptionsLoaded: false }) },
    });
    expect(showToast.mock.calls[0]![0]).not.toMatch(/no longer available/);
    rerender({ x: d({ baselineOptions: partial, baselineOptionsLoaded: false }) });
    expect(showToast.mock.calls.some(([m]) => /no longer available/.test(m))).toBe(false);
    const full = d({});
    rerender({ x: full });
    expect((full as unknown as Record<string, jest.Mock>).setSelectedTestRun!).toHaveBeenCalledWith(expect.objectContaining({ test_run_id: wanted }));
  });

  it('says a pending baseline is gone only after both halves load without it', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request('App-00001');
    const { rerender } = renderHook(({ d }) => useCompareCommentView(d, showToast), {
      initialProps: { d: compareData({ baselineOptions: [], baselineOptionsLoaded: false }) },
    });
    rerender({ d: compareData() });
    expect(showToast).toHaveBeenLastCalledWith("The comment's baseline App-00001 is no longer available");
  });

  it('drops a pending baseline once the user picks another one', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request('App-00007');
    const { rerender } = renderHook(({ d }) => useCompareCommentView(d, showToast), {
      initialProps: { d: compareData({ baselineOptions: [], baselineOptionsLoaded: false, selectedTestRun: null }) },
    });
    rerender({ d: compareData({ baselineOptions: [], baselineOptionsLoaded: false, selectedTestRun: run('App-00006') }) });
    const later = compareData({ selectedTestRun: run('App-00006') });
    rerender({ d: later });
    expect((later as unknown as Record<string, jest.Mock>).setSelectedTestRun!).not.toHaveBeenCalled();
  });
});
