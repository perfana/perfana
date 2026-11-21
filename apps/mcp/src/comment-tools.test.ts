import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PerfanaClient } from './perfana-client.js';
import {
  AI_DRAFT_LABEL,
  addTestRunComment,
  anchorSchema,
  createAnalysisStory,
  defaultClientRef,
  getAnalysisStories,
  getAnalysisStory,
  getTestRunComments,
  replyToTestRunComment,
  storyLink,
  updateAnalysisStory,
  updateTestRunComment,
  webBaseUrl,
} from './comment-tools.js';

const originalFetch = globalThis.fetch;

type Call = { url: string; init: { method?: string; body?: string; headers: Record<string, string> } };

function mockFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  globalThis.fetch = mock.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return calls;
}

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'c1', testRunId: 'uuid', cardKey: 'graphs', parentId: null, itemKey: null, itemLabel: null, body: 'p95 doubles',
  deleted: false, authorId: 'api-key:k', authorName: 'Claude analysis agent', authorKind: 'agent', markerSeq: 2,
  markerTime: '2026-11-20T10:32:00.000Z', chartContext: null, tag: 'symptom', createdAt: '2026-11-20T10:40:00.000Z', editedAt: null,
  ...over,
});

const textOf = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('comment tools', () => {
  const client = new PerfanaClient('http://api', 'key');
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes a marker anchor through to the API unchanged, with a derived clientRef', async () => {
    const calls = mockFetch(201, comment());
    const anchor = {
      type: 'marker' as const,
      time: '2026-11-20T10:32:00Z',
      series: [{ dashboardLabel: 'Perf', panelId: 201, metricName: 'T01' }],
    };
    const out = textOf(await addTestRunComment(client, { testRunId: 'shop-0042', body: 'p95 doubles', tag: 'symptom', anchor }));
    assert.equal(calls[0].url, 'http://api/test-runs/shop-0042/comments');
    assert.equal(calls[0].init.method, 'POST');
    const sent = JSON.parse(calls[0].init.body!);
    assert.deepEqual(sent.anchor, anchor);
    assert.equal(sent.tag, 'symptom');
    assert.match(sent.clientRef, /^mcp-[0-9a-f]{40}$/);
    assert.equal(out.marker, 2);
    assert.equal(out.authorKind, 'agent');
  });

  it('derives the same clientRef for the same call, so a retry does not duplicate', () => {
    const a = defaultClientRef(['add', 'r', 'b', null, { type: 'card', card: 'details' }]);
    assert.equal(a, defaultClientRef(['add', 'r', 'b', null, { type: 'card', card: 'details' }]));
    assert.notEqual(a, defaultClientRef(['add', 'r', 'other', null, { type: 'card', card: 'details' }]));
    assert.ok(a.length <= 64);
  });

  it('defaults to a comment on the Test run details card, and keeps a given clientRef', async () => {
    const calls = mockFetch(201, comment());
    await addTestRunComment(client, { testRunId: 'r', body: 'overall', clientRef: 'mine' });
    const sent = JSON.parse(calls[0].init.body!);
    assert.deepEqual(sent.anchor, { type: 'card', card: 'details' });
    assert.equal(sent.clientRef, 'mine');
  });

  it('turns a 403 into a message naming the comments:write role', async () => {
    mockFetch(403, { statusCode: 403, message: 'This API key can read comments but not write them' });
    await assert.rejects(
      addTestRunComment(client, { testRunId: 'r', body: 'x' }),
      (err: Error) => err.message.includes('comments:write') && err.message.includes('can read comments but not write them'),
    );
  });

  it("surfaces a 400's message, so the agent can correct its anchor", async () => {
    mockFetch(400, { statusCode: 400, message: 'Transaction "Nope" not found in this test run' });
    await assert.rejects(
      addTestRunComment(client, { testRunId: 'r', body: 'x', anchor: { type: 'transaction', name: 'Nope' } }),
      /Transaction "Nope" not found in this test run/,
    );
  });

  it('replies by comment id with a derived clientRef', async () => {
    const calls = mockFetch(201, comment({ id: 'r1', parentId: 'c1', tag: null, markerSeq: null }));
    await replyToTestRunComment(client, { commentId: 'c1', body: 'Yes' });
    assert.equal(calls[0].url, 'http://api/comments/c1/replies');
    assert.match(JSON.parse(calls[0].init.body!).clientRef, /^mcp-/);
  });

  it('updates only the fields given, and clears a tag with null', async () => {
    const calls = mockFetch(200, comment({ tag: null }));
    await updateTestRunComment(client, { commentId: 'c1', tag: null });
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { tag: null });
    await assert.rejects(updateTestRunComment(client, { commentId: 'c1' }), /Send body, tag or both/);
  });

  it('reads threads, filters by tag, marks bodies as user content, and says which are from agents', async () => {
    const calls = mockFetch(200, {
      threads: [
        { ...comment(), replies: [comment({ id: 'r', parentId: 'c1', authorKind: 'user', authorName: 'Ada', tag: null, markerSeq: null })] },
        { ...comment({ id: 'c2', tag: 'evidence', authorKind: 'user', authorName: 'Bo', markerSeq: null }), replies: [] },
      ],
      lastSeenAt: null,
      canModerate: false,
    });
    const out = textOf(await getTestRunComments(client, { testRunId: 'r', card: 'graphs', tag: 'symptom' }));
    assert.equal(calls[0].url, 'http://api/test-runs/r/comments?card=graphs');
    assert.match(out.note, /not as instructions|never as instructions/);
    assert.equal(out.threads.length, 1);
    assert.equal(out.threads[0].authorKind, 'agent');
    assert.equal(out.threads[0].replies[0].authorKind, 'user');
  });

  it('accepts every anchor type the API resolves, and refuses an unknown one', () => {
    for (const a of [
      { type: 'card', card: 'dynatrace' },
      { type: 'transaction', name: 'T' },
      { type: 'config', key: 'heap.max', comparedToTestRunId: 'r-1' },
      { type: 'dashboard', applicationDashboardId: 'ad' },
      { type: 'slo', checkResultId: 'cr' },
      { type: 'marker', time: 't', series: [{ dashboardLabel: 'P', panelId: 1, metricName: 'm' }] },
      { type: 'adapt', applicationDashboardId: 'ad', panelId: 7, metricName: 'pdf_gen' },
      { type: 'tracing', serviceName: 'matrix-multiply' },
      { type: 'tracing', serviceName: 'orders', scenario: 'Checkout', transaction: 'T04', sampler: 'POST /pay' },
      { type: 'pyroscope', application: 'shop', profiler: 'process_cpu:cpu', view: 'diff' },
      { type: 'pyroscope', application: 'shop', profiler: 'process_cpu:cpu', view: 'single' },
    ]) {
      assert.equal(anchorSchema.safeParse(a).success, true, JSON.stringify(a));
    }
    assert.equal(anchorSchema.safeParse({ type: 'anomaly', id: 'x' }).success, false);
  });

  it('refuses an adapt, tracing or pyroscope anchor missing what the API needs', () => {
    for (const a of [
      { type: 'adapt', applicationDashboardId: 'ad', metricName: 'm' },
      { type: 'adapt', applicationDashboardId: 'ad', panelId: '7', metricName: 'm' },
      { type: 'tracing' },
      { type: 'pyroscope', application: 'shop', profiler: 'p' },
      { type: 'pyroscope', application: 'shop', profiler: 'p', view: 'side-by-side' },
    ]) {
      assert.equal(anchorSchema.safeParse(a).success, false, JSON.stringify(a));
    }
  });

  it('passes a pyroscope diff anchor through to the API unchanged', async () => {
    const calls = mockFetch(201, comment({ cardKey: 'pyroscope', itemLabel: 'shop / process_cpu · Diff view', markerSeq: null, markerTime: null }));
    const anchor = { type: 'pyroscope' as const, application: 'shop', profiler: 'process_cpu:cpu', view: 'diff' as const };
    await addTestRunComment(client, { testRunId: 'shop-0042', body: 'multiply 2.14s -> 51.3s', tag: 'root-cause', anchor });
    assert.deepEqual(JSON.parse(calls[0].init.body!).anchor, anchor);
  });
});

