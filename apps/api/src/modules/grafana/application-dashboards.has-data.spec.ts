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
    // One statement, scoped to the ids already in hand — not an EXISTS per dashboard.
    expect(repoQuery).toHaveBeenCalledTimes(1);
    expect(repoQuery.mock.calls[0]![0]).toMatch(/ds_metric_statistics/);
    expect(repoQuery.mock.calls[0]![1]).toEqual([[LIVE, DEAD]]);
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
