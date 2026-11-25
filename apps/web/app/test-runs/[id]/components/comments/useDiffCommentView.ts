import { useEffect, useRef } from 'react';
import { DIFF_VIEW_SUMMARY_MAX_LENGTH } from '@perfana/shared/constants/comment-cards';
import type { DiffView } from '@/lib/test-run-comments';
import { useComments } from './CommentsContext';
import type { RunWindows } from '../shared/WithinRunWindowsPicker';

export interface DiffTabState {
  /** The diff tab is the one on screen. */
  open: boolean;
  baselineTestRunId?: string | null;
  /** Set when two time ranges of this run are compared instead of another run. */
  windows?: RunWindows | null;
  resultSummary?: string | null;
}

/**
 * A new root comment on the Distributed tracing or Pyroscope card records the diff tab it was
 * written on: its baseline run or the two time ranges of this run, and on tracing the Compare
 * Traces result. Nothing is recorded on the
 * other tabs. `read` is called when the comment is posted, so it sees the latest state.
 */
export function useDiffCommentView(card: DiffView['kind'], read: () => DiffTabState) {
  const register = useComments()?.registerViewCapture;
  const latest = useRef(read);
  latest.current = read;
  useEffect(
    () =>
      register?.(card, (): DiffView | null => {
        const s = latest.current();
        if (!s.open) return null;
        return {
          kind: card,
          view: 'diff',
          ...(s.windows
            ? { baselineWindowSeconds: s.windows.baseline, currentWindowSeconds: s.windows.current }
            : s.baselineTestRunId
              ? { baselineTestRunId: s.baselineTestRunId }
              : {}),
          // Cut by code points, as the API's Length counts them: a UTF-16 cut can leave half an
          // emoji, which Postgres jsonb refuses (a 500 the drawer's view-less retry does not catch).
          ...(s.resultSummary ? { resultSummary: Array.from(s.resultSummary).slice(0, DIFF_VIEW_SUMMARY_MAX_LENGTH).join('') } : {}),
        };
      }),
    [register, card],
  );
}
