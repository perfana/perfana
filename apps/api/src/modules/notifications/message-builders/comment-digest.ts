import { COMMENT_CARD_LABELS } from '@perfana/shared/constants/comment-cards';
/**
 * What one "new comments" post says (test-run comments, PR3). Deliberately carries no comment
 * body: a channel is wider than the run's audience, so the post says that something was said,
 * by whom and where, and the link leads to the card behind the sign-in.
 */
export interface CommentDigest {
  systemName: string;
  /** The human test run id (`test_runs.test_run_id`). */
  testRunId: string;
  /** Comments claimed in this burst. */
  count: number;
  /** Author of the newest comment in the burst. */
  authorName: string;
  /** Human label of the newest comment's card. */
  cardLabel: string;
  /** `/test-runs/<uuid>?card=<cardKey>&comment=<id>` on `PERFANA_URL`. */
  link: string;
}

export function commentCardLabel(cardKey: string): string {
  return (COMMENT_CARD_LABELS as Record<string, string>)[cardKey] ?? cardKey;
}

/**
 * Names and ids are user-controlled text going into Slack mrkdwn, Teams markdown and
 * Mattermost markdown. Strip what would format, link or mention (`@channel`, `<url|x>`).
 */
export function plainText(value: string, max = 80): string {
  const cleaned = value.replace(/[*_`~<>@[\]()|\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function commentHeadline(d: CommentDigest): string {
  const n = d.count === 1 ? '1 new comment' : `${d.count} new comments`;
  return `${n} on ${plainText(d.systemName)} run ${plainText(d.testRunId, 120)}`;
}

export function commentDetail(d: CommentDigest): string {
  return `Latest from ${plainText(d.authorName)} on the ${plainText(d.cardLabel)} card`;
}

/**
 * What one "analysis story published" post says (analysis stories, PR5). Carries the story's
 * title, which its author wrote to be read as a headline, but never its summary or a step's
 * comment: those stay behind the sign-in, as comment bodies do.
 */
export interface StoryAnnouncement {
  systemName: string;
  /** The human test run id (`test_runs.test_run_id`). */
  testRunId: string;
  /** The story author. */
  authorName: string;
  /** `agent` for a story an AI agent proposed through the MCP server (analysis stories, PR6). */
  authorKind?: 'user' | 'agent';
  /** Who published it; for an agent's story, the person who reviewed it. */
  publishedByName?: string | null;
  title: string;
  stepCount: number;
  /** `/test-runs/<uuid>?story=<id>` on `PERFANA_URL`: the reader's intro screen. */
  link: string;
}

/**
 * "<author> published an analysis on <SUT> run <id>", or for an agent's story "<reviewer>
 * published an analysis proposed by <agent> (AI) on <SUT> run <id>": a channel reader must never
 * take an agent's root-cause claim for a colleague's.
 */
export function storyHeadline(s: StoryAnnouncement): string {
  const where = `on ${plainText(s.systemName)} run ${plainText(s.testRunId, 120)}`;
  if (s.authorKind === 'agent') {
    const reviewer = s.publishedByName ? plainText(s.publishedByName) : 'A reviewer';
    return `${reviewer} published an analysis proposed by ${plainText(s.authorName)} (AI) ${where}`;
  }
  return `${plainText(s.authorName)} published an analysis ${where}`;
}

/** "<title> (N steps)" */
export function storyDetail(s: StoryAnnouncement): string {
  return `${plainText(s.title, 200)} (${s.stepCount === 1 ? '1 step' : `${s.stepCount} steps`})`;
}
