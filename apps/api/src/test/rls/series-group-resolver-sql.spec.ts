/**
 * Runs `SeriesGroupResolver`'s lookup SQL against the real, migrated schema.
 *
 * WHY THIS EXISTS. v0.2.97.44 left a trailing comma before `FROM` in the resolver's lookup.
 * Postgres rejected every call with `syntax error at or near "FROM"`, and the resolver's catch
 * read that as "nothing grouped", so every series picker listed raw pod names instead of the
 * grouped series for weeks. The unit spec mocks its queryable and cannot parse SQL; only
 * Postgres can say whether a statement parses and every name in it resolves. This is the API
 * twin of `scripts/check-grouped-sql.mjs`, which covers the worker's grouped SQL only.
 *
 * The queryable records every error and rethrows it, so the resolver's catch cannot hide a
 * failure from these assertions. The run id matches nothing, so each statement returns no rows:
 * resolution is what is under test, not the answer.
 */
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { SeriesGroupResolver, type SeriesQueryable } from '../../modules/metrics/series-group-resolver';

const RUN = 'series-group-resolver-sql-spec-no-such-run';
const DASH = '00000000-0000-0000-0000-00000000d001';

describe('SeriesGroupResolver SQL against the real schema', () => {
  let ds: DataSource;
  let errors: string[];
  let statements: number;
  let q: SeriesQueryable;

  beforeAll(async () => {
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(() => {
    errors = [];
    statements = 0;
    q = {
      query: async (sql: string, params?: unknown[]) => {
        statements += 1;
        try {
          return await ds.query(sql, params);
        } catch (error) {
          errors.push(`${(error as Error).message}\n--- in ---\n${sql}`);
          throw error;
        }
      },
    };
  });

  it('resolves the grouping tables (otherwise every case below would pass vacuously)', async () => {
    const rows = await ds.query(
      `SELECT to_regclass('public.ds_metric_series_groups') IS NOT NULL
          AND to_regclass('public.series_grouping_rules') IS NOT NULL AS present`,
    );
    expect(rows[0].present).toBe(true);
  });

  it('parses and resolves the panel-scoped lookup', async () => {
    await new SeriesGroupResolver().groupsForPanel(q, { testRunId: RUN, applicationDashboardId: DASH, panelId: 20 }, []);
    expect(errors).toEqual([]);
    expect(statements).toBeGreaterThanOrEqual(2); // presence probe + the lookup
  });

  it('parses and resolves the lookup addressed by label and title', async () => {
    await new SeriesGroupResolver().groupsForPanel(q, {
      testRunId: RUN,
      dashboardLabel: 'Open Liberty - core metrics',
      panelTitle: 'Process CPU Time',
      panelId: 20,
    });
    expect(errors).toEqual([]);
    expect(statements).toBeGreaterThanOrEqual(2);
  });

  it('parses and resolves the whole-run lookup the series pickers use', async () => {
    await new SeriesGroupResolver().loadRun(q, RUN);
    expect(errors).toEqual([]);
    expect(statements).toBeGreaterThanOrEqual(2);
  });
});
