import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateTestRunHandler } from './create-test-run.handler';
import { TestRun as TestRunEntity, DsChangePoints } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import { CreateTestRunCommand } from '../commands/create-test-run.command';
import { TestRunLookupService } from '../services/test-run-lookup.service';

const baseData = {
  testRunId: 'run-001',
  systemUnderTestId: 'sut-1',
  testEnvironment: 'test',
  workload: 'load',
  organizationId: 'org-1',
  duration: 600,
  plannedDuration: 600,
  completed: true,
};

describe('CreateTestRunHandler — first-run baseline', () => {
  let handler: CreateTestRunHandler;
  let mockTestRunRepo: { count: jest.Mock; create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let mockChangePointsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let mockLookupService: { updateWorkloadConfig: jest.Mock };

  // Echo the entity back from save with the fields mapEntityToTestRun reads.
  const savedEntity = () => ({
    id: 'uuid-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockTestRunRepo = {
      count: jest.fn(),
      create: jest.fn((d) => d),
      save: jest.fn((e) => Promise.resolve({ ...e, ...savedEntity() })),
      findOne: jest.fn(() => Promise.resolve({ ...savedEntity(), systemUnderTest: null })),
    };
    mockChangePointsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => d),
      save: jest.fn(),
    };
    mockLookupService = { updateWorkloadConfig: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        CreateTestRunHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockTestRunRepo },
        { provide: getRepositoryToken(DsChangePoints), useValue: mockChangePointsRepo },
        { provide: TestRunsGateway, useValue: { emitTestRunCreated: jest.fn() } },
        { provide: AuditService, useValue: { logCreate: jest.fn() } },
        { provide: TestRunLookupService, useValue: mockLookupService },
      ],
    }).compile();

    handler = module.get(CreateTestRunHandler);
  });

  it('forces BASELINE when no prior run exists for the combination', async () => {
    mockTestRunRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await handler.execute(new CreateTestRunCommand(baseData, { skipEvents: true }));

    const saved = mockTestRunRepo.save.mock.calls[0][0];
    expect(saved.adaptConfig).toEqual({ mode: 'BASELINE', differencesAccepted: 'ACCEPTED' });
  });

  it('forces BASELINE even when DEFAULT was requested for the first run', async () => {
    mockTestRunRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await handler.execute(new CreateTestRunCommand({ ...baseData, adaptMode: 'DEFAULT' }, { skipEvents: true }));

    expect(mockTestRunRepo.save.mock.calls[0][0].adaptConfig.mode).toBe('BASELINE');
  });

  it('keeps DEFAULT for a subsequent run of an existing combination', async () => {
    mockTestRunRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await handler.execute(new CreateTestRunCommand(baseData, { skipEvents: true }));

    expect(mockTestRunRepo.save.mock.calls[0][0].adaptConfig).toEqual({
      mode: 'DEFAULT',
      differencesAccepted: 'TBD',
    });
  });

  it('persists BASELINE to the workload config on the first run so future runs inherit it', async () => {
    mockTestRunRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await handler.execute(new CreateTestRunCommand(baseData, { skipEvents: true }));

    expect(mockLookupService.updateWorkloadConfig).toHaveBeenCalledWith(
      'sut-1',
      'test',
      'load',
      { adaptMode: 'BASELINE' },
    );
  });

  it('does not touch the workload config for a subsequent run', async () => {
    mockTestRunRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await handler.execute(new CreateTestRunCommand(baseData, { skipEvents: true }));

    expect(mockLookupService.updateWorkloadConfig).not.toHaveBeenCalled();
  });
});
