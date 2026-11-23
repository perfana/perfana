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

  /**
   * Value: protects=the audit record of a time edit carrying the old and new window under the
   * run's organization; fails_when=logUpdate is handed the re-read row twice (no diff), the
   * pre-edit row is dropped, or the organizationIdOverride is lost so the entry lands outside
   * the tenant; why_new=the first case asserted only that logUpdate was called; seam=none;
   * no_claim=does not check what AuditService does with the pair.
   */
  it('audits the edit as a diff from the stored row to the re-read row, under the run organization', async () => {
    const newEnd = new Date('2026-11-20T10:40:00Z');
    const before = mockTestRun();
    const after = mockTestRun({ endTime: newEnd, duration: 2400, organizationId: 'org-2' });
    mockRepo.findOne.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    await handler.execute({ id: 'uuid-1', endTime: newEnd });

    expect(mockAudit.logUpdate).toHaveBeenCalledTimes(1);
    const [loggedBefore, loggedAfter, opts] = mockAudit.logUpdate.mock.calls[0];
    expect(loggedBefore).toBe(before);
    expect(loggedAfter).toBe(after);
    expect((loggedBefore as { endTime: Date }).endTime).toEqual(END);
    expect((loggedAfter as { endTime: Date }).endTime).toEqual(newEnd);
    expect(opts).toEqual({ organizationIdOverride: 'org-2' });
  });

  /**
   * Value: protects=refusing an edit that would leave one bound NULL; fails_when=the
   * both-required check is removed, so a run with no stored start gets an UPDATE with a NULL
   * start_time and a NaN duration; why_new=every fixture had both bounds stored; seam=none;
   * no_claim=does not cover a NULL stored end separately.
   */
  it('refuses to set only the end of a run that has no stored start', async () => {
    mockRepo.findOne.mockResolvedValueOnce(mockTestRun({ startTime: null }));

    await expect(handler.execute({ id: 'uuid-1', endTime: END })).rejects.toThrow(
      'Both a start time and an end time are required',
    );
    expect(query).not.toHaveBeenCalled();
  });

  /**
   * Value: protects=the int4 ceiling on the derived duration; fails_when=the
   * MAX_DURATION_SECONDS check is removed, so a mistyped century in the start time reaches
   * Postgres as an out-of-range integer and surfaces as a 500 instead of a 400;
   * why_new=no case used a window longer than a day; seam=none; no_claim=does not pin the
   * exact boundary value.
   */
  it('refuses a window whose duration does not fit the int4 column', async () => {
    mockRepo.findOne.mockResolvedValueOnce(mockTestRun());

    await expect(
      handler.execute({ id: 'uuid-1', startTime: new Date('1900-01-01T00:00:00Z') }),
    ).rejects.toThrow('Test run is too long');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a run it cannot see', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);

    await expect(handler.execute({ id: 'missing', endTime: END })).rejects.toBeInstanceOf(ResourceNotFoundException);
    expect(query).not.toHaveBeenCalled();
  });
});
