// Value: protects=item-level comments on the Configuration card (design:
// test-run-analysis-stories.md, PR1): each row has a comment control keyed `config:<key>` (rows
// sharing a key share it, an overlong key gets none); the comment filter shows exactly the
// comment's key — a `same` item hidden by the default status filter included, `heap.max` never
// matching `heap.max.extra` — says when the key is not in the comparison, and "Show all" brings
// back the user's own filters untouched; a root comment records that item's comparison, capped;
// Restore view selects the recorded run with an Undo, waits for the run list, and says when the run
// is gone; fails_when=the filter writes keyFilter/statusFilters or matches by substring, the item
// key gains the tags, the capture ignores the anchor, or the replay clears the picker for a missing
// run; why_new=new card behaviour; seam=the comments context and the card's data hook are mocked at
// their modules; no_claim=the drawer's posting path (comments.test.tsx) and the API's checks.
import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { CommentView, RunComment } from '@/lib/test-run-comments';
import type { ConfigComparison } from '../types';

const ctx: Record<string, unknown> = {};
let onFocus: ((itemKey: string) => boolean) | undefined;
jest.mock('../../comments/CommentsContext', () => ({
  useComments: () => ctx,
  useCommentItemCounts: () => ({ 'config:heap.max': { threads: 2, unread: 1 } }),
  useCommentItemFocus: (_card: string, fn: (itemKey: string) => boolean) => {
    onFocus = fn;
  },
}));

let configData: Record<string, unknown> = {};
jest.mock('../hooks', () => ({ useConfigComparison: () => configData }));

import ConfigurationComparisonSection from '../ConfigurationComparisonSection';
import { ConfigDiffTable } from '../components/ConfigDiffTable';
import { configCommentAnchor, useConfigComments } from '../hooks/useConfigComments';

const cmp = (key: string, status: ConfigComparison['status'], over: Partial<ConfigComparison> = {}): ConfigComparison => ({
  key,
  currentValue: `${key}-now`,
  previousValue: status === 'new' ? null : `${key}-before`,
  currentTags: [],
  previousTags: [],
  status,
  isExpected: false,
  ...over,
});

const comparisons = [cmp('heap.max', 'changed'), cmp('heap.max.extra', 'changed'), cmp('gc.type', 'same')];
const userFiltered = comparisons.filter((c) => c.status === 'changed');
const run = (id: string) => ({ test_run_id: id, created_at: '2026-11-01T00:00:00Z', completed: true });

function data(over: Record<string, unknown> = {}) {
  return {
    testRunConfigs: comparisons.map((c) => ({ key: c.key, value: c.currentValue, tags: [] })),
    configLoading: false,
    selectedTags: [],
    setSelectedTags: jest.fn(),
    allTags: [],
    keyFilter: 'heap',
    setKeyFilter: jest.fn(),
    relatedTestRuns: [run('App-00006'), run('App-00007')],
    relatedTestRunsLoaded: true,
    selectedRelatedTestRun: 'App-00006',
    selectedConfigLoading: false,
    handleRelatedTestRunChange: jest.fn(),
    statusFilters: ['changed', 'new'],
    setStatusFilters: jest.fn(),
    expectedChangesLoading: false,
    toggleExpectedConfigChange: jest.fn(),
    configComparisons: comparisons,
    filteredComparisons: userFiltered,
    comparisonReady: true,
    accentColor: '#000',
    loadTestRunConfigs: jest.fn(),
    loadRelatedTestRuns: jest.fn(),
    ...over,
  };
}

let capture: ((itemKey?: string | null) => CommentView | null) | undefined;
beforeEach(() => {
  onFocus = undefined;
  capture = undefined;
  configData = data();
  for (const k of Object.keys(ctx)) delete ctx[k];
  Object.assign(ctx, {
    viewRequest: null,
    commentOnItem: jest.fn(),
    registerViewCapture: jest.fn((_card: string, fn: typeof capture) => {
      capture = fn;
      return () => undefined;
    }),
  });
});

const renderCard = () =>
  render(
    <ConfigurationComparisonSection testRun={{ id: 'r' } as never} testRunId="run" configExpanded onConfigExpand={jest.fn()} showToast={jest.fn()} />,
  );
