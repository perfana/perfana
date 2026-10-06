/**
 * `hasData` keeps the metric pickers to dashboards a run has actually recorded metrics for.
 *
 * A long-lived system accumulates application_dashboards for workloads and spans that no longer
 * exist — 371 on one system/environment in the field, most of them dead. They cannot be used:
 * the panel picker reads ds_metric_statistics, so a dashboard with no rows there yields an empty
 * panel list. Offering it is an invitation to a dead end.
 *
 * The flag is opt-in, and these pin that: the management view in the system configuration must
 * keep listing everything, because that is where dead dashboards are found and deleted.
 */

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApplicationDashboard, SystemUnderTest } from '@perfana/shared';
import { ApplicationDashboardsService } from './application-dashboards.service';
import { GrafanaClientService } from './grafana-client.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

jest.mock('../../common/db/request-em', () => ({
  withRequestEm: (repo: unknown) => repo,
}));

const LIVE = '11111111-1111-1111-1111-111111111111';
const DEAD = '22222222-2222-2222-2222-222222222222';

describe('ApplicationDashboardsService.findAll — hasData', () => {
  let service: ApplicationDashboardsService;
  let repoQuery: jest.Mock;
  let getMany: jest.Mock;

  beforeEach(async () => {
    getMany = jest.fn().mockResolvedValue([
      { id: LIVE, dashboardLabel: 'Live', variables: [], createdAt: new Date(), updatedAt: new Date() },
      { id: DEAD, dashboardLabel: 'Orphan from an old workload', variables: [], createdAt: new Date(), updatedAt: new Date() },
    ]);
    repoQuery = jest.fn().mockResolvedValue([{ application_dashboard_id: LIVE }]);

    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicationDashboardsService,
        {
          provide: getRepositoryToken(ApplicationDashboard),
          useValue: { createQueryBuilder: () => queryBuilder, query: repoQuery },
        },
        { provide: getRepositoryToken(SystemUnderTest), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: GrafanaClientService, useValue: {} },
        {
          provide: AuthorizationService,
          useValue: {
            // super-admin: the org filter is not what these cases are about.
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: AuditService, useValue: { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ApplicationDashboardsService);
  });

  it('leaves out dashboards no run has metrics for', async () => {
    const rows = await service.findAll('user-1', ['super-admin'], { hasData: true });

    expect(rows.map((r) => r.id)).toEqual([LIVE]);
    // One statement and one round trip, scoped to the ids already in hand — an EXISTS
    // probe per id driven off `unnest`, not an EXISTS re-planned per dashboard row.
    expect(repoQuery).toHaveBeenCalledTimes(1);
    expect(repoQuery.mock.calls[0]![0]).toMatch(/ds_metric_statistics/);
    expect(repoQuery.mock.calls[0]![1]).toEqual([[LIVE, DEAD]]);
  });

  it('asks for the ids as rows, under the column name it then reads back', async () => {
    // The caller does `found.map((r) => r.application_dashboard_id)`. The rewrite from
    // `SELECT DISTINCT application_dashboard_id` to a probe over `unnest` has to keep that
    // alias: drop it and every row reads `undefined`, the Set holds one stray entry and
    // EVERY dashboard disappears from the picker, with nothing logged and no error.
    await service.findAll('user-1', ['super-admin'], { hasData: true });

    const sql = repoQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/AS\s+application_dashboard_id/i);
    expect(sql).toMatch(/unnest\(\$1::uuid\[\]\)/i);
    expect(sql).toMatch(/WHERE\s+EXISTS/i);
    // A probe that stops at the first row — never a DISTINCT over every matching entry.
    expect(sql).not.toMatch(/SELECT\s+DISTINCT/i);
  });

  it('keeps the page order and ignores an id the probe answers with that was not on the page', async () => {
    const STRANGER = '33333333-3333-3333-3333-333333333333';
    repoQuery.mockResolvedValueOnce([
      { application_dashboard_id: DEAD },
      { application_dashboard_id: STRANGER },
      { application_dashboard_id: LIVE },
    ]);

    const rows = await service.findAll('user-1', ['super-admin'], { hasData: true });

    // The probe's order is the planner's business; the page's order is the query builder's.
    expect(rows.map((r) => r.id)).toEqual([LIVE, DEAD]);
  });

  it('keeps nothing when the probe finds no rows for any dashboard on the page', async () => {
    repoQuery.mockResolvedValueOnce([]);

    expect(await service.findAll('user-1', ['super-admin'], { hasData: true })).toEqual([]);
  });

  it('lists everything when the flag is absent, so the management view can still find the dead ones', async () => {
    const rows = await service.findAll('user-1', ['super-admin'], {});

    expect(rows.map((r) => r.id)).toEqual([LIVE, DEAD]);
    expect(repoQuery).not.toHaveBeenCalled();
  });

  it('does not query at all when the page is empty', async () => {
    getMany.mockResolvedValueOnce([]);

    const rows = await service.findAll('user-1', ['super-admin'], { hasData: true });

    expect(rows).toEqual([]);
    expect(repoQuery).not.toHaveBeenCalled();
  });
});
