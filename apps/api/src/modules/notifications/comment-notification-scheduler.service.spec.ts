import { NotificationChannel } from '@perfana/shared';
import {
  COMMENT_NOTIFY_GIVE_UP_SECONDS,
  COMMENT_NOTIFY_RETRY_SECONDS,
  CommentNotificationScheduler,
} from './comment-notification-scheduler.service';
import { NotificationsService } from './notifications.service';
import {
  MattermostMessageBuilder,
  SlackMessageBuilder,
  TeamsMessageBuilder,
} from './message-builders';

const RUN = '11111111-1111-1111-1111-111111111111';

const channel = (over: Partial<NotificationChannel> = {}) =>
  ({ id: 'ch1', name: '#perf', type: 'slack', webhookUrl: 'https://hooks.slack.com/x', ...over }) as NotificationChannel;

describe('CommentNotificationScheduler', () => {
  let txQuery: jest.Mock;
  let query: jest.Mock;
  let find: jest.Mock;
  let send: jest.Mock;
  let scheduler: CommentNotificationScheduler;
  let lockAcquired: boolean;
  let claimRows: Array<{ id: string; author_name: string; card_key: string; created_at: Date }>;
  let events: string[];

  beforeEach(() => {
    lockAcquired = true;
    events = [];
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    claimRows = [
      { id: 'c1', author_name: 'Ann', card_key: 'slo', created_at: fiveMinutesAgo },
      { id: 'c2', author_name: 'Bob', card_key: 'graphs', created_at: fiveMinutesAgo },
    ];
    txQuery = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ ok: lockAcquired }];
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return claimRows;
      if (sql.includes('SET notified_at = now()')) events.push('claim-update');
      return [];
    });
    query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM test_runs')) {
        return [{ test_run_id: 'run-7', system_under_test_id: 'sut1', system_name: 'Shop' }];
      }
      if (sql.includes('notified_at = NULL')) events.push('release');
      return [];
    });
    find = jest.fn(async () => [channel()]);
    send = jest.fn(async () => {
      events.push('send');
    });
    const dataSource = {
      query,
      transaction: async (cb: (em: unknown) => unknown) => {
        const result = await cb({ query: txQuery });
        events.push('commit');
        return result;
      },
      getRepository: () => ({ find }),
    };
    const notifications = {
      sendCommentDigest: send,
      getPerfanaUrl: () => 'https://perfana.example/',
    };
    scheduler = new CommentNotificationScheduler(dataSource as never, notifications as never);
  });

  it('claims the burst, commits, and only then posts once with the newest comment', async () => {
    const kept = await scheduler.announceRun(RUN);

    expect(kept).toBe(2);
    expect(events).toEqual(['claim-update', 'commit', 'send']);
    expect(send).toHaveBeenCalledTimes(1);
    const digest = send.mock.calls[0][1];
    expect(digest).toMatchObject({ count: 2, authorName: 'Bob', cardLabel: 'Graphs', testRunId: 'run-7', systemName: 'Shop' });
    expect(digest.link).toBe(`https://perfana.example/test-runs/${RUN}?card=graphs&comment=c2`);
    expect(find.mock.calls[0][0].where).toMatchObject({ systemUnderTestId: 'sut1', enabled: true, notifyOnComment: true });
  });

  it('skips a run another replica holds the advisory lock for', async () => {
    lockAcquired = false;
    expect(await scheduler.announceRun(RUN)).toBe(0);
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('claims only unannounced, non-deleted comments', async () => {
    await scheduler.announceRun(RUN);
    const claimSql = txQuery.mock.calls.find((c) => String(c[0]).includes('SKIP LOCKED'))![0];
    expect(claimSql).toContain('notified_at IS NULL');
    expect(claimSql).toContain('deleted_at IS NULL');
  });

  it('keeps the claim but posts nothing when the system has no opted-in channel', async () => {
    find.mockResolvedValue([]);
    expect(await scheduler.announceRun(RUN)).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect(events).not.toContain('release');
  });

  it('keeps the claim and posts nothing when the run was deleted after the claim', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('notified_at = NULL')) events.push('release');
      return []; // the run lookup finds nothing
    });
    expect(await scheduler.announceRun(RUN)).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect(events).not.toContain('release');
  });

  it('does nothing when the claim is empty', async () => {
    claimRows = [];
    expect(await scheduler.announceRun(RUN)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the claim when every channel failed and one failure was retryable', async () => {
    find.mockResolvedValue([channel({ id: 'a' }), channel({ id: 'b' })]);
    send
      .mockRejectedValueOnce(new Error('Webhook request failed with status 503: down'))
      .mockRejectedValueOnce(new Error('Webhook request failed with status 404: gone'));

    expect(await scheduler.announceRun(RUN)).toBe(0);
    expect(events).toContain('release');
    const release = query.mock.calls.find((c) => String(c[0]).includes('notified_at = NULL'))!;
    expect(release[1]).toEqual([['c1', 'c2'], COMMENT_NOTIFY_RETRY_SECONDS]);
  });

  it('releases with a backoff, so a retried batch cannot hold the front of the queue', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 503: down'));
    jest.spyOn((scheduler as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
    expect(await scheduler.announceRun(RUN)).toBe(0);
    const release = query.mock.calls.find((c) => String(c[0]).includes('notified_at = NULL'))!;
    expect(release[0]).toContain('notify_after = now() + make_interval(secs => $2)');
    expect(release[1]).toEqual([['c1', 'c2'], COMMENT_NOTIFY_RETRY_SECONDS]);
  });

  it('gives up and keeps the claim once the burst is older than the give-up window', async () => {
    const old = new Date(Date.now() - (COMMENT_NOTIFY_GIVE_UP_SECONDS + 60) * 1000);
    claimRows = claimRows.map((r) => ({ ...r, created_at: old }));
    send.mockRejectedValue(new Error('Webhook request failed with status 503: down'));
    const error = jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    expect(await scheduler.announceRun(RUN)).toBe(2);
    expect(events).not.toContain('release');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Giving up'));
  });

  it('never claims or finds an agent comment, which is stamped announced on insert', async () => {
    await scheduler.announceRun(RUN);
    const claimSql = txQuery.mock.calls.find((c) => String(c[0]).includes('SKIP LOCKED'))![0];
    expect(claimSql).toContain("author_kind = 'user'");
    await scheduler.sweep();
    const finderSql = String(query.mock.calls.find((c) => String(c[0]).includes('GROUP BY test_run_id'))![0]);
    expect(finderSql).toContain("author_kind = 'user'");
  });

  it('never claims or finds a comment whose retry backoff has not elapsed', async () => {
    await scheduler.announceRun(RUN);
    const claimSql = txQuery.mock.calls.find((c) => String(c[0]).includes('SKIP LOCKED'))![0];
    expect(claimSql).toContain('notify_after IS NULL OR notify_after <= now()');
  });

  it('keeps the claim when the only failure is terminal, and logs at ERROR', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 404: gone'));
    const errorSpy = jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();

    expect(await scheduler.announceRun(RUN)).toBe(2);
    expect(events).not.toContain('release');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('run-7'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ch1'));
  });

  it('keeps the claim when one channel succeeded and another failed retryably', async () => {
    find.mockResolvedValue([channel({ id: 'a' }), channel({ id: 'b' })]);
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Webhook request timed out'));
    expect(await scheduler.announceRun(RUN)).toBe(2);
    expect(events).not.toContain('release');
  });

  it('bounds the scan and passes the delay to the run finder', async () => {
    query.mockResolvedValueOnce([]);
    await scheduler.sweep();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('HAVING MIN(created_at) <= now() - make_interval');
    expect(sql).toContain('LIMIT');
    expect(params).toEqual([120, 50]);
  });

  it('survives one run failing and handles the next', async () => {
    query.mockResolvedValueOnce([{ test_run_id: 'r1' }, { test_run_id: 'r2' }]);
    const spy = jest.spyOn(scheduler, 'announceRun').mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);
    jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    await scheduler.sweep();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('NotificationsService.isRetryableDeliveryError', () => {
  it.each([
    ['Webhook request failed with status 500: x', true],
    ['Webhook request failed with status 429: x', true],
    ['Webhook request failed with status 400: x', false],
    ['Webhook request timed out after 10000 ms', true],
    ['fetch failed', true],
    ['Refusing to send: bad', false],
    ['Webhook URL could not be decrypted: ENCRYPTION_KEY is missing', false],
    ['api.example resolves to 10.0.0.1, a private or internal address.', false],
  ])('%s -> %s', (msg, expected) => {
    expect(NotificationsService.isRetryableDeliveryError(new Error(msg))).toBe(expected);
  });
});

describe('comment message builders', () => {
  const digest = {
    systemName: 'Shop @here',
    testRunId: 'run-7',
    count: 3,
    authorName: 'Ann <x>',
    cardLabel: 'Graphs',
    link: 'https://p.example/test-runs/u?card=graphs&comment=c',
  };

  it('Slack carries count, author, card and link, and strips mentions', () => {
    const json = JSON.stringify(new SlackMessageBuilder('https://p.example').buildCommentMessage(digest));
    expect(json).toContain('3 new comments on Shop here run run-7');
    expect(json).toContain('Ann x');
    expect(json).toContain('<https://p.example/test-runs/u?card=graphs&comment=c|View comments in Perfana>');
  });

  it('Teams carries an OpenUri action to the link', () => {
    const m = new TeamsMessageBuilder('https://p.example').buildCommentMessage(digest);
    expect(m.summary).toContain('3 new comments');
    expect(m.potentialAction?.[0]?.targets[0]?.uri).toBe(digest.link);
  });

  it('Mattermost uses text and attachments, never blocks, and singularises one comment', () => {
    const m = new MattermostMessageBuilder('https://p.example').buildCommentMessage({ ...digest, count: 1 });
    expect(m.text).toContain('1 new comment on');
    expect(m.attachments?.[0]?.text).toContain(`](${digest.link})`);
    expect(m).not.toHaveProperty('blocks');
  });
});