const rowKeys = () => screen.queryAllByTestId('config-row-key').map((el) => el.getAttribute('data-comment-item'));
const focus = (itemKey: string) => act(() => void onFocus!(itemKey));

describe('Configuration card comment controls', () => {
  it('puts a comment control on every row, one item per config key and none for an overlong key', () => {
    const long = 'k'.repeat(1100);
    render(
      <ConfigDiffTable
        comparisons={[cmp('heap.max', 'changed', { currentTags: ['a'] }), cmp('heap.max', 'changed', { currentTags: ['b'] }), cmp(long, 'new')]}
        selectedRelatedTestRun="App-00006"
        testRunConfigs={[]}
        expectedChangesLoading={false}
        onToggleExpectedChange={jest.fn()}
        commentCounts={{ 'config:heap.max': { threads: 2, unread: 1 } }}
      />,
    );
    expect(rowKeys()).toEqual(['config:heap.max', 'config:heap.max', null]);
    expect(screen.getAllByTestId('row-comment-config:heap.max')).toHaveLength(2);
    expect(screen.getAllByLabelText('2 comment threads on heap.max, 1 unread')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /comment/i })).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('row-comment-config:heap.max')[0]!);
    expect(ctx.commentOnItem).toHaveBeenCalledWith('config', 'config:heap.max', 'heap.max');
  });

  it('labels an item by its key, cut to 255 characters, and refuses a key whose item key passes 1,024', () => {
    expect(configCommentAnchor('heap.max')).toEqual({ itemKey: 'config:heap.max', itemLabel: 'heap.max' });
    expect(configCommentAnchor('x'.repeat(400))!.itemLabel).toHaveLength(255);
    expect(configCommentAnchor('x'.repeat(1017))).not.toBeNull();
    expect(configCommentAnchor('x'.repeat(1018))).toBeNull();
  });
});

describe('Configuration card comment filter', () => {
  it("shows a `same` item the default status filter hides, and only that one", () => {
    renderCard();
    expect(rowKeys()).toEqual(['config:heap.max', 'config:heap.max.extra']);
    focus('config:gc.type');
    expect(rowKeys()).toEqual(['config:gc.type']);
    expect(screen.getByTestId('comment-filter-chip')).toHaveTextContent('Showing the item from a comment: gc.type');
  });

  it('matches the key exactly: heap.max does not bring heap.max.extra along', () => {
    renderCard();
    focus('config:heap.max');
    expect(rowKeys()).toEqual(['config:heap.max']);
  });

  it("Show all brings back the user's own filters, which the comment filter never touched", () => {
    renderCard();
    focus('config:gc.type');
    fireEvent.click(within(screen.getByTestId('comment-filter-chip')).getByRole('button', { name: 'Show all' }));
    expect(screen.queryByTestId('comment-filter-chip')).not.toBeInTheDocument();
    expect(rowKeys()).toEqual(['config:heap.max', 'config:heap.max.extra']);
    const d = configData as Record<string, jest.Mock>;
    expect(d.setStatusFilters).not.toHaveBeenCalled();
    expect(d.setKeyFilter).not.toHaveBeenCalled();
    expect(d.setSelectedTags).not.toHaveBeenCalled();
  });

  it('a new focus replaces the previous one', () => {
    renderCard();
    focus('config:gc.type');
    focus('config:heap.max.extra');
    expect(rowKeys()).toEqual(['config:heap.max.extra']);
  });

  it('says when the key is in neither run, but only once the comparison has loaded', () => {
    configData = data({ comparisonReady: false });
    const { rerender } = renderCard();
    let found: boolean | undefined;
    act(() => void (found = onFocus!('config:jvm.opts')));
    expect(found).toBe(false);
    expect(screen.getByTestId('comment-filter-chip')).toHaveTextContent('Showing the item from a comment: jvm.opts');
    configData = data();
    rerender(<ConfigurationComparisonSection testRun={{ id: 'r' } as never} testRunId="run" configExpanded onConfigExpand={jest.fn()} showToast={jest.fn()} />);
    expect(screen.getByTestId('comment-filter-chip')).toHaveTextContent('jvm.opts is not in this comparison');
    expect(rowKeys()).toEqual([]);
  });

  it('reports a focused item as found once it is in the comparison', () => {
    renderCard();
    let found: boolean | undefined;
    act(() => void (found = onFocus!('config:gc.type')));
    expect(found).toBe(true);
  });
});

