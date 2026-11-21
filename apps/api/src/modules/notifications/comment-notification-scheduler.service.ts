import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { NotificationChannel } from '@perfana/shared';
import { CommentDigest, commentCardLabel } from './message-builders';
import { NotificationsService } from './notifications.service';

/** A burst is announced once its oldest unannounced comment is this old. */
export const COMMENT_NOTIFY_DELAY_SECONDS = 120;
/** Bound on runs handled per sweep; the rest wait for the next tick. */
export const COMMENT_NOTIFY_MAX_RUNS_PER_TICK = 50;
/** A batch released after a transient failure is skipped this long, so it cannot hog the queue. */
export const COMMENT_NOTIFY_RETRY_SECONDS = 300;
/** Once a batch's oldest comment is this old, a failure is final: the claim stands, ERROR logged. */
export const COMMENT_NOTIFY_GIVE_UP_SECONDS = 3600;

interface ClaimedComment {
  id: string;
  author_name: string;
  card_key: string;
  created_at: Date;
}

/**
 * Announces test-run comments to the SUT's notification channels (design:
 * docs/designs/test-run-comments.md, "Notifications (PR3)").
 *
 * Whether a comment was announced is a column on the comment (`notified_at`), claimed in a
 * short transaction that COMMITS before any webhook is called, so a slow or dead webhook never
 * holds a row lock or a connection. A sweep that crashes between the claim and the post drops
 * that batch (accepted by the design); a batch whose channels all fail for a transient reason is
 * released for the next sweep.
 *
 * System call, no user: it uses the plain DataSource, like the stale-run sweep. It reads and
 * writes `test_run_comments` and `notification_channels` across tenants on purpose, which works
 * because the API's login role bypasses RLS (the same assumption the boot-time webhook
 * encryption pass makes); each run's channels are those of that run's own system only.
 */
