/**
 * The URL-dimension queries read `test_run_sampler_stats`, which keys on the HUMAN test_run_id
 * ("PerfanaWebshop-acc-loadTest-00003"), not the row UUID. Nine other queries in this service
 * resolve whichever form the caller holds through `resolveTestRunId`; these three did not.
 *
 * The report dialog passed `testRun.id` — the UUID — so `WHERE s.test_run_id = $1` matched
 * nothing, and selecting the "URL RT" panel in a comparison section offered no series at all.
 * No error: the query succeeded and returned zero rows, which is indistinguishable from a run
 * that genuinely recorded no URLs.
 *
 * These pin the resolution, so dropping it again fails here rather than in a dropdown.
 */

jest.mock('../../../common/db/request-em', () => ({
  withRequestEm: (repo: unknown) => repo,
}));

import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';

const UUID = 'c5db2ea6-d814-46db-b3f1-976dd36c3b08';
const HUMAN_ID = 'PerfanaWebshop-acc-loadTest-00004';

describe('performance query service — URL lookups accept either id form', () => {
  let service: TestRunsPerformanceQueryService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    service = new TestRunsPerformanceQueryService(
      { query } as never,
      ...([{}, {}, {}, {}, {}, {}] as never[]),
    );
  });

  /** The id every query after the resolution step was given. */
  const idsUsedInStatsQueries = () =>
    query.mock.calls
      .filter(([sql]) => /test_run_sampler_stats/.test(sql as string))
      .flatMap(([, params]) => (params as unknown[]) ?? []);

  it('resolves a UUID to the human id before querying the sampler stats', async () => {
    // First call is the resolution lookup; the stats query follows.
    query.mockResolvedValueOnce([{ test_run_id: HUMAN_ID }]).mockResolvedValueOnce([]);

    await service.getUrlDistinctNames(UUID, true, []);

    expect(query.mock.calls[0]![0]).toMatch(/SELECT test_run_id FROM test_runs WHERE id/);
    expect(idsUsedInStatsQueries()).toContain(HUMAN_ID);
    expect(idsUsedInStatsQueries()).not.toContain(UUID);
  });

  it('passes a human id straight through, without a lookup', async () => {
    await service.getUrlDistinctNames(HUMAN_ID, true, []);

    expect(query).toHaveBeenCalledTimes(1);
    expect(idsUsedInStatsQueries()).toContain(HUMAN_ID);
  });

  it('resolves for the sampler-url map too', async () => {
    query.mockResolvedValueOnce([{ test_run_id: HUMAN_ID }]).mockResolvedValueOnce([]);

    await service.getSamplerUrlMap(UUID, true, []);

    expect(idsUsedInStatsQueries()).toContain(HUMAN_ID);
    expect(idsUsedInStatsQueries()).not.toContain(UUID);
  });

  it('resolves every id for the multi-run statistics query', async () => {
    query
      .mockResolvedValueOnce([{ test_run_id: HUMAN_ID }])
      .mockResolvedValueOnce([{ test_run_id: 'PerfanaWebshop-acc-loadTest-00003' }])
      .mockResolvedValueOnce([]);

    await service.getUrlMetricStatistics(
      [UUID, '0751523b-09f1-4d0f-b2a4-61d1ac5ff947'],
      'response_time',
      true,
      [],
    );

    const ids = idsUsedInStatsQueries().flat();
    expect(ids).toContain(HUMAN_ID);
    expect(ids).toContain('PerfanaWebshop-acc-loadTest-00003');
  });
});
