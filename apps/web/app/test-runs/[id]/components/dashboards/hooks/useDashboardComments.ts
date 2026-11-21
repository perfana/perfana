import { useCallback, useMemo, useRef, useState } from 'react';
import { dashboardCommentItemKey } from '@perfana/shared/constants/comment-cards';
import { useCommentItemCounts, useCommentItemFocus } from '../../comments/CommentsContext';
import type { CommentItemCounts } from '@/lib/test-run-comments';
import type { Dashboard } from '../types';
import { dashboardCommentAnchor } from '../components/DashboardCard';

/** What the comment filter's chip says; null while no comment filter is set. */
export interface DashboardCommentFilter {
  itemKey: string;
  label: string;
  /** False while the list is still loading, so a missing dashboard is not announced early. */
  ready: boolean;
  exists: boolean;
}

/**
 * Comments on the Dashboards card (design: test-run-analysis-stories.md, "Item-level comments
 * on the Configuration and Dashboards cards"). Focusing a comment's dashboard shows that tile
 * alone, bypassing (never changing) the search text and selected tags, until "Show all".
 */
export function useDashboardComments(
  data: { dashboards: Dashboard[]; filteredDashboards: Dashboard[]; dashboardsLoaded: boolean },
  expanded: boolean,
) {
  const counts: CommentItemCounts = useCommentItemCounts('dashboards', expanded);
  const latest = useRef(data);
  latest.current = data;
  const [commentFocus, setCommentFocus] = useState<string | null>(null);
  const clearCommentFocus = useCallback(() => setCommentFocus(null), []);

  useCommentItemFocus('dashboards', (itemKey) => {
    setCommentFocus(itemKey);
    return latest.current.dashboards.some((d) => dashboardCommentItemKey(d.id) === itemKey);
  });

  const visibleDashboards = useMemo(
    () =>
      commentFocus
        ? data.dashboards.filter((d) => dashboardCommentItemKey(d.id) === commentFocus)
        : data.filteredDashboards,
    [commentFocus, data.dashboards, data.filteredDashboards],
  );

  const match = visibleDashboards[0];
  const filter: DashboardCommentFilter | null = commentFocus
    ? {
        itemKey: commentFocus,
        label: match ? dashboardCommentAnchor(match).itemLabel : commentFocus,
        ready: data.dashboardsLoaded,
        exists: Boolean(commentFocus && match),
      }
    : null;

  return { counts, filter, visibleDashboards, clearCommentFocus };
}
