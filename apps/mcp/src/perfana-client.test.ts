import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PerfanaClient } from './perfana-client.js';

// ─── Fetch mock setup ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  const fn = mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  const fn = mock.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('PerfanaClient', () => {
  const client = new PerfanaClient('http://localhost:3001/api', 'test-api-key');

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Auth headers ──────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('sends Authorization header when API key is set', async () => {
      const fetchMock = mockFetch(200, { test_run_id: 'run-1' });
      await client.getTestRun('run-1');

      const call = fetchMock.mock.calls[0] as { arguments: unknown[] };
      const options = call.arguments[1] as RequestInit;
      const headers = options.headers as Record<string, string>;
      assert.equal(headers['Authorization'], 'Bearer test-api-key');
    });

    it('omits Authorization header when API key is empty', async () => {
      const noKeyClient = new PerfanaClient('http://localhost:3001/api', '');
      const fetchMock = mockFetch(200, { test_run_id: 'run-1' });
      await noKeyClient.getTestRun('run-1');

      const call = fetchMock.mock.calls[0] as { arguments: unknown[] };
      const options = call.arguments[1] as RequestInit;
      const headers = options.headers as Record<string, string>;
      assert.equal(headers['Authorization'], undefined);
    });
  });

  // ─── getTestRun ────────────────────────────────────────────────────────────

  describe('getTestRun', () => {
    it('fetches from correct URL', async () => {
      const fetchMock = mockFetch(200, { test_run_id: 'my-run' });
      await client.getTestRun('my-run');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.equal(url, 'http://localhost:3001/api/test-runs/my-run');
    });

    it('encodes special characters in test run ID', async () => {
      const fetchMock = mockFetch(200, { test_run_id: 'run with spaces' });
      await client.getTestRun('run with spaces');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(url.includes('run%20with%20spaces'));
    });

    it('throws on 404', async () => {
      mockFetch(404, { message: 'Not found' });
      await assert.rejects(
        () => client.getTestRun('nonexistent'),
        (err: Error) => {
          assert.ok(err.message.includes('404'));
          return true;
        },
      );
    });

    it('throws on 500', async () => {
      mockFetch(500, { message: 'Server error' });
      await assert.rejects(
        () => client.getTestRun('run-1'),
        (err: Error) => {
          assert.ok(err.message.includes('500'));
          return true;
        },
      );
    });
  });

  // ─── getRecentRuns ─────────────────────────────────────────────────────────

  describe('getRecentRuns', () => {
    it('sends correct pagination params', async () => {
      const fetchMock = mockFetch(200, { data: [] });
      await client.getRecentRuns('MyApp', 'production', 'loadtest', 5);

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(url.includes('sortBy=startTime'));
      assert.ok(url.includes('sortOrder=DESC'));
      assert.ok(url.includes('pageSize=50'));
    });

    it('filters by system_under_test name', async () => {
      mockFetch(200, {
        data: [
          { test_run_id: 'r1', systems_under_test: { name: 'MyApp' }, test_environment: 'prod', workload: 'load' },
          { test_run_id: 'r2', systems_under_test: { name: 'OtherApp' }, test_environment: 'prod', workload: 'load' },
          { test_run_id: 'r3', systems_under_test: { name: 'MyApp' }, test_environment: 'staging', workload: 'load' },
        ],
      });
      const result = await client.getRecentRuns('MyApp', 'prod', 'load', 10);

      assert.equal(result.length, 1);
      assert.equal(result[0].test_run_id, 'r1');
    });

    it('respects limit', async () => {
      mockFetch(200, {
        data: [
          { test_run_id: 'r1', systems_under_test: { name: 'App' }, test_environment: 'prod', workload: 'load' },
          { test_run_id: 'r2', systems_under_test: { name: 'App' }, test_environment: 'prod', workload: 'load' },
          { test_run_id: 'r3', systems_under_test: { name: 'App' }, test_environment: 'prod', workload: 'load' },
        ],
      });
      const result = await client.getRecentRuns('App', 'prod', 'load', 2);

      assert.equal(result.length, 2);
    });

    it('returns empty when no matches', async () => {
      mockFetch(200, { data: [] });
      const result = await client.getRecentRuns('NoSuch', 'prod', 'load');

      assert.equal(result.length, 0);
    });

    it('caps pageSize at 100', async () => {
      const fetchMock = mockFetch(200, { data: [] });
      await client.getRecentRuns('App', 'prod', 'load', 50);

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      // limit * 10 = 500, capped at 100
      assert.ok(url.includes('pageSize=100'));
    });
  });

  // ─── getTransactionStats ───────────────────────────────────────────────────

  describe('getTransactionStats', () => {
    it('includes excludeRampUp param', async () => {
      const fetchMock = mockFetch(200, []);
      await client.getTransactionStats('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(url.includes('excludeRampUp=true'));
    });

    it('includes sinceMinutes when provided', async () => {
      const fetchMock = mockFetch(200, []);
      await client.getTransactionStats('run-1', 10);

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(url.includes('sinceMinutes=10'));
    });

    it('omits sinceMinutes when not provided', async () => {
      const fetchMock = mockFetch(200, []);
      await client.getTransactionStats('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(!url.includes('sinceMinutes'));
    });
  });

  // ─── getTestRunConfigs ─────────────────────────────────────────────────────

  describe('getTestRunConfigs', () => {
    it('fetches from correct URL', async () => {
      const fetchMock = mockFetch(200, []);
      await client.getTestRunConfigs('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.equal(url, 'http://localhost:3001/api/test-runs/run-1/configs');
    });
  });

  // ─── getCheckResults ───────────────────────────────────────────────────────

  describe('getCheckResults', () => {
    it('fetches from correct URL', async () => {
      const fetchMock = mockFetch(200, []);
      await client.getCheckResults('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.equal(url, 'http://localhost:3001/api/test-runs/run-1/check-results');
    });
  });

  // ─── getAdaptConclusion ────────────────────────────────────────────────────

  describe('getAdaptConclusion', () => {
    it('fetches from correct URL', async () => {
      const fetchMock = mockFetch(200, { conclusion: 'pass' });
      await client.getAdaptConclusion('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.equal(url, 'http://localhost:3001/api/adapt/conclusion/run-1/enriched');
    });
  });

  // ─── getTrackedRegressions ─────────────────────────────────────────────────

  describe('getTrackedRegressions', () => {
    it('passes testRunId as query param', async () => {
      const fetchMock = mockFetch(200, { regressions: [] });
      await client.getTrackedRegressions('run-1');

      const url = (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] as string;
      assert.ok(url.includes('testRunId=run-1'));
    });
  });

  // ─── getDeepLinks ──────────────────────────────────────────────────────────

  describe('getDeepLinks', () => {
    it('fetches test run then deep links then resolves each', async () => {
      const fetchMock = mockFetchSequence([
        // 1. getTestRun
        {
          status: 200,
          body: {
            test_run_id: 'run-1',
            system_under_test_id: 'sut-1',
            test_environment: 'prod',
            workload: 'load',
          },
        },
        // 2. deep-links list
        {
          status: 200,
          body: [{ id: 'dl-1', name: 'Grafana', url: 'http://grafana/d/1', tags: [] }],
        },
        // 3. resolve dl-1
        {
          status: 200,
          body: { id: 'dl-1', name: 'Grafana', url: 'http://grafana/d/1?from=...', tags: [], hasUnresolvedVariables: false },
        },
      ]);

      const result = await client.getDeepLinks('run-1');

      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'dl-1');
      assert.equal(fetchMock.mock.calls.length, 3);
    });

    it('skips failed individual resolve calls', async () => {
      mockFetchSequence([
        // 1. getTestRun
        {
          status: 200,
          body: {
            test_run_id: 'run-1',
            system_under_test_id: 'sut-1',
            test_environment: 'prod',
            workload: 'load',
          },
        },
        // 2. deep-links list
        {
          status: 200,
          body: [
            { id: 'dl-1', name: 'Link1', url: 'http://a', tags: [] },
            { id: 'dl-2', name: 'Link2', url: 'http://b', tags: [] },
          ],
        },
        // 3. resolve dl-1 — succeeds
        {
          status: 200,
          body: { id: 'dl-1', name: 'Link1', url: 'http://a', tags: [], hasUnresolvedVariables: false },
        },
        // 4. resolve dl-2 — fails
        { status: 500, body: { message: 'error' } },
      ]);

      const result = await client.getDeepLinks('run-1');

      // Only the successful one should be returned
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'dl-1');
    });
  });
});
