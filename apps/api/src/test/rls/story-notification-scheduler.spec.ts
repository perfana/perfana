/**
 * The story half of CommentNotificationScheduler against a real Postgres (migration 1832,
 * packages/shared/src/database/migrations/1832000000000-StoryNotifications.ts).
 *
 * Value: protects=the story claim/release/finder SQL resolves and does what the mocked spec
 * assumes (advisory lock, SKIP LOCKED claim on a published story only, step count, release with a
 * backoff, the partial-index finder); fails_when=a column or predicate is wrong (42703), a draft is
 * claimed, or a republish announces again; seam=none; no_claim=webhook delivery (a jest mock;
 * owner role, not RLS).
 *
 * Runs against the local dev DB like its sibling suites; everything it writes is deleted in
 * afterAll. Fixture names are synthetic.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { CommentNotificationScheduler } from '../../modules/notifications/comment-notification-scheduler.service';
import { deleteSystemFixtures } from './delete-system-fixtures';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('CommentNotificationScheduler stories against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const suffix = randomUUID().slice(0, 8);
  const org = randomUUID();
  const sut = randomUUID();
  const channelId = randomUUID();
  const runHuman = `story-notify-spec-run-${suffix}`;
  let runUuid = '';
  const published = randomUUID();
  const draft = randomUUID();
  const comment1 = randomUUID();
  const comment2 = randomUUID();

  const send = jest.fn();
  let scheduler: CommentNotificationScheduler;

  const stamps = async (): Promise<Record<string, { notified_at: Date | null; notify_after: Date | null }>> => {
    const rows: Array<{ id: string; notified_at: Date | null; notify_after: Date | null }> = await ds.query(
      `SELECT id, notified_at, notify_after FROM test_run_stories WHERE test_run_id = $1`,
      [runUuid],
    );
    return Object.fromEntries(rows.map((r) => [r.id, r]));
  };
  const reset = (): Promise<unknown> =>
    ds.query(
      `UPDATE test_run_stories
          SET notified_at = NULL, notify_after = NULL, updated_at = now(),
              status = CASE WHEN id = $2 THEN 'published' ELSE 'draft' END
        WHERE test_run_id = $1`,
      [runUuid, published],
    );

  beforeAll(async () => {
    await ds.initialize();
    scheduler = new CommentNotificationScheduler(ds, {
      sendCommentDigest: jest.fn(),
      sendStoryAnnouncement: send,
      getPerfanaUrl: () => 'https://perfana.example',
    } as never);
    await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [org, `story-notify-spec-${suffix}`]);
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description) VALUES ($1, $2, $3, 'spec')`,
      [sut, org, `story-notify-spec-sut-${suffix}`],
    );
    const rows = await ds.query(
      `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
       VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
      [runHuman, sut, org],
    );
    runUuid = rows[0].id;
    await ds.query(
      `INSERT INTO notification_channels (id, system_under_test_id, type, name, webhook_url, notify_on_comment, enabled, organization_id)
       VALUES ($1, $2, 'slack', 'spec-in', 'https://hooks.slack.com/services/x', true, true, $3)`,
      [channelId, sut, org],
    );
    // Comments stamped announced, so the comment half of a sweep leaves them alone.
    await ds.query(
      `INSERT INTO test_run_comments (id, test_run_id, card_key, body, author_id, author_name, organization_id, notified_at)
       VALUES ($1, $3, 'slo', 'first', 'u-a', 'Author A', $4, now()),
              ($2, $3, 'graphs', 'second', 'u-a', 'Author A', $4, now())`,
      [comment1, comment2, runUuid, org],
    );
    await ds.query(
      `INSERT INTO test_run_stories (id, test_run_id, title, status, author_id, author_name, published_at, organization_id)
       VALUES ($1, $3, 'Checkout latency after deploy', 'published', 'u-a', 'Daniel', now(), $4),
              ($2, $3, 'Unfinished', 'draft', 'u-a', 'Daniel', NULL, $4)`,
      [published, draft, runUuid, org],
    );
    await ds.query(
      `INSERT INTO test_run_story_steps (story_id, comment_id, position, organization_id)
       VALUES ($1, $2, 1, $4), ($1, $3, 2, $4), ($5, $2, 1, $4)`,
      [published, comment1, comment2, org, draft],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM ds_metric_collection_status WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE id = $1)`, [runUuid]);
    await ds.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]); // cascades comments and stories
    await ds.query(`DELETE FROM notification_channels WHERE system_under_test_id = $1`, [sut]);
    await deleteSystemFixtures(ds, [sut]);
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [org]);
    await ds.destroy();
  });

  beforeEach(async () => {
    send.mockReset();
    send.mockResolvedValue(undefined);
    // sweep() also runs the comment half over the whole database, which would claim the
    // comments of runs other suites are testing at the same moment (comment-notification-
    // scheduler.spec.ts did fail on exactly that); this suite tests stories only.
    jest.spyOn(scheduler, 'announceRun').mockResolvedValue(0);
    await reset();
  });

  it('claims the published story once and posts it with its step count and reader link', async () => {
    expect(await scheduler.announceStory(published)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [channel, story] = send.mock.calls[0];
    expect(channel.id).toBe(channelId);
    expect(story).toEqual({
      systemName: `story-notify-spec-sut-${suffix}`, testRunId: runHuman, authorName: 'Daniel', authorKind: 'user', publishedByName: null,
      title: 'Checkout latency after deploy', stepCount: 2,
      link: `https://perfana.example/test-runs/${runUuid}?story=${published}`,
    });
    expect((await stamps())[published].notified_at).not.toBeNull();

    expect(await scheduler.announceStory(published)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never claims a draft', async () => {
    expect(await scheduler.announceStory(draft)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect((await stamps())[draft].notified_at).toBeNull();
  });

  it('does not announce a republish: unpublish keeps notified_at and the story is not found again', async () => {
    expect(await scheduler.announceStory(published)).toBe(true);
    await ds.query(`UPDATE test_run_stories SET status = 'draft' WHERE id = $1`, [published]);
    await ds.query(`UPDATE test_run_stories SET status = 'published' WHERE id = $1`, [published]);
    send.mockClear();
    expect(await scheduler.announceStory(published)).toBe(false);
    const announce = jest.spyOn(scheduler, 'announceStory');
    try {
      await scheduler.sweep();
      expect(announce.mock.calls.map((c) => c[0])).not.toContain(published);
    } finally {
      announce.mockRestore();
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('the sweep finds the published story and not the draft', async () => {
    const announce = jest.spyOn(scheduler, 'announceStory').mockResolvedValue(true);
    try {
      await scheduler.sweep();
      const ids = announce.mock.calls.map((c) => c[0]);
      expect(ids).toContain(published);
      expect(ids).not.toContain(draft);
    } finally {
      announce.mockRestore();
    }
  });

  it('releases the claim with a backoff on a retryable failure, and the sweep waits it out', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 503: down'));
    jest.spyOn((scheduler as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
    expect(await scheduler.announceStory(published)).toBe(false);
    const s = (await stamps())[published];
    expect(s.notified_at).toBeNull();
    expect(new Date(s.notify_after!).getTime()).toBeGreaterThan(Date.now());

    const announce = jest.spyOn(scheduler, 'announceStory');
    try {
      await scheduler.sweep();
      expect(announce.mock.calls.map((c) => c[0])).not.toContain(published);
    } finally {
      announce.mockRestore();
    }
  });

  it('keeps the claim on a terminal failure', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 404: gone'));
    jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    expect(await scheduler.announceStory(published)).toBe(true);
    expect((await stamps())[published].notified_at).not.toBeNull();
  });

  it('skips a story whose advisory lock another session holds, claiming nothing', async () => {
    await ds.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock(hashtextextended('story-notify:' || $1::text, 0))`, [published]);
      expect(await scheduler.announceStory(published)).toBe(false);
    });
    expect(send).not.toHaveBeenCalled();
    expect((await stamps())[published].notified_at).toBeNull();
  });

  it('posts nothing for a story deleted before the claim', async () => {
    const gone = randomUUID();
    await ds.query(
      `INSERT INTO test_run_stories (id, test_run_id, title, status, author_id, author_name, published_at, organization_id)
       VALUES ($1, $2, 'Gone', 'published', 'u-a', 'Daniel', now(), $3)`,
      [gone, runUuid, org],
    );
    await ds.query(`DELETE FROM test_run_stories WHERE id = $1`, [gone]);
    expect(await scheduler.announceStory(gone)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
