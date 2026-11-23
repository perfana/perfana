/**
 * Value: protects=PUT /test-runs/:id/time-range input parsing; fails_when=a non-string,
 * unparseable or absent time reaches the service (Invalid Date written as start_time, or an
 * empty body queuing a force re-fetch for nothing); why_new=the handler spec receives Dates
 * already parsed, so nothing exercised the controller's parse; seam=none;
 * no_claim=does not cover the UuidValidationPipe or the global ValidationPipe.
 */
import { TestRunsController } from './test-runs.controller';
import { ValidationException } from '../../../common/exceptions/business.exception';

describe('TestRunsController.updateTestRunTimes', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as any;

  it('refuses unparseable, non-string or missing times without calling the service, and forwards valid ones as Dates', async () => {
    const svc = { updateTestRunTimes: jest.fn().mockResolvedValue({ id: 'uuid-1' }) };
    const controller = new TestRunsController(svc as any, {} as any);

    const bad: unknown[] = [
      { startTime: 'not-a-date' },
      { endTime: 1732352400000 },
      { startTime: null },
      {},
      undefined,
    ];
    for (const body of bad) {
      await expect(controller.updateTestRunTimes('uuid-1', body as any, ctx)).rejects.toBeInstanceOf(
        ValidationException,
      );
    }
    expect(svc.updateTestRunTimes).not.toHaveBeenCalled();

    await controller.updateTestRunTimes('uuid-1', { endTime: '2026-11-20T11:00:00Z' }, ctx);
    expect(svc.updateTestRunTimes).toHaveBeenCalledWith(
      'uuid-1',
      { startTime: undefined, endTime: new Date('2026-11-20T11:00:00Z') },
      'user-1',
      ['user'],
    );
  });
});
