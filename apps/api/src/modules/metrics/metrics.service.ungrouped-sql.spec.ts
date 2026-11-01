import { MetricsService } from './metrics.service';
import { SeriesGroupResolver } from './series-group-resolver';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

/**
 * Series grouping must be INERT for a panel that has none.
 *
 * Every `ds_metrics` statement the readers issue for an ungrouped panel is pinned here
 * verbatim, with its parameters. The group-aware change adds a lookup against the grouping
 * tables, but it must not alter, reorder or add to a single statement on `ds_metrics`:
 * these are the hot read paths of the series pickers and charts (root CLAUDE.md #34, #51),
 * and a plan change on them is invisible to every behavioural test.
 *
 * If one of these snapshots needs updating, the change is no longer inert for ungrouped
 * panels. Stop and ask why before touching it.
 */

/** Statements that read the measurement table, in the order they were issued. */
const dsMetricsStatements = (calls: unknown[][]): Array<[string, unknown[]]> =>
  calls
    .filter(([sql]) => /\bFROM ds_metrics\b/.test(String(sql)))
    .map(([sql, params]) => [String(sql), (params as unknown[]) ?? []]);

function build() {
  const repo = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(),
    },
  });
  const metricsRepo = repo();
  const testRunRepo = repo();
  const appDashboardRepo = repo();
  const authz = createAuthorizationServiceMock();
  testRunRepo.query.mockResolvedValue([{ organization_id: 'org-1', created_by: 'creator' }]);
  appDashboardRepo.findOne.mockResolvedValue({ id: 'dash-1', organizationId: 'org-1', createdBy: 'creator' });

  const service = new MetricsService(
    metricsRepo as never,
    repo() as never,
    repo() as never,
    repo() as never,
    repo() as never,
    testRunRepo as never,
    appDashboardRepo as never,
    authz as never,
    new SeriesGroupResolver(),
  );
  return { service, metricsRepo, testRunRepo };
}

describe('MetricsService: SQL for a panel with no series grouping is pinned', () => {
  describe('findDSMetricsForPanel', () => {
    it('regular path, dashboard id, no metric name', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
      metricsRepo.find.mockResolvedValue([]);

      await service.findDSMetricsForPanel('run-1', 201, 'dash-1');

      expect(dsMetricsStatements(metricsRepo.query.mock.calls)).toMatchSnapshot();
      expect(metricsRepo.find.mock.calls).toMatchSnapshot();
    });

    it('regular path, metrics source, metric name and zoom window', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
      metricsRepo.find.mockResolvedValue([]);
      const range = { from: '2024-01-01T00:00:00.000Z', to: '2024-01-01T01:00:00.000Z' };

      await service.findDSMetricsForPanel('run-1', 201, 'dash-1', 'T01.login', 'user-1', ['user'], 'ms-1', range);

      expect(dsMetricsStatements(metricsRepo.query.mock.calls)).toMatchSnapshot();
      expect(metricsRepo.find.mock.calls).toMatchSnapshot();
    });

    it('downsampled path: existence probe, series count and lttb()', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.query.mockImplementation(async (sql: string) => {
        if (sql.includes('needs_downsampling')) return [{ needs_downsampling: true }];
        if (sql.includes('COUNT(DISTINCT')) return [{ count: 2 }];
        return [{ metric_name: 'm', time: new Date('2024-01-01T00:00:00Z'), value: 1 }];
      });

      await service.findDSMetricsForPanel('run-1', 201, 'dash-1', 'T01.login');

      expect(dsMetricsStatements(metricsRepo.query.mock.calls)).toMatchSnapshot();
    });
  });

  describe('getDistinctMetricNames', () => {
    it('names query for a run', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.manager.query.mockResolvedValue([{ metric_name: 'a' }]);

      await service.getDistinctMetricNames('dash-1', 201, 'user-1', ['user'], undefined, 'run-1');

      expect(dsMetricsStatements(metricsRepo.manager.query.mock.calls)).toMatchSnapshot();
    });

    it('names query for a run through a metrics source', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.manager.query.mockResolvedValue([{ metric_name: 'a' }]);

      await service.getDistinctMetricNames('dash-1', 201, 'user-1', ['user'], 'ms-1', 'run-1');

      expect(dsMetricsStatements(metricsRepo.manager.query.mock.calls)).toMatchSnapshot();
    });
  });

  describe('getAvailableDashboards', () => {
    it('distinct (panel, metric) tuples query', async () => {
      const { service, metricsRepo } = build();
      metricsRepo.query.mockResolvedValue([
        {
          dashboard_label: 'Perf',
          panel_title: 'RT',
          panel_id: 201,
          unit: 'ms',
          metric_count: '1',
          metric_names: ['a'],
        },
      ]);

      const rows = await service.getAvailableDashboards('run-1', 'user-1', ['user']);

      expect(dsMetricsStatements(metricsRepo.query.mock.calls)).toMatchSnapshot();
      // An ungrouped panel's row is returned untouched: no `series_groups` key at all.
      expect(rows).toEqual([
        {
          dashboard_label: 'Perf',
          panel_title: 'RT',
          panel_id: 201,
          unit: 'ms',
          metric_count: '1',
          metric_names: ['a'],
        },
      ]);
      expect(Object.keys(rows[0]!)).not.toContain('series_groups');
    });
  });

  describe('getMetricTimeSeries', () => {
    it('query builder calls for a label, title, metric name and ramp-up exclusion', async () => {
      const { service, metricsRepo } = build();
      const calls: Array<[string, unknown[]]> = [];
      const qb: Record<string, jest.Mock> = {};
      for (const method of ['select', 'where', 'andWhere', 'orderBy', 'addOrderBy']) {
        qb[method] = jest.fn((...args: unknown[]) => {
          calls.push([method, args]);
          return qb;
        });
      }
      qb.getMany = jest.fn().mockResolvedValue([]);
      metricsRepo.createQueryBuilder.mockReturnValue(qb as never);

      await service.getMetricTimeSeries('run-1', 'Perf', 'RT', 'T01.login', true, 'user-1', ['user']);

      expect(metricsRepo.createQueryBuilder.mock.calls).toMatchSnapshot();
      expect(calls).toMatchSnapshot();
    });
  });
});
