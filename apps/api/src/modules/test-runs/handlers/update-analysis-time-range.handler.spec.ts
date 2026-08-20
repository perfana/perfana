import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateAnalysisTimeRangeHandler } from './update-analysis-time-range.handler';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';

const mockTestRun = (overrides = {}) => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  analysisStartOffset: 60,
  analysisEndOffset: 0,
  completed: true,
  organizationId: 'org-1',
  systemUnderTest: { team_id: null },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UpdateAnalysisTimeRangeHandler', () => {
  let handler: UpdateAnalysisTimeRangeHandler;
  let mockRepo: { findOne: jest.Mock };
  let mockDataSource: { query: jest.Mock; manager: { query: jest.Mock } };
  let mockGateway: { emitTestRunUpdated: jest.Mock };
  let mockAudit: { logUpdate: jest.Mock };

  beforeEach(async () => {
    mockRepo = { findOne: jest.fn() };
    const dsQuery = jest.fn().mockResolvedValue(undefined);
    // Outside an RLS request, withRequestQuery falls through to the DataSource manager.
    mockDataSource = { query: dsQuery, manager: { query: dsQuery } };
    mockGateway = { emitTestRunUpdated: jest.fn() };
    mockAudit = { logUpdate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UpdateAnalysisTimeRangeHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TestRunsGateway, useValue: mockGateway },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    handler = module.get(UpdateAnalysisTimeRangeHandler);
  });

  it('updates both ramp_up and ramp_down columns atomically', async () => {
    const pre = mockTestRun({ analysisStartOffset: 60, analysisEndOffset: 0 });
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ramp_up'),
      expect.arrayContaining([30, 60, 'uuid-1']),
    );
  });

  it('throws ResourceNotFoundException when test run not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', analysisStartOffset: 0, analysisEndOffset: 0 }),
    ).rejects.toThrow();
  });

  it('calls auditService.logUpdate with pre and post entities', async () => {
    const pre = mockTestRun();
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockAudit.logUpdate).toHaveBeenCalledWith(pre, post, expect.any(Object));
  });

  it('emits a WebSocket UPDATED event', async () => {
    const entity = mockTestRun();
    mockRepo.findOne.mockResolvedValue(entity);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 0, analysisEndOffset: 0 });

    expect(mockGateway.emitTestRunUpdated).toHaveBeenCalled();
  });
});
