import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ApplicationDashboardDeletionProcessor } from './application-dashboard-deletion.processor';
import { ApplicationDashboardsService } from '../application-dashboards.service';

/**
 * These tests drive the processor without Redis: onModuleInit is never called,
 * and the queue is injected directly. What matters here is the contract with
 * the rest of the ship — that jobs are deduplicated per dashboard, that an
 * unavailable queue is loud rather than silent, and that the worker path
 * forwards the audit actor it will not get from CLS.
 */
describe('ApplicationDashboardDeletionProcessor', () => {
  let processor: ApplicationDashboardDeletionProcessor;
  let dashboardsService: { delete: jest.Mock };
  let queue: { add: jest.Mock };

  const ctx = { userId: 'user-1', roles: ['user'] };

  beforeEach(() => {
    dashboardsService = { delete: jest.fn().mockResolvedValue({ deletedFromGrafana: false }) };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    processor = new ApplicationDashboardDeletionProcessor(
      new ConfigService({}),
      dashboardsService as unknown as ApplicationDashboardsService,
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Put the processor in the state onModuleInit would leave it in on success. */
  function markReady(): void {
    processor['isRedisAvailable'] = true;
    processor['queue'] = queue as never;
    processor['worker'] = {} as never;
  }

  describe('isAvailable', () => {
    it('is false before the connections are established', () => {
      expect(processor.isAvailable()).toBe(false);
    });

    it('is true once the queue and worker exist', () => {
      markReady();
      expect(processor.isAvailable()).toBe(true);
    });

    it('is false when Redis dropped even though the queue object survives', () => {
      markReady();
      processor['isRedisAvailable'] = false;
      expect(processor.isAvailable()).toBe(false);
    });
  });

  describe('addBulkJobs', () => {
    it('queues one job per dashboard, keyed for deduplication', async () => {
      markReady();

      await processor.addBulkJobs(['dash-1', 'dash-2'], true, ctx);

      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenNthCalledWith(
        1,
        'delete-application-dashboard',
        { id: 'dash-1', deleteFromGrafana: true, userId: 'user-1', roles: ['user'] },
        { jobId: 'delete-appdash-dash-1' },
      );
      expect(queue.add).toHaveBeenNthCalledWith(
        2,
        'delete-application-dashboard',
        { id: 'dash-2', deleteFromGrafana: true, userId: 'user-1', roles: ['user'] },
        { jobId: 'delete-appdash-dash-2' },
      );
    });

    it('carries deleteFromGrafana=false through to the job', async () => {
      markReady();

      await processor.addBulkJobs(['dash-1'], false, ctx);

      expect(queue.add.mock.calls[0][1]).toEqual(
        expect.objectContaining({ deleteFromGrafana: false }),
      );
    });

    // The controller branches on isAvailable() to pick the synchronous
    // fallback. If this threw silently instead, a batch would vanish.
    it('throws when the queue is unavailable so the caller can fall back', async () => {
      await expect(processor.addBulkJobs(['dash-1'], false, ctx)).rejects.toThrow(
        'Application dashboard deletion processor is not available',
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('processJob', () => {
    it('deletes the dashboard and forwards the queuing user as audit actor', async () => {
      await processor['processJob']({
        data: { id: 'dash-1', deleteFromGrafana: true, userId: 'user-9', roles: ['user'] },
      } as never);

      expect(dashboardsService.delete).toHaveBeenCalledWith('dash-1', true, 'user-9', ['user'], {
        auditActorOverride: { userId: 'user-9' },
      });
    });

    // BullMQ retries on a thrown job (attempts: 3). Swallowing the error here
    // would mark the deletion done while the dashboard is still there.
    it('propagates a delete failure so BullMQ retries', async () => {
      dashboardsService.delete.mockRejectedValue(new Error('FK violation'));

      await expect(
        processor['processJob']({
          data: { id: 'dash-1', deleteFromGrafana: false, userId: 'user-9', roles: [] },
        } as never),
      ).rejects.toThrow('FK violation');
    });
  });

  describe('onModuleDestroy', () => {
    it('closes cleanly when nothing was ever initialized', async () => {
      await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
