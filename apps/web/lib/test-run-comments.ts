import { authenticatedFetch } from '@/lib/api';
import type { CommentCardKey } from '@perfana/shared/constants/comment-cards';

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
  createdAt: string;
  editedAt: string | null;
}

export interface RunCommentThread extends RunComment {
  replies: RunComment[];
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

export const fetchCommentThreads = async (runId: string, card: CommentCardKey) =>
  json<{ threads: RunCommentThread[]; lastSeenAt: string | null }>(await authenticatedFetch(`${base(runId)}?card=${encodeURIComponent(card)}`), 'Loading comments');

/** Per card: comments that are not deleted, and how many of those are unread for the caller. */
export type CardCommentCounts = Partial<Record<CommentCardKey, { total: number; unread: number }>>;

export const fetchCommentCounts = async (runId: string) =>
  json<CardCommentCounts>(await authenticatedFetch(`${base(runId)}/counts`), 'Loading comment counts');

export interface CommentAnchor {
  itemKey: string;
  itemLabel: string;
}

export const postComment = async (runId: string, card: CommentCardKey, body: string, parentId?: string, anchor?: CommentAnchor) =>
  json<RunComment>(await authenticatedFetch(base(runId), send('POST', { card, body, parentId, ...anchor })), 'Posting comment');

export type CommentItemCounts = Record<string, { threads: number; unread: number }>;

export const fetchCommentItemCounts = async (runId: string, card: CommentCardKey) =>
  json<CommentItemCounts>(await authenticatedFetch(`${base(runId)}/items?card=${encodeURIComponent(card)}`), 'Loading comment counts');

export const markCommentsSeen = async (runId: string, card: CommentCardKey) =>
  json<void>(await authenticatedFetch(`${base(runId)}/seen`, send('PUT', { card })), 'Marking comments seen');

export const editComment = async (id: string, body: string) =>
  json<RunComment>(await authenticatedFetch(`/comments/${encodeURIComponent(id)}`, send('PATCH', { body })), 'Saving comment');

export const deleteComment = async (id: string) =>
  json<void>(await authenticatedFetch(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Deleting comment');

/** "12 min ago" under 24 h, "18 Nov, 09:12" after (design DR14). */
export function formatCommentTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
