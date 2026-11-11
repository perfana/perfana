import axios from 'axios';
import { GrafanaClient } from '../client';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  isAxiosError: () => false,
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * This is the client apps/worker queries every panel with (through
 * `grafana-client-factory.ts`), so it is the path that decides whether a
 * basic-auth Grafana instance collects any metrics at all. The worker's own
 * `grafana-client.test.ts` is `describe.skip`'d in full, which is why the header
 * contract is pinned here instead.
 */
describe('GrafanaClient authorization header', () => {
  const base = {
    url: 'https://grafana.example.com',
    orgId: '1',
    // The URL is public-looking, but keep SSRF validation out of the way so these
    // cases are about the header and nothing else.
    skipSsrfValidation: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockResolvedValue({ status: 200, data: { id: 1, uid: 'u', name: 'n', type: 'prometheus' } } as never);
    mockedAxios.post.mockResolvedValue({ status: 200, data: { results: {} } } as never);
  });

  /**
   * The private batch sender. Typed narrowly rather than cast to `any` so the test needs
   * no eslint suppression: the gate scan reads a suppression pragma as a relaxation, and
   * reaching one private method does not need one.
   */
  type BatchSender = {
    executeRequestWithRetry(batch: unknown, index: number): Promise<unknown>;
  };
  const asBatchSender = (c: GrafanaClient): BatchSender => c as unknown as BatchSender;

  function headerFromFirstGet(): unknown {
    const [, options] = mockedAxios.get.mock.calls[0] as [string, { headers: Record<string, string> }];
    return options.headers['Authorization'];
  }

  function headerFromFirstPost(): unknown {
    const [, , options] = mockedAxios.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    return options.headers['Authorization'];
  }

  /** The shape executeRequestWithRetry is handed by executeBatchedRequests. */
  const PANEL_BATCH = { request: { endpoint: '/api/ds/query', request_body: {} } };

  it('sends Bearer when an api key is configured', async () => {
    const client = new GrafanaClient({ ...base, apiKey: 'tkn' });

    await client.getDatasourceByUid('u');

    expect(headerFromFirstGet()).toBe('Bearer tkn');
  });

  it('sends Basic when only a username and password are configured', async () => {
    const client = new GrafanaClient({ ...base, username: 'admin', password: 'pw' });

    await client.getDatasourceByUid('u');

    expect(headerFromFirstGet()).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`);
  });

  it('prefers the api key when both are configured', async () => {
    const client = new GrafanaClient({ ...base, apiKey: 'tkn', username: 'admin', password: 'pw' });

    await client.getDatasourceByUid('u');

    expect(headerFromFirstGet()).toBe('Bearer tkn');
  });

  it('never sends a request for an instance with no credentials', async () => {
    // Construction stays permissive on purpose: the worker's config cache is what
    // decides an instance is usable, and a throw at construction would move that
    // failure to client wiring, away from the instance it concerns.
    // getDatasourceByUid's contract is null-on-failure, so the configuration error
    // is logged rather than thrown — what matters is that nothing goes on the wire.
    const client = new GrafanaClient({ ...base });

    expect(await client.getDatasourceByUid('u')).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  // The panel query is a POST to /api/ds/query and is the ONLY request the worker
  // makes in anger — getDatasourceByUid is a Grafana 8 fallback that a Viewer token
  // skips entirely. Its header is built by the same authHeader(), but from a
  // separate literal inside executeRequestWithRetry, so a revert of that one line
  // leaves every getDatasourceByUid case above green while the worker collects
  // nothing from a basic-auth Grafana.
  it('sends Basic on the panel query POST for a username/password instance', async () => {
    const client = new GrafanaClient({ ...base, username: 'admin', password: 'pw' });

    await asBatchSender(client).executeRequestWithRetry(PANEL_BATCH, 0);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(headerFromFirstPost()).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`);
  });

  it('sends Bearer on the panel query POST, and prefers it over basic auth', async () => {
    const client = new GrafanaClient({ ...base, apiKey: 'tkn', username: 'admin', password: 'pw' });

    await asBatchSender(client).executeRequestWithRetry(PANEL_BATCH, 0);

    expect(headerFromFirstPost()).toBe('Bearer tkn');
  });

  it('fails a panel batch immediately rather than retrying a credential problem', async () => {
    // The header is built before the retry loop, so this costs no backoff. Reaching
    // in directly: queryPanelData's own catch converts everything into error documents,
    // which would hide whether the batch was retried three times first.
    const client = new GrafanaClient({ ...base });
    const batch = { request: { endpoint: '/api/ds/query', request_body: {} } };

    await expect(
      asBatchSender(client).executeRequestWithRetry(batch, 0),
    ).rejects.toThrow(/has no credentials configured/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