describe('Configuration comment view', () => {
  const request = (view: Record<string, unknown>, id = 'c1') => ({
    card: 'config',
    key: `comment:${id}:1`,
    comment: { id, cardKey: 'config', itemKey: 'config:heap.max', chartContext: { kind: 'config', status: 'changed', ...view } } as unknown as RunComment,
  });

  it("records the anchored item's comparison, and nothing without an item or for an unknown one", () => {
    const long = 'v'.repeat(2500);
    configData = data({ configComparisons: [...comparisons, cmp('big', 'changed', { currentValue: long, previousValue: null })] });
    renderHook(() => useConfigComments(configData as never, true, jest.fn()));
    expect(capture?.('config:heap.max')).toEqual({
      kind: 'config',
      comparedToTestRunId: 'App-00006',
      status: 'changed',
      currentValue: 'heap.max-now',
      previousValue: 'heap.max-before',
    });
    expect(capture?.('config:gc.type')).toMatchObject({ status: 'same' });
    const big = capture?.('config:big') as { currentValue: string; previousValue: null };
    expect(big.currentValue).toHaveLength(2000);
    expect(big.previousValue).toBeNull();
    expect(capture?.(null)).toBeNull();
    expect(capture?.('config:nope')).toBeNull();
  });

  it('prefers the row that differs when tags split one key into several rows', () => {
    configData = data({ configComparisons: [cmp('k', 'same'), cmp('k', 'changed', { currentValue: 'b' })] });
    renderHook(() => useConfigComments(configData as never, true, jest.fn()));
    expect(capture?.('config:k')).toMatchObject({ status: 'changed', currentValue: 'b' });
  });

  it('Restore view selects the recorded comparison run, filters to the item, and Undo goes back', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request({ comparedToTestRunId: 'App-00007' });
    const { result } = renderHook(() => useConfigComments(configData as never, true, showToast));
    const change = (configData as Record<string, jest.Mock>).handleRelatedTestRunChange!;
    expect(change).toHaveBeenCalledWith('App-00007');
    expect(result.current.filter).toMatchObject({ itemKey: 'config:heap.max', exists: true });
    expect(showToast.mock.calls[0]![0]).toBe("Showing the comment's view");
    act(() => showToast.mock.calls[0]![1].onClick());
    expect(change).toHaveBeenLastCalledWith('App-00006');
  });

  it('replays each request once', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request({ comparedToTestRunId: 'App-00007' });
    const { rerender } = renderHook(() => useConfigComments(configData as never, true, showToast));
    rerender();
    expect((configData as Record<string, jest.Mock>).handleRelatedTestRunChange).toHaveBeenCalledTimes(1);
  });

  it('leaves the picker alone and says so when the recorded run is no longer offered', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request({ comparedToTestRunId: 'App-00001' });
    renderHook(() => useConfigComments(configData as never, true, showToast));
    expect((configData as Record<string, jest.Mock>).handleRelatedTestRunChange).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("The comment's comparison run App-00001 is no longer available");
  });

  it('waits for the run list when the card has not loaded it yet', () => {
    const showToast = jest.fn();
    ctx.viewRequest = request({ comparedToTestRunId: 'App-00007' });
    configData = data({ relatedTestRuns: [], relatedTestRunsLoaded: false, selectedRelatedTestRun: '' });
    const change = (configData as Record<string, jest.Mock>).handleRelatedTestRunChange!;
    const { rerender } = renderHook(({ d }) => useConfigComments(d as never, true, showToast), { initialProps: { d: configData } });
    expect(change).not.toHaveBeenCalled();
    // The list arrives and the card auto-selects the previous run; the comment's run wins, Undo returns there.
    rerender({ d: { ...configData, relatedTestRuns: [run('App-00006'), run('App-00007')], relatedTestRunsLoaded: true, selectedRelatedTestRun: 'App-00006' } });
    expect(change).toHaveBeenCalledWith('App-00007');
    act(() => showToast.mock.calls[0]![1].onClick());
    expect(change).toHaveBeenLastCalledWith('App-00006');
  });
});
