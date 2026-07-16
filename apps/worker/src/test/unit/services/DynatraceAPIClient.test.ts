import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DynatraceAPIClient } from '../../../services/dynatrace/DynatraceAPIClient.js';

// Mock axios (default export used as axios.get / axios.post; named isAxiosError).
const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('axios', () => ({
  default: { get: mockGet, post: mockPost },
  isAxiosError: (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e),
}));

// Mock logger
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// axios-shaped responses
const ok = (data: unknown) => ({ status: 200, data, headers: { 'content-type': 'application/json' } });
const resp = (status: number, data: unknown) => ({ status, data, headers: { 'content-type': 'application/json' } });

describe('DynatraceAPIClient', () => {
  let client: DynatraceAPIClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('Configuration and Initialization', () => {
    it('should initialize with SaaS configuration and convert host URL', () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
      expect(client).toBeDefined();
    });

    it('should initialize with Managed configuration and keep original host URL', () => {
      client = new DynatraceAPIClient({
        host: 'dynatrace.example.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'managed',
      });
      expect(client).toBeDefined();
    });

    it('should apply default configuration values', () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
      expect(client).toBeDefined();
    });

    it('should handle host URLs with https:// prefix', () => {
      client = new DynatraceAPIClient({
        host: 'https://live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
      expect(client).toBeDefined();
    });

    it('should remove trailing slash from host URL', () => {
      client = new DynatraceAPIClient({
        host: 'https://live.dynatrace.com/',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
      expect(client).toBeDefined();
    });

    it('should use live.dynatrace.com for Metrics API and apps.dynatrace.com for DQL on SaaS', async () => {
      client = new DynatraceAPIClient({
        host: 'oti61760.live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });

      // Metric selector → Metrics API v2 (GET) on live.dynatrace.com
      mockGet.mockResolvedValueOnce(ok({
        result: [{
          metricId: 'builtin:host.cpu.usage',
          data: [{ dimensionMap: { 'dt.entity.host': 'HOST-123' }, timestamps: [1704067200000], values: [50.5] }],
        }],
      }));
      await client.executeQuery('builtin:host.cpu.usage:filter(eq("dt.entity.host","HOST-123")):avg');
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('oti61760.live.dynatrace.com/api/v2/metrics/query'),
        expect.any(Object)
      );

      // DQL query → DQL API (POST) on apps.dynatrace.com
      mockPost.mockResolvedValueOnce(ok({ state: 'SUCCEEDED', result: { records: [] } }));
      await client.executeQuery('timeseries avg(dt.host.cpu.usage)');
      expect(mockPost).toHaveBeenLastCalledWith(
        expect.stringContaining('oti61760.apps.dynatrace.com/platform/storage/query/v1/query:execute'),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('DQL Query Execution - SaaS', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
    });

    it('should execute DQL query with immediate success (HTTP 200)', async () => {
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      mockPost.mockResolvedValue(ok({
        state: 'SUCCEEDED',
        result: { records: [{ timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 50.5 }] },
      }));

      const result = await client.executeQuery(query);

      expect(result).toEqual({
        records: [{ timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 50.5 }],
      });
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/platform/storage/query/v1/query:execute'),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-platform-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should execute DQL query with async execution (HTTP 202) and poll for results', async () => {
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const requestToken = 'test-request-token-123';

      mockPost.mockResolvedValueOnce(resp(202, { state: 'RUNNING', requestToken }));
      mockGet
        .mockResolvedValueOnce(ok({ state: 'RUNNING' }))
        .mockResolvedValueOnce(ok({
          state: 'SUCCEEDED',
          result: { records: [{ timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 75.2 }] },
        }));

      const result = await client.executeQuery(query);

      expect(result).toEqual({
        records: [{ timestamp: '2024-01-01T00:00:00Z', 'dt.entity.host': 'HOST-123', value: 75.2 }],
      });
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(`/platform/storage/query/v1/query:poll?request-token=${requestToken}`),
        expect.any(Object)
      );
    });

    it('should handle DQL query failure during polling', async () => {
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const requestToken = 'test-request-token-456';

      mockPost.mockResolvedValueOnce(resp(202, { state: 'RUNNING', requestToken }));
      mockGet.mockResolvedValueOnce(ok({
        state: 'FAILED',
        error: { code: 'QUERY_ERROR', message: 'Invalid DQL syntax' },
      }));

      await expect(client.executeQuery(query)).rejects.toThrow('DQL query failed: Invalid DQL syntax');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should handle polling timeout', async () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxPollWaitMs: 100,
        pollInterval: 10,
      });
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';

      mockPost.mockResolvedValueOnce(resp(202, { state: 'RUNNING', requestToken: 'test-request-token-789' }));
      mockGet.mockResolvedValue(ok({ state: 'RUNNING' })); // always RUNNING

      await expect(client.executeQuery(query)).rejects.toThrow(/timed out/);
    });

    it('should include timeframe in DQL query request', async () => {
      const query = 'timeseries avg(dt.host.cpu.usage) by: {dt.entity.host}';
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      mockPost.mockResolvedValue(ok({ state: 'SUCCEEDED', result: { records: [] } }));

      await client.executeQuery(query, startTime, endTime);

      // axios.post(url, payload, config) — payload is the 2nd argument (an object).
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ defaultTimeframeStart: '2024-01-01T00:00:00.000Z' }),
        expect.any(Object)
      );
    });

    it('should retry on network errors with exponential backoff', async () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 3,
      });
      const query = 'timeseries avg(dt.host.cpu.usage)';

      mockPost
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(ok({ state: 'SUCCEEDED', result: { records: [] } }));

      const result = await client.executeQuery(query);

      expect(result).toEqual({ records: [] });
      expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it('should fail after maximum retries', async () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 2,
      });
      const query = 'timeseries avg(dt.host.cpu.usage)';

      mockPost.mockRejectedValue(new Error('Persistent network error'));

      await expect(client.executeQuery(query)).rejects.toThrow('Persistent network error');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('Metrics API v2 Execution - Managed', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'dynatrace.example.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'managed',
      });
    });

    it('should execute Metrics API v2 query successfully', async () => {
      const metricSelector = 'builtin:host.cpu.system:filter(eq("dt.entity.host",HOST-123)):avg';
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      mockGet.mockResolvedValue(ok({
        result: [{
          metricId: 'builtin:host.cpu.system',
          data: [{ dimensionMap: { 'dt.entity.host': 'HOST-123' }, timestamps: [1704067200000, 1704067260000], values: [25.5, 30.2] }],
        }],
      }));

      const result = await client.executeQuery(metricSelector, startTime, endTime) as { records: Array<Record<string, unknown>> };

      expect(result.records).toBeDefined();
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({ 'dt.entity.host': 'HOST-123', value: 25.5 });
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/metrics/query'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': 'Api-Token test-api-token' }),
        })
      );
    });

    it('should transform Metrics API v2 response to DQL-like format', async () => {
      const metricSelector = 'builtin:host.cpu.system:avg';
      mockGet.mockResolvedValue(ok({
        result: [{
          metricId: 'builtin:host.cpu.system',
          data: [{ dimensionMap: { 'dt.entity.host': 'HOST-456' }, timestamps: [1704067200000], values: [42.7] }],
        }],
      }));

      const result = await client.executeQuery(metricSelector) as { records: Array<Record<string, unknown>> };

      expect(result).toHaveProperty('records');
      expect(result.records[0]).toHaveProperty('timestamp');
      expect(result.records[0]).toHaveProperty('value');
      expect(result.records[0]).toHaveProperty('dt.entity.host', 'HOST-456');
      expect(result.records[0].value).toBe(42.7);
    });

    it('should handle empty Metrics API v2 response', async () => {
      mockGet.mockResolvedValue(ok({ result: [] }));
      const result = await client.executeQuery('builtin:host.cpu.system:avg');
      expect(result).toEqual({ records: [] });
    });

    it('should handle Metrics API v2 error response', async () => {
      mockGet.mockResolvedValue(resp(400, { error: { code: 400, message: 'Invalid metric selector' } }));
      await expect(client.executeQuery('invalid:metric:selector')).rejects.toThrow(/failed with status 400/);
    });

    it('should use default timeframe when not provided', async () => {
      mockGet.mockResolvedValue(ok({ result: [] }));
      await client.executeQuery('builtin:host.cpu.system:avg');
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringMatching(/from=\d+&to=\d+/),
        expect.any(Object)
      );
    });
  });

  describe('Batch Query Execution', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxConcurrent: 2,
      });
    });

    it('should execute multiple queries in batch', async () => {
      const queries = [
        { tileId: 'tile-1', tileTitle: 'CPU Usage', query: 'timeseries avg(dt.host.cpu.usage)' },
        { tileId: 'tile-2', tileTitle: 'Memory Usage', query: 'timeseries avg(dt.host.memory.usage)' },
      ];

      mockPost
        .mockResolvedValueOnce(ok({ state: 'SUCCEEDED', result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 50 }] } }))
        .mockResolvedValueOnce(ok({ state: 'SUCCEEDED', result: { records: [{ timestamp: '2024-01-01T00:00:00Z', value: 75 }] } }));

      const results = await client.executeBatchQueries(queries);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ tileId: 'tile-1', tileTitle: 'CPU Usage', error: null });
      expect(results[1]).toMatchObject({ tileId: 'tile-2', tileTitle: 'Memory Usage', error: null });
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should handle partial batch failures gracefully', async () => {
      const queries = [
        { tileId: 'tile-1', tileTitle: 'CPU Usage', query: 'timeseries avg(dt.host.cpu.usage)' },
        { tileId: 'tile-2', tileTitle: 'Invalid', query: 'invalid query' },
      ];

      let callCount = 0;
      mockPost.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return ok({ state: 'SUCCEEDED', result: { records: [] } });
        throw new Error('Query syntax error');
      });

      const results = await client.executeBatchQueries(queries);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBeNull();
      expect(results[1].error).toContain('Query syntax error');
    });

    it('should respect maxConcurrent limit', async () => {
      const queries = Array.from({ length: 10 }, (_, i) => ({
        tileId: `tile-${i}`,
        tileTitle: `Query ${i}`,
        query: `query ${i}`,
      }));

      mockPost.mockResolvedValue(ok({ state: 'SUCCEEDED', result: { records: [] } }));

      const results = await client.executeBatchQueries(queries);

      expect(results).toHaveLength(10);
      expect(mockPost).toHaveBeenCalledTimes(10);
      expect(results.every(r => r.error === null)).toBe(true);
    });
  });

  describe('Concurrency Control (Semaphore)', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxConcurrent: 1, // Force sequential execution
      });
    });

    it('should limit concurrent requests based on maxConcurrent', async () => {
      let activeRequests = 0;
      let maxActiveRequests = 0;

      mockPost.mockImplementation(async () => {
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeRequests--;
        return ok({ state: 'SUCCEEDED', result: { records: [] } });
      });

      await Promise.all([
        client.executeQuery('query 1'),
        client.executeQuery('query 2'),
        client.executeQuery('query 3'),
      ]);

      expect(maxActiveRequests).toBe(1);
      expect(mockPost).toHaveBeenCalledTimes(3);
    });
  });

  describe('Resource Cleanup', () => {
    it('should close without error (no persistent agent to destroy)', async () => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
      });
      await expect(client.close()).resolves.toBeUndefined();
    });
  });

  describe('Query Format Detection and Routing', () => {
    describe('Metric Selector Detection (routes to Metrics API v2)', () => {
      beforeEach(() => {
        client = new DynatraceAPIClient({
          host: 'live.dynatrace.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'saas',
        });
      });

      const expectMetricsGet = () =>
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/v2/metrics/query'), expect.any(Object));

      it('should route builtin: metric selectors to Metrics API v2', async () => {
        mockGet.mockResolvedValue(ok({
          result: [{ metricId: 'builtin:host.cpu.usage', data: [{ dimensionMap: {}, timestamps: [1704067200000], values: [50.5] }] }],
        }));
        await client.executeQuery('builtin:host.cpu.usage:filter(eq("dt.entity.host","HOST-123")):avg');
        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/metrics/query'),
          expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Api-Token test-api-token' }) })
        );
      });

      it('should route ext: metric selectors to Metrics API v2', async () => {
        mockGet.mockResolvedValue(ok({ result: [] }));
        await client.executeQuery('ext:custom.metric:filter(eq("dt.entity.service","SVC-123")):sum');
        expectMetricsGet();
      });

      it('should route calc: metric selectors to Metrics API v2', async () => {
        mockGet.mockResolvedValue(ok({ result: [] }));
        await client.executeQuery('calc:service.availability:avg');
        expectMetricsGet();
      });

      it('should route queries with :splitBy transformation to Metrics API v2', async () => {
        mockGet.mockResolvedValue(ok({ result: [] }));
        await client.executeQuery('builtin:host.mem.usage:splitBy("dt.entity.host"):avg');
        expectMetricsGet();
      });

      it('should route queries ending with :avg aggregation to Metrics API v2', async () => {
        mockGet.mockResolvedValue(ok({ result: [] }));
        await client.executeQuery('builtin:host.disk.utilTime:avg');
        expectMetricsGet();
      });
    });

    describe('DQL Query Detection (routes to DQL API)', () => {
      beforeEach(() => {
        client = new DynatraceAPIClient({
          host: 'live.dynatrace.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'saas',
        });
        mockPost.mockResolvedValue(ok({ state: 'SUCCEEDED', result: { records: [] } }));
      });

      const expectDqlPost = () =>
        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object),
          expect.any(Object)
        );

      it('should route fetch queries to DQL API', async () => {
        await client.executeQuery('fetch logs | filter status == "ERROR" | limit 100');
        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object),
          expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer test-platform-token' }) })
        );
      });

      it('should route timeseries queries to DQL API', async () => {
        await client.executeQuery('timeseries avg(dt.host.cpu.usage), by:{dt.entity.host}');
        expectDqlPost();
      });

      it('should route SELECT queries to DQL API', async () => {
        await client.executeQuery('SELECT timestamp, value FROM dt.host.cpu.usage WHERE host = "HOST-123"');
        expectDqlPost();
      });

      it('should route queries with | filter pipe syntax to DQL API', async () => {
        await client.executeQuery('data | filter host.name == "server-01" | summarize count()');
        expectDqlPost();
      });
    });

    describe('Mixed Environment Routing', () => {
      it('should route metric selectors to Metrics API on managed instances', async () => {
        client = new DynatraceAPIClient({
          host: 'dynatrace.example.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'managed',
        });
        mockGet.mockResolvedValue(ok({ result: [] }));
        await client.executeQuery('builtin:host.cpu.usage:avg');
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/v2/metrics/query'), expect.any(Object));
      });

      it('should route DQL queries to DQL API even on managed instances (if supported)', async () => {
        client = new DynatraceAPIClient({
          host: 'dynatrace.example.com',
          apiToken: 'test-api-token',
          platformToken: 'test-platform-token',
          dynatraceType: 'managed',
        });
        mockPost.mockResolvedValue(ok({ state: 'SUCCEEDED', result: { records: [] } }));
        await client.executeQuery('fetch logs | filter level == "ERROR"');
        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/platform/storage/query/v1/query:execute'),
          expect.any(Object),
          expect.any(Object)
        );
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      client = new DynatraceAPIClient({
        host: 'live.dynatrace.com',
        apiToken: 'test-api-token',
        platformToken: 'test-platform-token',
        dynatraceType: 'saas',
        maxRetries: 1,
      });
    });

    it('should handle unexpected status codes', async () => {
      mockPost.mockResolvedValue(resp(500, { error: { message: 'Internal server error' } }));
      await expect(client.executeQuery('timeseries avg(dt.host.cpu.usage)')).rejects.toThrow(/Unexpected status code 500/);
    });

    it('should handle malformed response data', async () => {
      mockPost.mockResolvedValue(resp(200, null)); // null body → data.state throws
      await expect(client.executeQuery('timeseries avg(dt.host.cpu.usage)')).rejects.toThrow();
    });

    it('should retry poll request timeout/abort errors', async () => {
      const query = 'timeseries avg(dt.host.cpu.usage)';
      const requestToken = 'test-token';

      mockPost.mockResolvedValueOnce(resp(202, { state: 'RUNNING', requestToken }));

      const abortError = new Error('Request aborted') as Error & { code?: string; isAxiosError?: boolean };
      abortError.code = 'ECONNABORTED';
      abortError.isAxiosError = true;

      mockGet
        .mockRejectedValueOnce(abortError) // first poll times out → retry
        .mockResolvedValueOnce(ok({ state: 'SUCCEEDED', result: { records: [] } }));

      const result = await client.executeQuery(query);

      expect(result).toEqual({ records: [] });
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });
});
