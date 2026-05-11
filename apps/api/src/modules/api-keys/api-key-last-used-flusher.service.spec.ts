import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyLastUsedFlusherService } from './api-key-last-used-flusher.service';
import { ApiKeyRepository } from '../../repositories/api-key.repository';

describe('ApiKeyLastUsedFlusherService', () => {
  let service: ApiKeyLastUsedFlusherService;
  let repository: jest.Mocked<Pick<ApiKeyRepository, 'updateLastUsedBatch'>>;

  beforeEach(async () => {
    repository = { updateLastUsedBatch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyLastUsedFlusherService,
        { provide: ApiKeyRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(ApiKeyLastUsedFlusherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('record + flush', () => {
    it('does nothing when no IDs have been recorded', async () => {
      await service.flush();
      expect(repository.updateLastUsedBatch).not.toHaveBeenCalled();
    });

    it('flushes all recorded IDs in one batch call', async () => {
      service.record('id-1');
      service.record('id-2');
      service.record('id-3');
      await service.flush();

      expect(repository.updateLastUsedBatch).toHaveBeenCalledTimes(1);
      const [ids] = (repository.updateLastUsedBatch as jest.Mock).mock.calls[0] as [string[]];
      expect(ids.sort()).toEqual(['id-1', 'id-2', 'id-3']);
    });

    it('deduplicates repeated records for the same key', async () => {
      service.record('id-1');
      service.record('id-1');
      service.record('id-1');
      await service.flush();

      const [ids] = (repository.updateLastUsedBatch as jest.Mock).mock.calls[0] as [string[]];
      expect(ids).toEqual(['id-1']);
    });

    it('clears the pending set after a flush', async () => {
      service.record('id-1');
      await service.flush();
      await service.flush();

      expect(repository.updateLastUsedBatch).toHaveBeenCalledTimes(1);
    });

    it('clears pending before awaiting the batch so a concurrent record is not lost', async () => {
      repository.updateLastUsedBatch.mockImplementation(async () => {
        service.record('id-concurrent');
      });
      service.record('id-1');
      await service.flush();

      expect(repository.updateLastUsedBatch).toHaveBeenCalledWith(['id-1']);
      // The concurrently recorded ID is still pending for the next flush
      await service.flush();
      expect(repository.updateLastUsedBatch).toHaveBeenLastCalledWith(['id-concurrent']);
    });
  });

  describe('error handling', () => {
    it('swallows repository errors and does not rethrow', async () => {
      repository.updateLastUsedBatch.mockRejectedValue(new Error('DB down'));
      service.record('id-1');
      await expect(service.flush()).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('flushes remaining pending IDs on shutdown', async () => {
      service.record('id-shutdown');
      await service.onModuleDestroy();
      expect(repository.updateLastUsedBatch).toHaveBeenCalledWith(['id-shutdown']);
    });
  });
});
