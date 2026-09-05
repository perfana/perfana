/**
 * Pins the RLS routing of the raw-SQL test-run updates.
 *
 * These five handlers write with `dataSource.query`-shaped SQL because there is
 * no repository call that expresses the update. The API's login role bypasses
 * row-level security, so a write on the pooled connection is never policy-checked
 * — only the RLS-scoped read before it stands between a caller and another org's
 * row. `withRequestQuery` puts the write back inside the request's transaction.
 *
 * The mock keeps `dataSource.query` and `dataSource.manager.query` as DISTINCT
 * spies on purpose: sharing one spy (the obvious mock) passes either way and
 * pins nothing.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import { UpdateAnnotationsHandler } from './update-annotations.handler';
import { UpdateTagsHandler } from './update-tags.handler';
import { UpdateAnalysisStartOffsetHandler } from './update-analysis-start-offset.handler';
import { UpdateAnalysisTimeRangeHandler } from './update-analysis-time-range.handler';
import { UpdateApplicationReleaseHandler } from './update-application-release.handler';

const run = () => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  organizationId: 'org-1',
  annotations: [],
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  systemUnderTest: { team_id: 'team-1' },
});

const cases = [
  {
    name: 'UpdateAnnotationsHandler',
    Handler: UpdateAnnotationsHandler,
    column: 'annotations',
    payload: { id: 'uuid-1', annotations: ['note'] },
  },
  {
    name: 'UpdateTagsHandler',
    Handler: UpdateTagsHandler,
    column: 'tags',
    payload: { id: 'uuid-1', tags: ['nightly'] },
  },
  {
    name: 'UpdateAnalysisStartOffsetHandler',
    Handler: UpdateAnalysisStartOffsetHandler,
    column: 'ramp_up',
    payload: { id: 'uuid-1', analysisStartOffset: 60 },
  },
  {
    name: 'UpdateAnalysisTimeRangeHandler',
    Handler: UpdateAnalysisTimeRangeHandler,
    column: 'ramp_down',
    payload: { id: 'uuid-1', analysisStartOffset: 60, analysisEndOffset: 30 },
  },
  {
    name: 'UpdateApplicationReleaseHandler',
    Handler: UpdateApplicationReleaseHandler,
    column: 'application_release',
    payload: { id: 'uuid-1', applicationRelease: '2.5.0' },
  },
] as const;

describe.each(cases)('$name — RLS write routing', ({ Handler, column, payload }) => {
  it('writes through the request entity manager, never the pooled connection', async () => {
    const pooledQuery = jest.fn().mockResolvedValue(undefined);
    const managerQuery = jest.fn().mockResolvedValue(undefined);
    const repo = { findOne: jest.fn().mockResolvedValue(run()), find: jest.fn().mockResolvedValue([run()]) };

    const module = await Test.createTestingModule({
      providers: [
        Handler,
        { provide: getRepositoryToken(TestRunEntity), useValue: repo },
        { provide: DataSource, useValue: { query: pooledQuery, manager: { query: managerQuery } } },
        { provide: TestRunsGateway, useValue: { emitTestRunUpdated: jest.fn() } },
        { provide: AuditService, useValue: { logUpdate: jest.fn() } },
      ],
    }).compile();

    await module.get(Handler).execute(payload as never);

    expect(managerQuery).toHaveBeenCalledWith(expect.stringContaining(column), expect.any(Array));
    expect(pooledQuery).not.toHaveBeenCalled();
  });
});
