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

// The Comments section's `stories` layout (analysis stories, PR5): published stories of the
// report's own run only, never a draft, and story, step and comment all in the organization of
// the run's system. The SQL is run against Postgres in src/test/rls/report-stories-fetch.spec.ts.
describe('ReportDataFetcherService.getPublishedStories', () => {
  const step = (over: Record<string, unknown>) => ({
    story_id: 's1', story_title: 'T1', story_summary: 'sum', story_author: 'Ada', published_at: '2026-11-20T10:00:00Z',
    position: 1, note: null, id: 'c1', card_key: 'slo', parent_id: null, body: 'b', author_name: 'Bob', item_label: null,
    marker_seq: null, marker_time: null, chart_context: null, created_at: '2026-11-20T09:00:00Z', edited_at: null,
    deleted_at: null, tag: 'symptom', ...over,
  });

  function makeStoriesService(orgs: string[] | 'admin', rows: unknown[]) {
    const query = jest.fn().mockResolvedValue(rows);
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

  it('reads only published stories of the run, scoped to the run\'s organization, ordered by published_at then position', async () => {
    const { service, query } = makeStoriesService('admin', []);
    await service.getPublishedStories(testRun);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/s\.test_run_id = \$1/);
    expect(sql).toMatch(/s\.status = 'published'/);
    expect(sql).toMatch(/s\.organization_id = sut\.organization_id/);
    expect(sql).toMatch(/st\.organization_id = sut\.organization_id/);
    expect(sql).toMatch(/c\.test_run_id = s\.test_run_id\s+AND c\.organization_id = sut\.organization_id/);
    expect(sql).toMatch(/ORDER BY s\.published_at NULLS LAST, s\.created_at, s\.id, st\.position/);
    expect(params).toEqual(['run-uuid']);
  });

  it('adds a real user\'s org filter, and reads nothing for a user with no organizations', async () => {
    const one = makeStoriesService(['org-1'], []);
    await one.service.getPublishedStories(testRun, 'user-1', []);
    expect(one.query.mock.calls[0][0]).toMatch(/AND tr\.organization_id IN \(\$2\)/);
    expect(one.query.mock.calls[0][1]).toEqual(['run-uuid', 'org-1']);
    const none = makeStoriesService([], []);
    await none.service.getPublishedStories(testRun, 'user-1', []);
    expect(none.query.mock.calls[0][0]).toMatch(/AND FALSE/);
  });

  it('groups the rows into stories in order, keeps a step with no readable comment, and a story with no steps', async () => {
    const { service } = makeStoriesService('admin', [
      step({ position: 1, note: 'first' }),
      step({ position: 2, id: null }),
      step({ story_id: 's2', story_title: 'T2', position: null, id: null }),
    ]);
    const stories = await service.getPublishedStories(testRun);
    expect(stories.map((s) => [s.id, s.title, s.steps.length])).toEqual([['s1', 'T1', 2], ['s2', 'T2', 0]]);
    expect(stories[0]!.publishedAt).toEqual(new Date('2026-11-20T10:00:00Z'));
    expect(stories[0]!.steps[0]).toMatchObject({ position: 1, note: 'first', comment: { id: 'c1', cardKey: 'slo', authorName: 'Bob', tag: 'symptom' } });
    expect(stories[0]!.steps[1]).toEqual({ position: 2, note: null, comment: null });
  });
});
