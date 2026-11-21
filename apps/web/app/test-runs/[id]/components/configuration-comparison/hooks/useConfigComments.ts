import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMENT_ITEM_KEY_MAX_LENGTH,
  COMMENT_ITEM_LABEL_MAX_LENGTH,
  CONFIG_VIEW_VALUE_MAX_LENGTH,
  configCommentItemKey,
} from '@perfana/shared/constants/comment-cards';
import { useCommentItemCounts, useCommentItemFocus, useComments } from '../../comments/CommentsContext';
import { viewOf, type CommentItemCounts, type ConfigView } from '@/lib/test-run-comments';
import type { ToastAction } from '../../../types';
import type { ConfigComparison, RelatedTestRun } from '../types';

/** Code points, so a key is never cut through a surrogate pair. */
const chars = (s: string) => Array.from(s);

/**
 * A config row's comment anchor, or null when its item key would not fit `item_key` (the API
 * would refuse it). Keys that long are not expected; the guard only avoids a 400.
 */
export function configCommentAnchor(configKey: string): { itemKey: string; itemLabel: string } | null {
  const itemKey = configCommentItemKey(configKey);
  if (chars(itemKey).length > COMMENT_ITEM_KEY_MAX_LENGTH) return null;
  return { itemKey, itemLabel: chars(configKey).slice(0, COMMENT_ITEM_LABEL_MAX_LENGTH).join('') };
}

const cap = (v: string | null) => (v === null ? null : chars(v).slice(0, CONFIG_VIEW_VALUE_MAX_LENGTH).join(''));

/** What the comment filter's chip says; null while no comment filter is set. */
export interface ConfigCommentFilter {
  itemKey: string;
  /** The config key, for the chip. */
  label: string;
  /** False while the comparison is still loading, so a missing item is not announced early. */
  ready: boolean;
  exists: boolean;
}

interface ConfigData {
  configComparisons: ConfigComparison[];
  filteredComparisons: ConfigComparison[];
  /** Both runs' configs have answered, so `configComparisons` is the real comparison. */
  comparisonReady: boolean;
  relatedTestRuns: RelatedTestRun[];
  relatedTestRunsLoaded: boolean;
  selectedRelatedTestRun: string;
  handleRelatedTestRunChange: (testRunId: string) => void;
}

/**
 * Comments on the Configuration card (design: test-run-analysis-stories.md, "Item-level comments
 * on the Configuration and Dashboards cards"):
 *
 * - the comment filter: focusing a comment's item shows only the rows with exactly that key,
 *   bypassing (never changing) the user's status, tag and key filters, until "Show all";
 * - the view: a root comment on an item records the comparison it was written against;
 * - Restore view / the deep link select the recorded comparison run again, with an Undo.
 */
export function useConfigComments(
  data: ConfigData,
  expanded: boolean,
  showToast: (message: string, action?: ToastAction) => void,
) {
  const comments = useComments();
  const latest = useRef(data);
  latest.current = data;
  const counts: CommentItemCounts = useCommentItemCounts('config', expanded);

  const [commentFocus, setCommentFocus] = useState<string | null>(null);
  const clearCommentFocus = useCallback(() => setCommentFocus(null), []);
  const matches = (c: ConfigComparison, itemKey: string) => configCommentItemKey(c.key) === itemKey;

  useCommentItemFocus('config', (itemKey) => {
    setCommentFocus(itemKey);
    const d = latest.current;
    return d.comparisonReady && d.configComparisons.some((c) => matches(c, itemKey));
  });

  const visibleComparisons = useMemo(
    () => (commentFocus ? data.configComparisons.filter((c) => matches(c, commentFocus)) : data.filteredComparisons),
    [commentFocus, data.configComparisons, data.filteredComparisons],
  );

  const filter: ConfigCommentFilter | null = commentFocus
    ? {
        itemKey: commentFocus,
        label: commentFocus.startsWith('config:') ? commentFocus.slice('config:'.length) : commentFocus,
        ready: data.comparisonReady,
        exists: visibleComparisons.length > 0,
      }
    : null;

  // The view a new root records: that item's row in the current comparison. Several rows can share
  // a key (different tags); the first that differs is the one worth recording.
  const register = comments?.registerViewCapture;
  useEffect(
    () =>
      register?.('config', (itemKey): ConfigView | null => {
        if (!itemKey) return null;
        const d = latest.current;
        const rows = d.configComparisons.filter((c) => matches(c, itemKey));
        const row = rows.find((c) => c.status !== 'same') ?? rows[0];
        if (!row) return null;
        return {
          kind: 'config',
          ...(d.selectedRelatedTestRun ? { comparedToTestRunId: d.selectedRelatedTestRun } : {}),
          status: row.status,
          currentValue: cap(row.currentValue),
          previousValue: cap(row.previousValue),
        };
      }),
    [register],
  );

  // Restore view / deep link: select the recorded comparison run, once per request key.
  const consumed = useRef(new Set<string>());
  const pending = useRef<{ wanted: string; previous: string; silent: boolean } | null>(null);
  const request = comments?.viewRequest?.card === 'config' ? comments.viewRequest : null;

  const select = useCallback(
    (wanted: string, previous: string, silent = false) => {
      latest.current.handleRelatedTestRunChange(wanted);
      if (silent) return;
      showToast("Showing the comment's view", {
        label: 'Undo',
        onClick: () => latest.current.handleRelatedTestRunChange(previous),
      });
    },
    [showToast],
  );

  useEffect(() => {
    const view = request ? viewOf(request.comment, 'config') : null;
    if (!request || !view || consumed.current.has(request.key)) return;
    consumed.current.add(request.key);
    if (request.comment.itemKey) setCommentFocus(request.comment.itemKey);
    const wanted = view.comparedToTestRunId;
    if (!wanted) return;
    const d = latest.current;
    if (!d.relatedTestRunsLoaded) {
      // Settled once the card's run list arrives (a deep link expands the card in the same commit).
      pending.current = { wanted, previous: d.selectedRelatedTestRun, silent: Boolean(request.silent) };
      return;
    }
    pending.current = null;
    if (d.relatedTestRuns.some((r) => r.test_run_id === wanted)) select(wanted, d.selectedRelatedTestRun, Boolean(request.silent));
    else showToast(`The comment's comparison run ${wanted} is no longer available`);
  }, [request, select, showToast]);

  const loaded = data.relatedTestRunsLoaded;
  const runs = data.relatedTestRuns;
  useEffect(() => {
    const p = pending.current;
    if (!p || !loaded) return;
    pending.current = null;
    // The card auto-selects the previous run as the list arrives; Undo returns there.
    const previous = latest.current.selectedRelatedTestRun || p.previous;
    if (runs.some((r) => r.test_run_id === p.wanted)) select(p.wanted, previous, p.silent);
    else showToast(`The comment's comparison run ${p.wanted} is no longer available`);
  }, [loaded, runs, select, showToast]);

  return { counts, filter, visibleComparisons, clearCommentFocus };
}
