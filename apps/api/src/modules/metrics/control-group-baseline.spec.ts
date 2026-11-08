import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  CONTROL_GROUP_FOR_RUN_SQL,
  loadControlGroupForRun,
  loadControlGroupStatistics,
} from './control-group-baseline';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import type { SeriesGroupResolver } from './series-group-resolver';
import type { AuthorizationService } from '../../common/services/authorization.service';
import type { UserContext } from '../../common/decorators/user-context.decorator';
import type { Benchmark } from '../../entities';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

const DASH = '3f8b1c7e-2a4d-4e6f-9b1a-7c2d5e8f0a13';
const SOURCE = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const groupRow = {
  control_group_id: 'run-7',
  test_runs: ['run-2', 'run-3', 'run-4'],
  n_test_runs: 3,
  first_datetime: new Date('2026-11-01T10:00:00Z'),
  last_datetime: '2026-11-04T10:00:00.000Z',
};

describe('loadControlGroupForRun', () => {
  it('names the group of the latest conclusion and falls back to the run\'s own id', async () => {
    const q = { query: jest.fn().mockResolvedValue([groupRow]) };

    const group = await loadControlGroupForRun(q, 'run-7');

    expect(q.query).toHaveBeenCalledWith(CONTROL_GROUP_FOR_RUN_SQL, ['run-7']);
    // The conclusion is the authority (it is what the anomaly card and the Regressions
    // section go by); the run's own id is only the fallback, as the worker keys groups on it.
    expect(CONTROL_GROUP_FOR_RUN_SQL).toMatch(/FROM ds_adapt_conclusion c\s+WHERE c\.test_run_id = \$1/);
    expect(CONTROL_GROUP_FOR_RUN_SQL).toMatch(/ORDER BY c\.updated_at DESC/);
    expect(CONTROL_GROUP_FOR_RUN_SQL).toMatch(/COALESCE\([\s\S]*\),\s*\$1\)/);
    expect(group).toEqual({
      id: 'run-7',
      testRuns: ['run-2', 'run-3', 'run-4'],
      nTestRuns: 3,
      firstDatetime: '2026-11-01T10:00:00.000Z',
      lastDatetime: '2026-11-04T10:00:00.000Z',
    });
  });

  it('reads no group and an empty group alike as "nothing to compare against"', async () => {
    expect(await loadControlGroupForRun({ query: jest.fn().mockResolvedValue([]) }, 'run-1')).toBeNull();
    expect(
      await loadControlGroupForRun(
        { query: jest.fn().mockResolvedValue([{ ...groupRow, test_runs: [], n_test_runs: 0 }]) },
        'run-1',
      ),
    ).toBeNull();
  });
});

describe('loadControlGroupStatistics', () => {
  it('prefers the metrics source over the dashboard, as the run-side reads do', async () => {
    const q = { query: jest.fn().mockResolvedValue([]) };

    await loadControlGroupStatistics(q, 'run-7', { applicationDashboardId: DASH, metricsSourceId: SOURCE, panelId: 101 });

    const [sql, params] = q.query.mock.calls[0];
    expect(sql).toMatch(/FROM ds_control_group_statistics s/);
    expect(sql).toMatch(/s\.control_group_id = \$1/);
    expect(sql).toMatch(/s\.metrics_source_id = \$2::uuid/);
    expect(sql).not.toMatch(/application_dashboard_id = \$/);
    expect(sql).toMatch(/s\.panel_id = \$3/);
    expect(params).toEqual(['run-7', SOURCE, 101]);
  });

  it('binds every value and reads the whole group when nothing narrows it', async () => {
    const q = { query: jest.fn().mockResolvedValue([]) };

    await loadControlGroupStatistics(q, "run-7'; DROP TABLE x; --");

    const [sql, params] = q.query.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toMatch(/panel_id = \$/);
    expect(params).toEqual(["run-7'; DROP TABLE x; --"]);
  });
});

