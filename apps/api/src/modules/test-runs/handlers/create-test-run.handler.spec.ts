import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateTestRunHandler } from './create-test-run.handler';
import { TestRun as TestRunEntity, DsChangePoints } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import { CreateTestRunCommand } from '../commands/create-test-run.command';

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

    const module = await Test.createTestingModule({
      providers: [
        CreateTestRunHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockTestRunRepo },
        { provide: getRepositoryToken(DsChangePoints), useValue: mockChangePointsRepo },
        { provide: TestRunsGateway, useValue: { emitTestRunCreated: jest.fn() } },
        { provide: AuditService, useValue: { logCreate: jest.fn() } },
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
});
