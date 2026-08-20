import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateApplicationReleaseHandler } from './update-application-release.handler';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';

const mockTestRun = (overrides = {}) => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  applicationRelease: '2.4.3',
  completed: true,
  organizationId: 'org-1',
  systemUnderTest: { team_id: 'team-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UpdateApplicationReleaseHandler', () => {
  let handler: UpdateApplicationReleaseHandler;
  let mockRepo: { findOne: jest.Mock };
  let mockDataSource: { query: jest.Mock; manager: { query: jest.Mock } };
  let mockGateway: { emitTestRunUpdated: jest.Mock };
  let mockAudit: { logUpdate: jest.Mock };

  beforeEach(async () => {
    mockRepo = { findOne: jest.fn() };
    const query = jest.fn().mockResolvedValue(undefined);
    // Outside an RLS request, withRequestQuery falls through to the DataSource manager.
    mockDataSource = { query, manager: { query } };
    mockGateway = { emitTestRunUpdated: jest.fn() };
    mockAudit = { logUpdate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UpdateApplicationReleaseHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TestRunsGateway, useValue: mockGateway },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    handler = module.get(UpdateApplicationReleaseHandler);
  });

  it('writes the new version, audits the change and tells open views about it', async () => {
    mockRepo.findOne
      .mockResolvedValueOnce(mockTestRun())
      .mockResolvedValueOnce(mockTestRun({ applicationRelease: '2.5.0' }));

    const result = await handler.execute({ id: 'uuid-1', applicationRelease: '  2.5.0  ' });

    expect(mockDataSource.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('application_release'),
      ['2.5.0', 'uuid-1'],   // trimmed
    );
    expect(mockAudit.logUpdate).toHaveBeenCalled();
    expect(mockGateway.emitTestRunUpdated).toHaveBeenCalled();
    expect(result.application_release).toBe('2.5.0');
  });

  it('clears the version when handed an empty string', async () => {
    mockRepo.findOne
      .mockResolvedValueOnce(mockTestRun())
      .mockResolvedValueOnce(mockTestRun({ applicationRelease: null }));

    await handler.execute({ id: 'uuid-1', applicationRelease: '   ' });

    // NULL, not an empty string — the run reads as having no version
    expect(mockDataSource.manager.query).toHaveBeenCalledWith(expect.any(String), [null, 'uuid-1']);
  });

  it('refuses a run it cannot see, without writing', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);

    await expect(handler.execute({ id: 'missing', applicationRelease: '2.5.0' }))
      .rejects.toBeInstanceOf(ResourceNotFoundException);
    expect(mockDataSource.manager.query).not.toHaveBeenCalled();
  });
});
