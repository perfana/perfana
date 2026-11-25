/**
 * ReportDataFetcherService.getPublishedStories against a real Postgres (migrations 1830/1832).
 *
 * Value: protects=the Comments section's `stories` layout reads the run's published stories only,
 * ordered by published_at with steps by position, never a draft, never a story or comment whose
 * organization is not the run's system's, and keeps a soft-deleted step comment (body wiped) in
 * place; fails_when=a column or join in the query is wrong (42703 / 42P01), a draft or a
 * foreign-org row is read, or the ordering drifts; why_new=the unit spec mocks the query by text,
 * so no SQL there reaches Postgres (Common Issue #76 is that shape); seam=none (owner role, the
 * report's background-job path with no user).
 *
 * Runs against the local dev DB like its sibling suites; everything it writes is deleted in
 * afterAll. Fixture names are synthetic.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { ReportDataFetcherService } from '../../modules/reports/services/report-data-fetcher.service';
import { deleteSystemFixtures } from './delete-system-fixtures';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('ReportDataFetcherService.getPublishedStories against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const suffix = randomUUID().slice(0, 8);
  const org = randomUUID();
  const otherOrg = randomUUID();
  const sut = randomUUID();
  let runUuid = '';
  const [cA, cB, cDeleted, cForeign] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [later, earlier, draft, foreign] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  let fetcher: ReportDataFetcherService;

  beforeAll(async () => {
    await ds.initialize();
    fetcher = new ReportDataFetcherService(
      { query: (sql: string, params: unknown[]) => ds.query(sql, params) } as never,
      { isGlobalAdmin: () => true, getAccessibleOrganizations: async () => [] } as never,
      ds,
    );
    await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)`,
      [org, `report-stories-spec-${suffix}`, otherOrg, `report-stories-spec-other-${suffix}`]);
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description) VALUES ($1, $2, $3, 'spec')`,
      [sut, org, `report-stories-spec-sut-${suffix}`],
    );
    const rows = await ds.query(
      `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
       VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
      [`report-stories-spec-run-${suffix}`, sut, org],
    );
    runUuid = rows[0].id;
    await ds.query(
      `INSERT INTO test_run_comments (id, test_run_id, card_key, body, author_id, author_name, tag, organization_id, deleted_at, notified_at)
       VALUES ($1, $5, 'slo', 'slo finding', 'u', 'Bob', 'symptom', $6, NULL, now()),
              ($2, $5, 'config', 'heap halved', 'u', 'Bob', 'root-cause', $6, NULL, now()),
              ($3, $5, 'graphs', '', 'u', 'Bob', 'ruled-out', $6, now(), now()),
              ($4, $5, 'slo', 'foreign comment', 'u', 'Eve', NULL, $7, NULL, now())`,
      [cA, cB, cDeleted, cForeign, runUuid, org, otherOrg],
    );
    await ds.query(
      `INSERT INTO test_run_stories (id, test_run_id, title, summary, status, author_id, author_name, published_at, organization_id, notified_at)
       VALUES ($1, $5, 'Later', NULL, 'published', 'u', 'Ada', '2026-11-20T12:00:00Z', $6, now()),
              ($2, $5, 'Earlier', 'conclusion', 'published', 'u', 'Ada', '2026-11-20T10:00:00Z', $6, now()),
              ($3, $5, 'Draft', NULL, 'draft', 'u', 'Ada', NULL, $6, NULL),
              ($4, $5, 'Foreign', NULL, 'published', 'u', 'Eve', '2026-11-20T09:00:00Z', $7, now())`,
      [later, earlier, draft, foreign, runUuid, org, otherOrg],
    );
    await ds.query(
      `INSERT INTO test_run_story_steps (story_id, comment_id, position, note, organization_id)
       VALUES ($1, $2, 2, NULL, $7), ($1, $3, 1, 'first', $7), ($1, $4, 3, 'ruled out', $7), ($1, $5, 4, NULL, $7),
              ($6, $2, 1, NULL, $7), ($8, $2, 1, NULL, $7)`,
      [earlier, cA, cB, cDeleted, cForeign, later, org, draft],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM ds_metric_collection_status WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE id = $1)`, [runUuid]);
    await ds.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await deleteSystemFixtures(ds, [sut]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[org, otherOrg]]);
    await ds.destroy();
  });

  it('reads the published stories in published order with steps by position, never a draft or a foreign row', async () => {
    const stories = await fetcher.getPublishedStories({ id: runUuid } as TestRun);
    expect(stories.map((s) => s.title)).toEqual(['Earlier', 'Later']);
    const [first, second] = stories;
    expect(first!.summary).toBe('conclusion');
    expect(first!.steps.map((st) => [st.position, st.note, st.comment?.body ?? null, st.comment?.tag ?? null])).toEqual([
      [1, 'first', 'heap halved', 'root-cause'],
      [2, null, 'slo finding', 'symptom'],
      [3, 'ruled out', '', 'ruled-out'],
      [4, null, null, null], // a comment of another organization never prints
    ]);
    expect(first!.steps[2]!.comment!.deletedAt).not.toBeNull();
    expect(second!.steps).toHaveLength(1);
  });
});