describe('MetricsService — control group', () => {
  function build(allowed = true) {
    const controlGroupsRepo = { query: jest.fn() };
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{ organization_id: 'org-1', created_by: 'u' }]),
    };
    const authz = createAuthorizationServiceMock();
    authz.canAccessResource.mockResolvedValue({ allowed, reason: 'test' });
    const repo = {} as Repository<never>;
    const service = new MetricsService(
      repo,
      repo,
      controlGroupsRepo as unknown as Repository<never>,
      repo,
      repo,
      testRunRepo as unknown as Repository<never>,
      repo,
      authz as unknown as AuthorizationService,
      {} as SeriesGroupResolver,
    );
    return { service, controlGroupsRepo, authz };
  }

  it('answers the group in the controller\'s snake_case', async () => {
    const { service, controlGroupsRepo } = build();
    controlGroupsRepo.query.mockResolvedValueOnce([groupRow]);

    expect(await service.findControlGroup('run-7', 'u', ['user'])).toEqual({
      control_group_id: 'run-7',
      test_runs: ['run-2', 'run-3', 'run-4'],
      n_test_runs: 3,
      first_datetime: '2026-11-01T10:00:00.000Z',
      last_datetime: '2026-11-04T10:00:00.000Z',
    });
  });

  it('reads nothing for a run the caller cannot see', async () => {
    const { service, controlGroupsRepo } = build(false);

    expect(await service.findControlGroup('run-7', 'u', ['user'])).toBeNull();
    expect(await service.findControlGroupStatistics('run-7', 101, DASH, 'u', ['user'])).toEqual([]);
    expect(controlGroupsRepo.query).not.toHaveBeenCalled();
  });

  it('keys the pooled statistics like ds-metric-statistics so one reader serves both sides', async () => {
    const { service, controlGroupsRepo } = build();
    controlGroupsRepo.query
      .mockResolvedValueOnce([groupRow])
      .mockResolvedValueOnce([{
        application_dashboard_id: DASH,
        panel_id: 101,
        panel_title: 'Transaction RT Avg',
        dashboard_label: 'Performance test metrics Checkout',
        metric_name: 'Login',
        unit: 'ms',
        metrics_source_id: null,
        mean: 120.5,
        median: 110,
        min_value: 80,
        max_value: 400,
        q90: 180,
        q95: 220,
        q99: 390,
        count: 360,
      }]);

    const rows = await service.findControlGroupStatistics('run-7', 101, DASH, 'u', ['user']);

    expect(controlGroupsRepo.query.mock.calls[1][1]).toEqual(['run-7', DASH, 101]);
    expect(rows).toEqual([{
      control_group_id: 'run-7',
      application_dashboard_id: DASH,
      panel_id: 101,
      panel_title: 'Transaction RT Avg',
      metric_name: 'Login',
      unit: 'ms',
      metrics_source_id: null,
      statistics: { avg: 120.5, min: 80, max: 400, q50: 110, q90: 180, q95: 220, q99: 390, count: 360 },
    }]);
  });

  it('asks for no statistics when the run has no control group', async () => {
    const { service, controlGroupsRepo } = build();
    controlGroupsRepo.query.mockResolvedValueOnce([]);

    expect(await service.findControlGroupStatistics('run-1', 101, DASH, 'u', ['user'])).toEqual([]);
    expect(controlGroupsRepo.query).toHaveBeenCalledTimes(1);
  });
});

describe('MetricsController — control group routes', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as unknown as UserContext;

  function build() {
    const service = {
      findControlGroup: jest.fn().mockResolvedValue(null),
      findControlGroupStatistics: jest.fn().mockResolvedValue([]),
      findDSMetricsForPanel: jest.fn().mockResolvedValue([{ time: new Date(0), value: 1 }]),
    };
    const controller = new MetricsController(
      service as unknown as MetricsService,
      {} as unknown as Repository<Benchmark>,
    );
    return { controller, service };
  }

  it('hands the parsed panel and the caller to the statistics service', async () => {
    const { controller, service } = build();

    await controller.getControlGroupStatistics('run-7', ctx, '101', DASH, undefined);

    expect(service.findControlGroupStatistics).toHaveBeenCalledWith('run-7', 101, DASH, 'user-1', ['user'], undefined);
  });

  it('refuses what Postgres would refuse with a 500', async () => {
    const { controller } = build();
    await expect(controller.getControlGroupStatistics('run-7', ctx, 'abc', DASH)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getControlGroupStatistics('run-7', ctx, '101')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getControlGroupStatistics('run-7', ctx, '101', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getControlGroupStatistics('run-7', ctx, '101', undefined, 'nope')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('draws the current run alone when ds-metrics-comparison is given no baseline', async () => {
    const { controller, service } = build();

    const result = await controller.getDSMetricsComparison(ctx, 'run-7', undefined, DASH, '101', 'Login');

    expect(service.findDSMetricsForPanel).toHaveBeenCalledTimes(1);
    expect(service.findDSMetricsForPanel.mock.calls[0][0]).toBe('run-7');
    expect(result.baselineMetrics).toEqual([]);
    expect(result.baselineTestRunId).toBeNull();
  });

  it('still fetches both runs when a baseline run is named', async () => {
    const { controller, service } = build();

    await controller.getDSMetricsComparison(ctx, 'run-7', 'run-3', DASH, '101', 'Login');

    expect(service.findDSMetricsForPanel.mock.calls.map((c) => c[0])).toEqual(['run-7', 'run-3']);
  });
});
