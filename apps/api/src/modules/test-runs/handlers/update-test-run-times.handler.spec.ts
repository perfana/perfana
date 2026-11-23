import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateTestRunTimesHandler } from './update-test-run-times.handler';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import {
  ResourceNotFoundException,
  ValidationException,
} from '../../../common/exceptions/business.exception';

const START = new Date('2026-11-20T10:00:00Z');
const END = new Date('2026-11-20T11:00:00Z');

const mockTestRun = (overrides = {}) => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  startTime: START,
  endTime: END,
  duration: 3600,
  completed: true,
  organizationId: 'org-1',
  systemUnderTest: { team_id: 'team-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UpdateTestRunTimesHandler', () => {
  let handler: UpdateTestRunTimesHandler;
  let mockRepo: { findOne: jest.Mock };
  let query: jest.Mock;
  let mockAudit: { logUpdate: jest.Mock };

  beforeEach(async () => {
    mockRepo = { findOne: jest.fn() };
    query = jest.fn().mockResolvedValue(undefined);
    mockAudit = { logUpdate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UpdateTestRunTimesHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        // Outside an RLS request, withRequestQuery falls through to the DataSource manager.
        { provide: DataSource, useValue: { query, manager: { query } } },
        { provide: TestRunsGateway, useValue: { emitTestRunUpdated: jest.fn() } },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    handler = module.get(UpdateTestRunTimesHandler);
  });

  it('keeps the stored end when only the start changes, and derives duration from the timestamps', async () => {
    const newStart = new Date('2026-11-20T10:15:00Z');
    mockRepo.findOne
      .mockResolvedValueOnce(mockTestRun())
      .mockResolvedValueOnce(mockTestRun({ startTime: newStart, duration: 2700 }));

    await handler.execute({ id: 'uuid-1', startTime: newStart });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('start_time'), [newStart, END, 2700, 'uuid-1']);
    expect(mockAudit.logUpdate).toHaveBeenCalled();
  });

  it.each([
    ['a start at or after the end', { startTime: END }],
    ['an end in the future', { endTime: new Date(Date.now() + 60 * 60 * 1000) }],
  ])('refuses %s without writing', async (_label, times) => {
    mockRepo.findOne.mockResolvedValueOnce(mockTestRun());

    await expect(handler.execute({ id: 'uuid-1', ...times })).rejects.toBeInstanceOf(ValidationException);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a run that is still going, whose keep-alive would overwrite the edit', async () => {
    mockRepo.findOne.mockResolvedValueOnce(mockTestRun({ completed: false }));

    await expect(handler.execute({ id: 'uuid-1', endTime: END })).rejects.toBeInstanceOf(ValidationException);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a run it cannot see', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);

    await expect(handler.execute({ id: 'missing', endTime: END })).rejects.toBeInstanceOf(ResourceNotFoundException);
    expect(query).not.toHaveBeenCalled();
  });
});