@Injectable()
export class CommentNotificationScheduler {
  private readonly logger = new Logger(CommentNotificationScheduler.name);
  private isRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0,30 * * * * *', { name: 'announce-test-run-comments' })
  async sweep(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const runIds: Array<{ test_run_id: string }> = await this.dataSource.query(
        `SELECT test_run_id
           FROM test_run_comments
          WHERE notified_at IS NULL AND deleted_at IS NULL
            AND author_kind = 'user'
            AND (notify_after IS NULL OR notify_after <= now())
          GROUP BY test_run_id
         HAVING MIN(created_at) <= now() - make_interval(secs => $1)
          ORDER BY MIN(created_at)
          LIMIT $2`,
        [COMMENT_NOTIFY_DELAY_SECONDS, COMMENT_NOTIFY_MAX_RUNS_PER_TICK],
      );
      for (const { test_run_id } of runIds) {
        try {
          await this.announceRun(test_run_id);
        } catch (error) {
          this.logger.error(
            `Comment announcement failed for run ${test_run_id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Comment notification sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Claim one run's unannounced comments, then post. Returns the number of comments claimed
   * and kept (0 when another replica holds the run or when the batch was released).
   */
  async announceRun(testRunUuid: string): Promise<number> {
    const claimed = await this.claim(testRunUuid);
    if (!claimed || claimed.length === 0) return 0;

    // No transaction is open from here on.
    const ids = claimed.map((c) => c.id);
    const newest = claimed[claimed.length - 1]!;

    const [run]: Array<{ test_run_id: string; system_under_test_id: string; system_name: string }> =
      await this.dataSource.query(
        `SELECT tr.test_run_id, tr.system_under_test_id, s.name AS system_name
           FROM test_runs tr JOIN systems_under_test s ON s.id = tr.system_under_test_id
          WHERE tr.id = $1`,
        [testRunUuid],
      );
    if (!run) return claimed.length; // run deleted meanwhile; nothing to announce

    // A run whose system has no opted-in channel is still claimed, so it is not rescanned
    // every 30 s forever; a channel enabled later does not announce old comments.
    const channels = await this.dataSource.getRepository(NotificationChannel).find({
      where: { systemUnderTestId: run.system_under_test_id, enabled: true, notifyOnComment: true },
    });
    if (channels.length === 0) return claimed.length;

    const digest: CommentDigest = {
      systemName: run.system_name,
      testRunId: run.test_run_id,
      count: claimed.length,
      authorName: newest.author_name,
      cardLabel: commentCardLabel(newest.card_key),
      link:
        `${this.notifications.getPerfanaUrl().replace(/\/+$/, '')}/test-runs/${encodeURIComponent(testRunUuid)}` +
        `?card=${encodeURIComponent(newest.card_key)}&comment=${encodeURIComponent(newest.id)}`,
    };

    let delivered = 0;
    let retryableFailures = 0;
    for (const channel of channels) {
      try {
        await this.notifications.sendCommentDigest(channel, digest);
        delivered++;
      } catch (error) {
        const retryable = NotificationsService.isRetryableDeliveryError(error);
        if (retryable) retryableFailures++;
        const msg = error instanceof Error ? error.message : String(error);
        const text = `Comment notification to ${channel.type} channel "${channel.name}" (${channel.id}) failed for run ${run.test_run_id}: ${msg}`;
        if (retryable) this.logger.warn(`${text} (will retry if no channel succeeds)`);
        else this.logger.error(`${text} (not retryable)`);
      }
    }

    if (delivered === 0 && retryableFailures > 0) {
      // Retry later, never at once: a released batch keeps its old created_at, so without the
      // backoff it would be first in the sweep's oldest-first queue on every tick and a few
      // dead webhooks could take every slot from every other organization's runs.
      const oldest = Math.min(...claimed.map((c) => new Date(c.created_at).getTime()));
      if (Date.now() - oldest < COMMENT_NOTIFY_GIVE_UP_SECONDS * 1000) {
        await this.dataSource.query(
          `UPDATE test_run_comments
              SET notified_at = NULL, notify_after = now() + make_interval(secs => $2)
            WHERE id = ANY($1::uuid[])`,
          [ids, COMMENT_NOTIFY_RETRY_SECONDS],
        );
        this.logger.warn(`Released ${ids.length} comment(s) of run ${run.test_run_id} for a retry in ${COMMENT_NOTIFY_RETRY_SECONDS} s`);
        return 0;
      }
      this.logger.error(
        `Giving up on announcing ${ids.length} comment(s) of run ${run.test_run_id}: every channel has failed for over ${COMMENT_NOTIFY_GIVE_UP_SECONDS / 60} minutes`,
      );
    }
    return claimed.length;
  }

  /**
   * One short transaction: per-run advisory lock (skip the run when a replica holds it), lock
   * the unannounced comments with SKIP LOCKED, stamp them, commit. Null = lock not acquired.
   */
  private async claim(testRunUuid: string): Promise<ClaimedComment[] | null> {
    return this.dataSource.transaction(async (em) => {
      const [{ ok }] = await em.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('comment-notify:' || $1::text, 0)) AS ok`,
        [testRunUuid],
      );
      if (!ok) return null;
      const rows: ClaimedComment[] = await em.query(
        `SELECT id, author_name, card_key, created_at
           FROM test_run_comments
          WHERE test_run_id = $1 AND notified_at IS NULL AND deleted_at IS NULL
            -- Agent comments are stamped notified_at on insert (design: "No per-comment channel
            -- posts for agents"); this keeps the sweep from claiming one whose stamp was lost.
            AND author_kind = 'user'
            AND (notify_after IS NULL OR notify_after <= now())
          ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED`,
        [testRunUuid],
      );
      if (rows.length === 0) return rows;
      await em.query(
        `UPDATE test_run_comments SET notified_at = now() WHERE id = ANY($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
      return rows;
    });
  }
}