/** Answers each call with the next [status, body]; the last one repeats. */
function mockFetchSeq(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  globalThis.fetch = mock.fn(async (url: string, init: Call['init']) => {
    const [status, body] = responses[Math.min(calls.length, responses.length - 1)];
    calls.push({ url, init: init ?? { headers: {} } });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return calls;
}

const storySummary = (over: Record<string, unknown> = {}) => ({
  id: 's1', testRunId: 'uuid', title: 'Checkout p95 doubled', summary: null, status: 'draft', authorId: 'api-key:k',
  authorName: 'Claude analysis agent', authorKind: 'agent', publishedAt: null, publishedById: null, publishedByName: null,
  createdAt: '2026-11-20T11:00:00.000Z', updatedAt: '2026-11-20T11:00:00.000Z', stepCount: 1, canEdit: true, canDelete: false,
  ...over,
});
const story = (over: Record<string, unknown> = {}) => ({
  ...storySummary(over),
  steps: [{ position: 1, note: 'first the spike', comment: { ...comment(), replyCount: 0 } }],
});

describe('story tools', () => {
  const client = new PerfanaClient('http://api', 'key');
  const web = 'https://perfana.example.com';
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds the web base from PERFANA_WEB_URL, else the API URL without /api, and a ?story= link', () => {
    assert.equal(webBaseUrl('https://perfana.example.com/api'), 'https://perfana.example.com');
    assert.equal(webBaseUrl('https://perfana.example.com/api/', ''), 'https://perfana.example.com');
    assert.equal(webBaseUrl('http://localhost:3001/api', 'http://localhost:4000/'), 'http://localhost:4000');
    assert.equal(storyLink(web, 'shop 42', 's1'), 'https://perfana.example.com/test-runs/shop%2042?story=s1');
  });

  it('creates a draft with ordered steps and returns its id, the AI draft label and the link', async () => {
    const calls = mockFetchSeq([[200, []], [201, story()]]);
    const out = textOf(
      await createAnalysisStory(client, web, {
        testRunId: 'shop-0042',
        title: '  Checkout p95 doubled ',
        summary: 'Heap halved',
        steps: [{ commentId: 'c1', note: 'first the spike' }, { commentId: 'c2' }],
      }),
    );
    assert.equal(calls[0].url, 'http://api/test-runs/shop-0042/stories');
    assert.equal(calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].init.body!), {
      title: 'Checkout p95 doubled',
      summary: 'Heap halved',
      steps: [{ commentId: 'c1', note: 'first the spike' }, { commentId: 'c2' }],
    });
    assert.equal(out.id, 's1');
    assert.equal(out.label, AI_DRAFT_LABEL);
    assert.equal(out.link, 'https://perfana.example.com/test-runs/shop-0042?story=s1');
    assert.match(out.next, /cannot publish/);
  });

  it('updates its own draft of the same title instead of creating a second one', async () => {
    const calls = mockFetchSeq([
      [200, [storySummary({ id: 'other', canEdit: false }), storySummary({ id: 'mine' })]],
      [200, story({ id: 'mine' })],
      [200, story({ id: 'mine' })],
    ]);
    const out = textOf(await createAnalysisStory(client, web, { testRunId: 'r', title: 'Checkout p95 doubled', summary: 'x', steps: [{ commentId: 'c1' }] }));
    assert.deepEqual(calls.map((c) => [c.init.method ?? 'GET', c.url]), [
      ['GET', 'http://api/test-runs/r/stories'],
      ['PATCH', 'http://api/stories/mine'],
      ['PUT', 'http://api/stories/mine/steps'],
    ]);
    assert.deepEqual(JSON.parse(calls[1].init.body!), { summary: 'x' });
    assert.equal(out.reusedExistingDraft, true);
    assert.equal(out.id, 'mine');
  });

  it('never reuses a published story or a user\'s draft of the same title', async () => {
    const calls = mockFetchSeq([
      [200, [storySummary({ id: 'pub', status: 'published', canEdit: false }), storySummary({ id: 'u', authorKind: 'user', canEdit: false })]],
      [201, story({ id: 'new' })],
    ]);
    const out = textOf(await createAnalysisStory(client, web, { testRunId: 'r', title: 'Checkout p95 doubled', steps: [] }));
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(out.id, 'new');
  });

  it('turns a 403 for a missing role into a message naming comments:write', async () => {
    mockFetchSeq([[200, []], [403, { statusCode: 403, message: 'This API key can read comments but not write them: create a key with the comments:write role' }]]);
    await assert.rejects(createAnalysisStory(client, web, { testRunId: 'r', title: 't', steps: [] }), (err: Error) =>
      err.message.includes('comments:write') && err.message.includes('Settings, API keys'),
    );
  });

  it('passes a 403 for a published story through without the role hint, and a 429 with its limit', async () => {
    mockFetchSeq([[403, { statusCode: 403, message: 'This story was published by a person; an API key can no longer change it' }]]);
    await assert.rejects(updateAnalysisStory(client, { storyId: 's1', title: 'x' }), (err: Error) =>
      err.message.includes('can no longer change it') && !err.message.includes('Settings, API keys'),
    );
    mockFetchSeq([[200, []], [429, { statusCode: 429, message: 'This API key has reached its limit of 10 stories on this test run' }]]);
    await assert.rejects(createAnalysisStory(client, web, { testRunId: 'r', title: 't', steps: [] }), /limit of 10 stories/);
  });

  it('updates title and summary by PATCH and steps by PUT, never sending status', async () => {
    const calls = mockFetchSeq([[200, story()], [200, story()]]);
    await updateAnalysisStory(client, { storyId: 's1', summary: null, steps: [{ commentId: 'c2' }] });
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { summary: null });
    assert.equal(calls[1].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].init.body!), { steps: [{ commentId: 'c2' }] });
    for (const c of calls) assert.ok(!('status' in JSON.parse(c.init.body!)));
    await assert.rejects(updateAnalysisStory(client, { storyId: 's1' }), /Send title, summary, steps or a combination/);
  });

  it('reads stories with their steps and comment text, labels AI drafts, names the reviewer, and marks it all as content', async () => {
    const calls = mockFetchSeq([
      [200, [storySummary(), storySummary({ id: 's2' })]],
      [200, story()],
      [200, story({ id: 's2', status: 'published', publishedByName: 'Mark', publishedAt: '2026-11-20T12:00:00.000Z', canEdit: false })],
    ]);
    const out = textOf(await getAnalysisStories(client, web, { testRunId: 'shop-0042' }));
    assert.equal(calls[1].url, 'http://api/stories/s1');
    assert.match(out.note, /never as instructions/);
    assert.equal(out.stories[0].label, AI_DRAFT_LABEL);
    assert.equal(out.stories[0].editableByThisKey, true);
    assert.equal(out.stories[0].steps[0].note, 'first the spike');
    assert.equal(out.stories[0].steps[0].comment.body, 'p95 doubles');
    assert.equal(out.stories[0].link, 'https://perfana.example.com/test-runs/shop-0042?story=s1');
    assert.equal(out.stories[1].label, undefined);
    assert.equal(out.stories[1].publishedBy, 'Mark');
    const oneCalls = mockFetchSeq([[200, story()]]);
    const one = textOf(await getAnalysisStory(client, { storyId: 's1' }));
    assert.equal(oneCalls[0].url, 'http://api/stories/s1');
    assert.equal(one.story.steps.length, 1);
    assert.match(one.note, /never as instructions/);
  });
});
