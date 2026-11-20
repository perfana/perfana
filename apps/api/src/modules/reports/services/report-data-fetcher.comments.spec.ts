// What this guards: the Comments section reads comments for the report's own run only, and
// only those whose organization is that run's (a caller-supplied id never enters the query:
// the run is the one the report was generated for). For a real user the usual org filter is
// added on top; for the background job (no userId) it is not. Common Issue #59 is the leak this
// shape avoids.
import { ReportDataFetcherService } from './report-data-fetcher.service';
import { TestRun } from '@perfana/shared';

const testRun = { id: 'run-uuid', testRunId: 'App-acc-load-00001' } as unknown as TestRun;

function makeService(orgs: string[] | 'admin') {
  const query = jest.fn().mockResolvedValue([{
    id: 'c1', card_key: 'slo', parent_id: null, body: 'b', author_name: 'Ada', item_label: null,
    marker_seq: null, marker_time: null, chart_context: null,
    created_at: '2026-11-20T10:00:00Z', edited_at: null, deleted_at: null,
  }]);
  const service = new ReportDataFetcherService(
    { query } as never,
    {
      isGlobalAdmin: () => orgs === 'admin',
      getAccessibleOrganizations: jest.fn().mockResolvedValue(orgs === 'admin' ? [] : orgs),
    } as never,
    { query: jest.fn() } as never,
  );
  return { service, query };
}

describe('ReportDataFetcherService.getTestRunComments', () => {
  it('scopes to the run and to the run\'s own organization, with no org filter for the background job', async () => {
    const { service, query } = makeService('admin');
    const rows = await service.getTestRunComments(testRun, null);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/c\.test_run_id = \$1/);
    expect(sql).toMatch(/c\.organization_id = sut\.organization_id/);
    expect(sql).not.toMatch(/tr\.organization_id IN/);
    expect(params).toEqual(['run-uuid']);
    expect(rows[0]).toMatchObject({ id: 'c1', cardKey: 'slo', authorName: 'Ada', createdAt: new Date('2026-11-20T10:00:00Z') });
  });

  it('adds the card filter and a real user\'s org filter as bound parameters', async () => {
    const { service, query } = makeService(['org-1']);
    await service.getTestRunComments(testRun, ['slo', 'graphs'], 'user-1', []);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/c\.card_key = ANY\(\$2::varchar\[\]\)/);
    expect(sql).toMatch(/AND tr\.organization_id IN \(\$3\)/);
    expect(params).toEqual(['run-uuid', ['slo', 'graphs'], 'org-1']);
  });

  it('reads nothing for a user with no organizations', async () => {
    const { service, query } = makeService([]);
    await service.getTestRunComments(testRun, null, 'user-1', []);
    expect(query.mock.calls[0][0]).toMatch(/AND FALSE/);
  });
});
