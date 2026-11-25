// Value: protects=the diff-tab capture: null off the diff tab, windows recorded instead of a baseline run,
// the baseline run otherwise, and resultSummary capped at DIFF_VIEW_SUMMARY_MAX_LENGTH; fails_when=the open
// guard, the windows/baseline precedence or the slice is dropped, or read() is captured stale;
// why_new=no test rendered useDiffCommentView; seam=none (useComments mocked); no_claim=posting the comment
import { renderHook } from '@testing-library/react';
import { DIFF_VIEW_SUMMARY_MAX_LENGTH } from '@perfana/shared/constants/comment-cards';
import { useDiffCommentView, type DiffTabState } from '../useDiffCommentView';

const captures = new Map<string, () => unknown>();
jest.mock('../CommentsContext', () => ({
  useComments: () => ({
    registerViewCapture: (card: string, fn: () => unknown) => {
      captures.set(card, fn);
      return () => captures.delete(card);
    },
  }),
}));

describe('useDiffCommentView', () => {
  const setup = (initial: DiffTabState) => {
    let state = initial;
    const hook = renderHook(() => useDiffCommentView('pyroscope', () => state));
    return { set: (s: DiffTabState) => { state = s; }, capture: () => captures.get('pyroscope')!(), hook };
  };

  it('records nothing while the diff tab is closed', () => {
    const { capture } = setup({ open: false, baselineTestRunId: 'b' });
    expect(capture()).toBeNull();
  });

  it('records the two windows instead of a baseline run, read at capture time', () => {
    const { set, capture } = setup({ open: false });
    set({ open: true, baselineTestRunId: 'b', windows: { baseline: [0, 60], current: [120, 180] } });
    expect(capture()).toEqual({ kind: 'pyroscope', view: 'diff', baselineWindowSeconds: [0, 60], currentWindowSeconds: [120, 180] });
  });

  it('records the baseline run and caps the result summary', () => {
    const { capture } = setup({ open: true, baselineTestRunId: 'b', resultSummary: 'x'.repeat(DIFF_VIEW_SUMMARY_MAX_LENGTH + 50) });
    const v = capture() as { baselineTestRunId: string; resultSummary: string; baselineWindowSeconds?: unknown };
    expect(v.baselineTestRunId).toBe('b');
    expect(v.baselineWindowSeconds).toBeUndefined();
    expect(v.resultSummary).toHaveLength(DIFF_VIEW_SUMMARY_MAX_LENGTH);
  });
});
