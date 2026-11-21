import { COMMENT_UNREAD_WINDOW_DAYS } from '@perfana/shared/constants/comment-cards';

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface CommentCounts {
  /** Comments that are not deleted, by anyone, roots and replies alike. */
  total: number;
  /** Of those: by someone else, newer than the caller's last look at the card, in the window. */
  unread: number;
  /** Of the unread: how many an AI agent wrote (`author_kind = 'agent'`), for "5 unread (3 from AI)". */
  unreadAgent: number;
}

/**
 * Comment counts per run and card in one grouped statement over the given runs (never one per
 * run), served by `(test_run_id, created_at)`.
 *
 * Unread = a comment by someone else, not deleted, newer than the caller's last look at that
 * card, and no older than COMMENT_UNREAD_WINDOW_DAYS (design R7). A missing read row counts
 * every such comment.
 */
const UNREAD = `c.author_id <> $2
             AND c.created_at > now() - make_interval(days => ${COMMENT_UNREAD_WINDOW_DAYS})
             AND c.created_at > COALESCE(r.last_seen_at, '-infinity'::timestamptz)`;

const COUNTS_SQL = `
  SELECT c.test_run_id, c.card_key,
         count(*)::int AS total,
         count(*) FILTER (WHERE ${UNREAD})::int AS unread,
         count(*) FILTER (WHERE ${UNREAD} AND c.author_kind = 'agent')::int AS unread_agent
    FROM test_run_comments c
    LEFT JOIN test_run_comment_reads r
      ON r.user_id = $2 AND r.test_run_id = c.test_run_id AND r.card_key = c.card_key
   WHERE c.test_run_id = ANY($1::uuid[])
     AND c.deleted_at IS NULL
   GROUP BY c.test_run_id, c.card_key`;

type Row = { test_run_id: string; card_key: string; total: number; unread: number; unread_agent: number };

/** Per-card counts for one run. Cards without comments are absent. */
export async function commentCountsByCard(db: Queryable, runUuid: string, userId: string): Promise<Record<string, CommentCounts>> {
  const rows = (await db.query(COUNTS_SQL, [[runUuid], userId])) as Row[];
  return Object.fromEntries(rows.map((r) => [r.card_key, { total: r.total, unread: r.unread, unreadAgent: r.unread_agent ?? 0 }]));
}

/** Counts per run, summed over cards, for the test-run list. Runs without comments are absent. */
export async function commentCountsByRun(db: Queryable, runUuids: string[], userId: string): Promise<Map<string, CommentCounts>> {
  const totals = new Map<string, CommentCounts>();
  if (runUuids.length === 0 || !userId) return totals;
  const rows = (await db.query(COUNTS_SQL, [runUuids, userId])) as Row[];
  for (const r of rows) {
    const t = totals.get(r.test_run_id) ?? { total: 0, unread: 0, unreadAgent: 0 };
    totals.set(r.test_run_id, { total: t.total + r.total, unread: t.unread + r.unread, unreadAgent: t.unreadAgent + (r.unread_agent ?? 0) });
  }
  return totals;
}
