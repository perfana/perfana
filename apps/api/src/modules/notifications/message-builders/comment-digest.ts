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
