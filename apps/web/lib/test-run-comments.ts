import { authenticatedFetch } from '@/lib/api';
import type { CommentCardKey, CommentTag, ConfigCommentView } from '@perfana/shared/constants/comment-cards';
import type { SeriesConfig as PresetSeries } from '@/lib/graph-presets';

/**
 * The Graphs view a marker was placed on. `series` is the graph-preset series shape, so
 * replaying it is the preset load path; `xRange` absent means the whole run.
 */
export interface MarkerChartContext {
  /** Stamped by the server from the card; absent on a view the client is about to post. */
  kind?: 'graphs';
  series: PresetSeries[];
  xRange?: [string, string];
  axisMode?: 'overlay' | 'split';
  title?: string;
}

/** A series as the Trends and Compare presets store it; each card maps it back to its own shape. */
export interface ViewSeries {
  dashboardId: string;
  dashboardLabel?: string;
  panelId: number;
  panelTitle?: string;
  metricName: string;
  source: string;
  yAxisFormat?: string;
  yAxesFormat?: string;
  metricsSourceId?: string;
  isAggregated?: boolean;
  colorSlot?: number;
  hidden?: boolean;
}

/** The Trends view a comment was written on. `timeRange` is the option's label ('Last week', 'Custom'). */
export interface TrendsView {
  kind: 'trends';
  series: ViewSeries[];
  timeRange: string;
  customRange?: [string, string];
  evaluateType: string;
}

/** The Compare view a comment was written on; `baselineTestRunId` may be the control-group sentinel. */
export interface CompareView {
  kind: 'compare';
  series: ViewSeries[];
  baselineTestRunId?: string;
}

/**
 * The comparison a Configuration item comment was written against (design:
 * test-run-analysis-stories.md, "Item-level comments").
 */
export type ConfigView = ConfigCommentView & { kind: 'config' };

/** What a Graphs, Trends or Compare comment, or a Configuration item comment, records about its card's view. */
export type CommentView = MarkerChartContext | TrendsView | CompareView | ConfigView;

/** The comment's view if it was recorded on `card`; Graphs views from before `kind` existed count as Graphs. */
export function viewOf<C extends 'graphs' | 'trends' | 'compare' | 'config'>(
  comment: Pick<RunComment, 'chartContext'>,
  card: C,
): Extract<CommentView, { kind?: C }> | null {
  const v = comment.chartContext;
  if (!v || (v.kind ?? 'graphs') !== card) return null;
  return v as Extract<CommentView, { kind?: C }>;
}

export interface RunComment {
  id: string;
  testRunId: string;
  cardKey: CommentCardKey;
  parentId: string | null;
  /** The card item (row) a thread is anchored to; null = the whole card. */
  itemKey: string | null;
  itemLabel: string | null;
  /** null once deleted. */
  body: string | null;
  deleted: boolean;
  authorId: string;
  authorName: string;
  markerSeq: number | null;
  markerTime: string | null;
  /** The card's view when the root was written (Graphs, Trends, Compare); null once deleted and elsewhere. */
  chartContext: CommentView | null;
  /** Analysis tag on a root (design: test-run-analysis-stories.md); null when untagged, always null on a reply. Kept on a deleted root. */
  tag: CommentTag | null;
  createdAt: string;
  editedAt: string | null;
}

export interface RunCommentThread extends RunComment {
  replies: RunComment[];
  /** The stories this root is a step of, among those the caller can see; absent when none. */
  stories?: { id: string; title: string; position: number }[];
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
    } catch {
      /* no body */
    }
    throw new Error(`${what} failed (${res.status})${detail}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const base = (runId: string) => `/test-runs/${encodeURIComponent(runId)}/comments`;
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** One card's threads, or with no `card` every thread on the run (then `lastSeenAt` is null). */
export const fetchCommentThreads = async (runId: string, card?: CommentCardKey) =>
  json<{ threads: RunCommentThread[]; lastSeenAt: string | null; canModerate?: boolean }>(
    await authenticatedFetch(card ? `${base(runId)}?card=${encodeURIComponent(card)}` : base(runId)),
    'Loading comments',
  );

/** Per card: comments that are not deleted, and how many of those are unread for the caller. */
export type CardCommentCounts = Partial<Record<CommentCardKey, { total: number; unread: number }>>;

export const fetchCommentCounts = async (runId: string) =>
  json<CardCommentCounts>(await authenticatedFetch(`${base(runId)}/counts`), 'Loading comment counts');

export interface CommentAnchor {
  itemKey: string;
  itemLabel: string;
}

export const postComment = async (
  runId: string,
  card: CommentCardKey,
  body: string,
  parentId?: string,
  anchor?: CommentAnchor,
  chartContext?: CommentView,
  /** Roots only; the API refuses a tag on a reply. */
  tag?: CommentTag | null,
) => json<RunComment>(await authenticatedFetch(base(runId), send('POST', { card, body, parentId, ...anchor, chartContext, tag: tag ?? undefined })), 'Posting comment');

/** Post a numbered marker on the Graphs card; the server assigns its number. */
export async function postMarker(runId: string, body: string, markerTime: string, chartContext: MarkerChartContext, tag?: CommentTag | null) {
  const c = await json<RunComment>(await authenticatedFetch(base(runId), send('POST', { card: 'graphs', body, markerTime, chartContext, tag: tag ?? undefined })), 'Posting marker');
  // An API older than this client strips the marker fields (whitelist validation) and saves a plain
  // comment with a 201. Say so instead of letting the marker vanish without a word.
  if (c.markerSeq == null) {
    throw Object.assign(new Error('Saved as a plain comment: this server does not support markers yet'), { saved: c });
  }
  return c;
}

export type CommentItemCounts = Record<string, { threads: number; unread: number }>;

export const fetchCommentItemCounts = async (runId: string, card: CommentCardKey) =>
  json<CommentItemCounts>(await authenticatedFetch(`${base(runId)}/items?card=${encodeURIComponent(card)}`), 'Loading comment counts');

export const markCommentsSeen = async (runId: string, card: CommentCardKey) =>
  json<void>(await authenticatedFetch(`${base(runId)}/seen`, send('PUT', { card })), 'Marking comments seen');

/**
 * Edit the author's own comment. `tag` undefined leaves the stored tag alone, null clears it. The
 * server marks the comment "(edited)" only when the body actually changed, so sending the same body
 * beside a new tag is a retag, not an edit.
 */
export const editComment = async (id: string, body: string, tag?: CommentTag | null) =>
  json<RunComment>(
    await authenticatedFetch(`/comments/${encodeURIComponent(id)}`, send('PATCH', tag === undefined ? { body } : { body, tag })),
    'Saving comment',
  );

export const deleteComment = async (id: string) =>
  json<void>(await authenticatedFetch(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Deleting comment');

/** "10:37:10 (+37:10)": wall clock plus time into the run (design DR14). */
export function formatMarkerTime(iso: string, runStart?: string | null): string {
  const clock = new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const start = runStart ? Date.parse(runStart) : NaN;
  if (!Number.isFinite(start)) return clock;
  const secs = Math.round((Date.parse(iso) - start) / 1000);
  const abs = Math.abs(secs);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = String(abs % 60).padStart(2, '0');
  const elapsed = h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  return `${clock} (${secs < 0 ? '-' : '+'}${elapsed})`;
}

/** "12 min ago" under 24 h, "18 Nov, 09:12" after (design DR14). */
export function formatCommentTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
