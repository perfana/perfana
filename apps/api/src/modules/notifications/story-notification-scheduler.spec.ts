// The story half of CommentNotificationScheduler (analysis stories, PR5): a published story is
// claimed once, committed, then announced; a release on a retryable failure; a terminal failure
// keeps the claim. The SQL itself runs against Postgres in
// src/test/rls/story-notification-scheduler.spec.ts.
import { NotificationChannel } from '@perfana/shared';
import {
  COMMENT_NOTIFY_GIVE_UP_SECONDS,
  COMMENT_NOTIFY_RETRY_SECONDS,
  CommentNotificationScheduler,
  STORY_NOTIFY_MAX_PER_TICK,
} from './comment-notification-scheduler.service';
import {
  MattermostMessageBuilder,
  SlackMessageBuilder,
  StoryAnnouncement,
  TeamsMessageBuilder,
} from './message-builders';

const RUN = '11111111-1111-1111-1111-111111111111';
const STORY = '22222222-2222-2222-2222-222222222222';

const channel = (over: Partial<NotificationChannel> = {}) =>
  ({ id: 'ch1', name: '#perf', type: 'slack', webhookUrl: 'https://hooks.slack.com/x', ...over }) as NotificationChannel;

describe('CommentNotificationScheduler stories', () => {
  let txQuery: jest.Mock;
  let query: jest.Mock;
  let find: jest.Mock;
  let send: jest.Mock;
  let scheduler: CommentNotificationScheduler;
  let lockAcquired: boolean;
  let claimRow: Record<string, unknown> | undefined;
  let events: string[];

  beforeEach(() => {
    lockAcquired = true;
    events = [];
    claimRow = {
      id: STORY, test_run_id: RUN, title: 'Checkout latency after deploy', author_name: 'Daniel',
      updated_at: new Date(Date.now() - 5 * 60_000), step_count: '6',
    };
    txQuery = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ ok: lockAcquired }];
      if (sql.includes('FROM test_run_stories s')) return claimRow ? [claimRow] : [];
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
      sendCommentDigest: jest.fn(),
      sendStoryAnnouncement: send,
      getPerfanaUrl: () => 'https://perfana.example/',
    };
    scheduler = new CommentNotificationScheduler(dataSource as never, notifications as never);
  });

  it('claims the story, commits, and only then posts once with a link to the reader intro', async () => {
    expect(await scheduler.announceStory(STORY)).toBe(true);
    expect(events).toEqual(['claim-update', 'commit', 'send']);
    const story = send.mock.calls[0][1] as StoryAnnouncement;
    expect(story).toEqual({
      systemName: 'Shop', testRunId: 'run-7', authorName: 'Daniel', title: 'Checkout latency after deploy',
      stepCount: 6, link: `https://perfana.example/test-runs/${RUN}?story=${STORY}`,
    });
    expect(find.mock.calls[0][0].where).toMatchObject({ systemUnderTestId: 'sut1', enabled: true, notifyOnComment: true });
  });

  it('claims only a published, unannounced story whose backoff has elapsed', async () => {
    await scheduler.announceStory(STORY);
    const sql = txQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('FROM test_run_stories s'))!;
    expect(sql).toMatch(/s\.status = 'published'/);
    expect(sql).toMatch(/s\.notified_at IS NULL/);
    expect(sql).toMatch(/notify_after IS NULL OR s\.notify_after <= now\(\)/);
    expect(sql).toMatch(/SKIP LOCKED/);
  });

  it('posts nothing when the story is not claimable (a draft, deleted, or already announced)', async () => {
    claimRow = undefined;
    expect(await scheduler.announceStory(STORY)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual(['commit']);
  });

  it('skips a story another replica holds the advisory lock for', async () => {
    lockAcquired = false;
    expect(await scheduler.announceStory(STORY)).toBe(false);
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the claim but posts nothing when the system has no opted-in channel', async () => {
    find.mockResolvedValue([]);
    expect(await scheduler.announceStory(STORY)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(events).not.toContain('release');
  });

  it('releases the claim with a backoff when every channel failed retryably', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 503: down'));
    jest.spyOn((scheduler as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
    expect(await scheduler.announceStory(STORY)).toBe(false);
    const release = query.mock.calls.find((c) => (c[0] as string).includes('notified_at = NULL'))!;
    expect(release[0]).toMatch(/UPDATE test_run_stories/);
    expect(release[1]).toEqual([STORY, COMMENT_NOTIFY_RETRY_SECONDS]);
  });

  it('keeps the claim on a terminal failure, and logs at ERROR', async () => {
    send.mockRejectedValue(new Error('Webhook request failed with status 404: gone'));
    const error = jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    expect(await scheduler.announceStory(STORY)).toBe(true);
    expect(events).not.toContain('release');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not retryable'));
  });

  it('gives up and keeps the claim once the publication is older than the give-up window', async () => {
    claimRow!.updated_at = new Date(Date.now() - (COMMENT_NOTIFY_GIVE_UP_SECONDS + 60) * 1000);
    send.mockRejectedValue(new Error('Webhook request failed with status 503: down'));
    jest.spyOn((scheduler as never as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
    const error = jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    expect(await scheduler.announceStory(STORY)).toBe(true);
    expect(events).not.toContain('release');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Giving up on announcing story'));
  });

  it('the sweep finds only published, unannounced stories, bounded, and announces each', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM test_run_stories')) return [{ id: STORY }];
      if (sql.includes('FROM test_runs')) return [{ test_run_id: 'run-7', system_under_test_id: 'sut1', system_name: 'Shop' }];
      return [];
    });
    await scheduler.sweep();
    const finder = query.mock.calls.find((c) => (c[0] as string).includes('FROM test_run_stories'))!;
    expect(finder[0]).toMatch(/status = 'published' AND notified_at IS NULL/);
    expect(finder[1]).toEqual([STORY_NOTIFY_MAX_PER_TICK]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failing comment sweep does not stop the story sweep', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM test_run_comments')) throw new Error('boom');
      if (sql.includes('FROM test_run_stories')) return [{ id: STORY }];
      if (sql.includes('FROM test_runs')) return [{ test_run_id: 'run-7', system_under_test_id: 'sut1', system_name: 'Shop' }];
      return [];
    });
    jest.spyOn((scheduler as never as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    await scheduler.sweep();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('story message builders', () => {
  const story: StoryAnnouncement = {
    systemName: 'Shop', testRunId: 'run-7', authorName: '@channel Daniel', title: 'Checkout <latency> *after* deploy',
    stepCount: 1, link: 'https://perfana.example/test-runs/u?story=s',
  };

  it('Slack names author, system, run, title and step count, and strips mentions and markup', () => {
    const msg = new SlackMessageBuilder().buildStoryMessage(story);
    const all = JSON.stringify(msg);
    expect(msg.text).toBe('channel Daniel published an analysis on Shop run run-7: Checkout latency after deploy (1 step)');
    expect(all).not.toContain('@channel');
    expect(all).not.toContain('<latency>');
    expect(all).toContain('<https://perfana.example/test-runs/u?story=s|Read the analysis in Perfana>');
  });

  it('names the AI agent and the person who reviewed and published its story', () => {
    const msg = new SlackMessageBuilder().buildStoryMessage({
      ...story, authorName: 'Claude analysis agent', authorKind: 'agent', publishedByName: '@here Anna',
    });
    expect(msg.text).toBe('here Anna published an analysis proposed by Claude analysis agent (AI) on Shop run run-7: Checkout latency after deploy (1 step)');
  });

  it('Teams carries an OpenUri action to the reader', () => {
    const msg = new TeamsMessageBuilder().buildStoryMessage({ ...story, stepCount: 6 });
    expect(msg.potentialAction?.[0]).toMatchObject({ targets: [{ uri: story.link }] });
    expect(JSON.stringify(msg)).toContain('(6 steps)');
  });

  it('Mattermost uses text and attachments with a markdown link', () => {
    const msg = new MattermostMessageBuilder().buildStoryMessage(story);
    expect(msg.text).toContain('published an analysis on Shop run run-7');
    expect(msg.attachments?.[0]?.text).toContain('[Read the analysis in Perfana](https://perfana.example/test-runs/u?story=s)');
  });
});
