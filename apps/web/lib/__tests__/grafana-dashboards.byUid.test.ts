import { fetchGrafanaDashboardByUid } from '../grafana-dashboards';
import { authenticatedFetch } from '../api';

jest.mock('../api', () => ({ authenticatedFetch: jest.fn() }));
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const ok = (body: unknown) =>
  ({ ok: true, statusText: 'OK', json: async () => body }) as Response;

/**
 * A dashboard uid is unique only WITHIN a Grafana instance, and
 * GET /grafana/dashboards?uid= applies no instance scope. Callers used to take [0],
 * which bound SLOs and graph presets to another instance's panel ids, silently.
 */
describe('fetchGrafanaDashboardByUid', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('forwards grafanaInstanceId so the server returns one row', async () => {
    mockFetch.mockResolvedValue(ok([{ uid: 'abc', grafana_instance_id: 'gi-1' }]));

    await fetchGrafanaDashboardByUid('abc', 'gi-1');

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('uid=abc');
    expect(url).toContain('grafanaInstanceId=gi-1');
  });

  it('warns instead of silently guessing when the uid is ambiguous', async () => {
    mockFetch.mockResolvedValue(
      ok([
        { uid: 'abc', grafana_instance_id: 'gi-1' },
        { uid: 'abc', grafana_instance_id: 'gi-2' },
      ]),
    );

    const result = await fetchGrafanaDashboardByUid('abc');

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Ambiguous'));
    expect((result as { grafana_instance_id: string }).grafana_instance_id).toBe('gi-1');
  });

  it('stays quiet when an instance was supplied, even if the server answers with several', async () => {
    mockFetch.mockResolvedValue(
      ok([{ uid: 'abc', grafana_instance_id: 'gi-1' }, { uid: 'abc', grafana_instance_id: 'gi-2' }]),
    );

    await fetchGrafanaDashboardByUid('abc', 'gi-1');

    expect(console.warn).not.toHaveBeenCalled();
  });

  // The scoped query matching nothing means the application dashboard's instance id and the
  // Grafana dashboard's disagree. Callers degrade to an empty panel list, which on its own
  // is indistinguishable from "this dashboard has no supported panels".
  it('warns when a SCOPED lookup finds nothing, not only when the uid is ambiguous', async () => {
    mockFetch.mockResolvedValue(ok([]));

    await fetchGrafanaDashboardByUid('abc', 'gi-stale');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Grafana dashboard "abc" on instance gi-stale'),
    );
  });

  it('does not warn about an empty result when no instance was supplied', async () => {
    mockFetch.mockResolvedValue(ok([]));

    await fetchGrafanaDashboardByUid('abc');

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null rather than undefined when nothing matches', async () => {
    mockFetch.mockResolvedValue(ok([]));
    await expect(fetchGrafanaDashboardByUid('nope', 'gi-1')).resolves.toBeNull();
  });

  it('tolerates a bare object instead of an array', async () => {
    mockFetch.mockResolvedValue(ok({ uid: 'abc', grafana_instance_id: 'gi-1' }));
    const result = await fetchGrafanaDashboardByUid('abc', 'gi-1');
    expect((result as { uid: string }).uid).toBe('abc');
  });

  it('escapes the uid, which three of the five converted call sites did not', async () => {
    // Two sites interpolated the uid raw. A uid holding `&` or `=` split the query string
    // and the instance scope alongside it; URLSearchParams closes that for every caller.
    mockFetch.mockResolvedValue(ok([]));

    await fetchGrafanaDashboardByUid('a&grafanaInstanceId=evil', 'gi-1');

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('uid=a%26grafanaInstanceId%3Devil');
    expect(url.match(/grafanaInstanceId=/g)).toHaveLength(1);
    expect(url).toContain('grafanaInstanceId=gi-1');
  });

  it('throws on a failed response rather than returning null', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Boom' } as Response);
    await expect(fetchGrafanaDashboardByUid('abc', 'gi-1')).rejects.toThrow(/Boom/);
  });
});
