import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PerfanaClient } from './perfana-client.js';
import {
  addTestRunComment,
  anchorSchema,
  defaultClientRef,
  getTestRunComments,
  replyToTestRunComment,
  updateTestRunComment,
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
    ]) {
      assert.equal(anchorSchema.safeParse(a).success, true, JSON.stringify(a));
    }
    assert.equal(anchorSchema.safeParse({ type: 'anomaly', id: 'x' }).success, false);
  });
});
