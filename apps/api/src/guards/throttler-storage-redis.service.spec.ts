import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorageRedisService } from './throttler-storage-redis.service';
import IORedis from 'ioredis';

describe('ThrottlerStorageRedisService', () => {
  let service: ThrottlerStorageRedisService;
  let mockRedis: jest.Mocked<IORedis>;

  beforeEach(async () => {
    // Mock ioredis client
    mockRedis = {
      script: jest.fn(),
      evalsha: jest.fn(),
      multi: jest.fn(),
      incr: jest.fn(),
      ttl: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
      get: jest.fn(),
      exec: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThrottlerStorageRedisService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<ThrottlerStorageRedisService>(ThrottlerStorageRedisService);
  });

  describe('increment', () => {
    it('should increment counter using Lua script', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';
      const ttl = 60;

      // Mock script loading
      mockRedis.script.mockResolvedValue('script-sha-12345');

      // Mock Lua script execution - returns [totalHits, remainingTtl]
      mockRedis.evalsha.mockResolvedValue([5, 60]);

      const result = await service.increment(key, ttl, 10, 60, 'test-throttler');

      expect(result.totalHits).toBe(5);
      expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.any(String));
      expect(mockRedis.evalsha).toHaveBeenCalledWith('script-sha-12345', 1, key, ttl);
    });

    it('should reload script and retry on NOSCRIPT error', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';
      const ttl = 60;

      // Mock initial script load
      mockRedis.script.mockResolvedValueOnce('script-sha-old');

      // Mock first evalsha failure with NOSCRIPT
      const noscriptError = new Error('NOSCRIPT No matching script. Please use EVAL.');
      mockRedis.evalsha.mockRejectedValueOnce(noscriptError);

      // Mock script reload
      mockRedis.script.mockResolvedValueOnce('script-sha-new');

      // Mock successful retry - returns [totalHits, remainingTtl]
      mockRedis.evalsha.mockResolvedValueOnce([3, 60]);

      const result = await service.increment(key, ttl, 10, 60, 'test-throttler');

      expect(result.totalHits).toBe(3);
      expect(mockRedis.script).toHaveBeenCalledTimes(2);
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(2);
    });

    it('should fallback to multi commands if Lua script fails', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';
      const ttl = 60;

      // Mock script load failure
      mockRedis.script.mockRejectedValue(new Error('Script load failed'));

      // Mock multi command pipeline
      const mockMulti = {
        incr: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 10], // incr result
          [null, -1], // ttl result (no TTL set)
        ]),
      };

      mockRedis.multi.mockReturnValue(mockMulti as any);
      mockRedis.expire.mockResolvedValue(1);

      const result = await service.increment(key, ttl, 10, 60, 'test-throttler');

      expect(result.totalHits).toBe(10);
      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockMulti.incr).toHaveBeenCalledWith(key);
      expect(mockMulti.ttl).toHaveBeenCalledWith(key);
      expect(mockRedis.expire).toHaveBeenCalledWith(key, ttl);
    });

    it('should not set TTL if key already has one', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';
      const ttl = 60;

      // Mock script load failure to force fallback
      mockRedis.script.mockRejectedValue(new Error('Script load failed'));

      // Mock multi command pipeline with existing TTL
      const mockMulti = {
        incr: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 15], // incr result
          [null, 45], // ttl result (45 seconds remaining)
        ]),
      };

      mockRedis.multi.mockReturnValue(mockMulti as any);

      const result = await service.increment(key, ttl, 10, 60, 'test-throttler');

      expect(result.totalHits).toBe(15);
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should delete the key from Redis', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';

      mockRedis.del.mockResolvedValue(1);

      await service.reset(key);

      expect(mockRedis.del).toHaveBeenCalledWith(key);
    });
  });

  describe('get', () => {
    it('should return current count for existing key', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';

      mockRedis.get.mockResolvedValue('42');

      const result = await service.get(key);

      expect(result).toBe(42);
      expect(mockRedis.get).toHaveBeenCalledWith(key);
    });

    it('should return 0 for non-existent key', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';

      mockRedis.get.mockResolvedValue(null);

      const result = await service.get(key);

      expect(result).toBe(0);
    });
  });

  describe('getTtl', () => {
    it('should return TTL for existing key', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';

      mockRedis.ttl.mockResolvedValue(45);

      const result = await service.getTtl(key);

      expect(result).toBe(45);
      expect(mockRedis.ttl).toHaveBeenCalledWith(key);
    });

    it('should return -1 for key without TTL', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';

      mockRedis.ttl.mockResolvedValue(-1);

      const result = await service.getTtl(key);

      expect(result).toBe(-1);
    });
  });

  describe('Lua Script', () => {
    it('should cache the script SHA after first load', async () => {
      const key1 = 'throttle:ip:192.168.1.1:/api/test-runs';
      const key2 = 'throttle:ip:192.168.1.2:/api/test-runs';
      const ttl = 60;

      // Mock script loading once
      mockRedis.script.mockResolvedValue('script-sha-12345');
      mockRedis.evalsha.mockResolvedValue(1);

      await service.increment(key1, ttl, 10, 60, 'test-throttler');
      await service.increment(key2, ttl, 10, 60, 'test-throttler');

      // Script should only be loaded once and reused
      expect(mockRedis.script).toHaveBeenCalledTimes(1);
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should throw error if multi command fails completely', async () => {
      const key = 'throttle:ip:192.168.1.1:/api/test-runs';
      const ttl = 60;

      // Mock script failure
      mockRedis.script.mockRejectedValue(new Error('Script load failed'));

      // Mock multi returning null (connection error)
      const mockMulti = {
        incr: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockRedis.multi.mockReturnValue(mockMulti as any);

      await expect(service.increment(key, ttl, 10, 60, 'test-throttler')).rejects.toThrow('Redis multi command failed');
    });
  });
});
