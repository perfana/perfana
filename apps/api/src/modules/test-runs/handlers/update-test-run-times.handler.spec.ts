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

  /**
   * Value: protects=the realtime UPDATED event staying best-effort after a time edit;
   * fails_when=the try/catch around emitTestRunUpdated is removed or rethrows, so a socket
   * failure turns an already-committed UPDATE into a 500 the UI reports as a failed save;
   * why_new=no test made the gateway throw; seam=none; no_claim=does not check the warn text
   * or the event payload.
   */
  it('still returns the run when the realtime emit throws after the write', async () => {
    const gateway = (handler as unknown as { testRunsGateway: { emitTestRunUpdated: jest.Mock } }).testRunsGateway;
    gateway.emitTestRunUpdated.mockImplementation(() => {
      throw new Error('socket down');
    });
    const newEnd = new Date('2026-11-20T10:50:00Z');
    mockRepo.findOne
      .mockResolvedValueOnce(mockTestRun())
      .mockResolvedValueOnce(mockTestRun({ endTime: newEnd, duration: 3000 }));

    const result = await handler.execute({ id: 'uuid-1', endTime: newEnd });

    expect(result).toBeDefined();
    expect(gateway.emitTestRunUpdated).toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  /**
   * Value: protects=the clock-skew allowance on the future-end check; fails_when=the
   * FUTURE_SKEW_MS slack is dropped or the comparison is flipped, so a load generator whose
   * clock runs a minute ahead of the API can never correct its run; why_new=only the 1-hour
   * refusal was covered, which passes with zero slack; seam=none; no_claim=does not pin the
   * exact 5-minute edge.
   */
  it('accepts an end a minute in the future, within the skew allowance', async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 1000);
    mockRepo.findOne
      .mockResolvedValueOnce(mockTestRun())
      .mockResolvedValueOnce(mockTestRun({ startTime: start, endTime: end }));

    await handler.execute({ id: 'uuid-1', startTime: start, endTime: end });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE test_runs'), [start, end, 3660, 'uuid-1']);
  });

  it('refuses a run it cannot see', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);

    await expect(handler.execute({ id: 'missing', endTime: END })).rejects.toBeInstanceOf(ResourceNotFoundException);
    expect(query).not.toHaveBeenCalled();
  });
});
