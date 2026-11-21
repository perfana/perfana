import { authenticatedFetch } from '@/lib/api';
import type { StoryAuthorKind, StoryStatus } from '@perfana/shared/constants/comment-cards';
import type { RunComment } from '@/lib/test-run-comments';

/**
 * Analysis stories on a test run (design: docs/designs/test-run-analysis-stories.md, "Stories"):
 * an ordered walk over the run's root comments, with a title and a conclusion. A user's draft is
 * visible to its author only (the API answers 404 for anyone else's); an AI agent's draft is visible
 * to everyone who can see the run, for a person to review and publish.
 */
export interface RunStorySummary {
  id: string;
  testRunId: string;
  title: string;
  summary: string | null;
  status: StoryStatus;
  authorId: string;
  authorName: string;
  authorKind: StoryAuthorKind;
  publishedAt: string | null;
  /** Who published it last (kept on unpublish); for an agent's story, the person who reviewed it. */
  publishedById: string | null;
  publishedByName: string | null;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
  /**
   * The caller may edit, reorder, publish and unpublish: its author, any user for an AI agent's
   * draft, or the person who published an agent's story.
   */
  canEdit: boolean;
  /** The caller may delete it (author, any user for an agent's draft, org admin, global admin). */
  canDelete: boolean;
}

/** A step with its comment as it reads now; `comment.deleted` when it was deleted since. */
export interface RunStoryStep {
  position: number;
  note: string | null;
  comment: RunComment & { replyCount: number };
}

export interface RunStory extends RunStorySummary {
  steps: RunStoryStep[];
}

/** One step as the API takes it. */
export interface StoryStepInput {
  commentId: string;
  note?: string | null;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
      detail = typeof msg === 'string' ? `: ${msg}` : '';
    } catch {
      /* no body */
    }
    throw Object.assign(new Error(`${what} failed (${res.status})${detail}`), { status: res.status });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const storyUrl = (id: string) => `/stories/${encodeURIComponent(id)}`;

/** Published stories of the run plus the caller's own drafts, oldest first. */
export const fetchStories = async (runId: string) =>
  json<RunStorySummary[]>(await authenticatedFetch(`/test-runs/${encodeURIComponent(runId)}/stories`), 'Loading stories');

export const fetchStory = async (id: string) => json<RunStory>(await authenticatedFetch(storyUrl(id)), 'Loading story');

/** Start a draft; `steps` usually holds the comment it was started from. */
export const createStory = async (runId: string, title: string, steps: StoryStepInput[] = []) =>
  json<RunStory>(
    await authenticatedFetch(`/test-runs/${encodeURIComponent(runId)}/stories`, send('POST', { title, steps })),
    'Creating story',
  );

/** Title, summary (null clears it) and status; an absent key is left alone. */
export const updateStory = async (id: string, patch: { title?: string; summary?: string | null; status?: StoryStatus }) =>
  json<RunStory>(await authenticatedFetch(storyUrl(id), send('PATCH', patch)), 'Saving story');

/** The full ordered list; replaces every step. */
export const replaceStorySteps = async (id: string, steps: StoryStepInput[]) =>
  json<RunStory>(await authenticatedFetch(`${storyUrl(id)}/steps`, send('PUT', { steps })), 'Saving steps');

export const deleteStory = async (id: string) =>
  json<void>(await authenticatedFetch(storyUrl(id), { method: 'DELETE' }), 'Deleting story');

/** Append a comment to a story the caller edits, unless it is already a step. */
export async function addCommentToStory(storyId: string, commentId: string): Promise<{ story: RunStory; added: boolean }> {
  const story = await fetchStory(storyId);
  if (story.steps.some((s) => s.comment.id === commentId)) return { story, added: false };
  const steps = [...story.steps.map((s) => ({ commentId: s.comment.id, note: s.note })), { commentId }];
  return { story: await replaceStorySteps(storyId, steps), added: true };
}

/** The reader's URL for a story: no step is the intro screen, past the last step the conclusion. */
export function storyHref(params: URLSearchParams, storyId: string | null, step?: number): string {
  const next = new URLSearchParams(params.toString());
  next.delete('story');
  next.delete('step');
  if (storyId) {
    next.set('story', storyId);
    if (step !== undefined) next.set('step', String(step));
  }
  const q = next.toString();
  return q ? `?${q}` : '?';
}
