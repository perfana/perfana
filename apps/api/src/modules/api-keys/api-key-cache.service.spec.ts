import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKey } from '@perfana/shared/entities';

describe('ApiKeyCacheService', () => {
  let service: ApiKeyCacheService;
  let mockRedis: jest.Mocked<IORedis>;
  let mockConfigService: jest.Mocked<ConfigService>;

  const mockApiKey: ApiKey = {
    id: 'test-id',
    apiKey: 'hashed-token',
    description: 'test-key',
    validUntil: new Date(Date.now() + 86400000), // 24 hours from now
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsed: undefined,
    roles: [],
  } as ApiKey;

  beforeEach(async () => {
    // Create mock Redis client
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
      pipeline: jest.fn(() => ({
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })),
    } as any;

    // Create mock ConfigService
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'API_KEY_CACHE_TTL_SECONDS') return 600;
        if (key === 'API_KEY_CACHE_ENABLED') return 'true';
        return defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyCacheService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ApiKeyCacheService>(ApiKeyCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCachedKey', () => {
    it('should return cached API key on cache hit', async () => {
      const serialized = JSON.stringify(mockApiKey);
      mockRedis.get.mockResolvedValue(serialized);

      const result = await service.getCachedKey('test-key');

      // Dates are serialized to strings in Redis, lastUsed (undefined) is removed
      const expectedResult = {
        ...mockApiKey,
        createdAt: mockApiKey.createdAt.toISOString(),
        updatedAt: mockApiKey.updatedAt.toISOString(),
        validUntil: mockApiKey.validUntil!.toISOString(),
      };
      delete (expectedResult as any).lastUsed; // undefined is removed by JSON.stringify

      expect(result).toEqual(expectedResult);
      expect(mockRedis.get).toHaveBeenCalledWith('api-key:test-key');
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getCachedKey('test-key');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('api-key:test-key');
    });

    it('should return null and log error on Redis failure', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.getCachedKey('test-key');

      expect(result).toBeNull();
    });

    it('should return null when caching is disabled', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'API_KEY_CACHE_ENABLED') return 'false';
        return defaultValue;
      });

      // Recreate service with disabled cache
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ApiKeyCacheService,
          { provide: 'REDIS_CLIENT', useValue: mockRedis },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const disabledService = module.get<ApiKeyCacheService>(ApiKeyCacheService);

      const result = await disabledService.getCachedKey('test-key');

      expect(result).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe('cacheKey', () => {
    it('should cache API key with TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await service.cacheKey(mockApiKey);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'api-key:test-key',
        600,
        JSON.stringify(mockApiKey),
      );
    });

    it('should not throw on Redis failure', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.cacheKey(mockApiKey)).resolves.not.toThrow();
    });

    it('should not cache when caching is disabled', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'API_KEY_CACHE_ENABLED') return 'false';
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ApiKeyCacheService,
          { provide: 'REDIS_CLIENT', useValue: mockRedis },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const disabledService = module.get<ApiKeyCacheService>(ApiKeyCacheService);

      await disabledService.cacheKey(mockApiKey);

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  describe('cacheValidationResult', () => {
    it('should cache valid validation result', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await service.cacheValidationResult('test-token', true);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('api-key-validation:'),
        600,
        '1',
      );
    });

    it('should cache invalid validation result', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await service.cacheValidationResult('test-token', false, 300);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('api-key-validation:'),
        300,
        '0',
      );
    });
  });

  describe('getCachedValidationResult', () => {
    it('should return true for valid cached result', async () => {
      mockRedis.get.mockResolvedValue('1');

      const result = await service.getCachedValidationResult('test-token');

      expect(result).toBe(true);
    });

    it('should return false for invalid cached result', async () => {
      mockRedis.get.mockResolvedValue('0');

      const result = await service.getCachedValidationResult('test-token');

      expect(result).toBe(false);
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getCachedValidationResult('test-token');

      expect(result).toBeNull();
    });
  });

  describe('invalidateKey', () => {
    it('should delete cached key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.invalidateKey('test-key');

      expect(mockRedis.del).toHaveBeenCalledWith('api-key:test-key');
    });

    it('should not throw on Redis failure', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.invalidateKey('test-key')).resolves.not.toThrow();
    });
  });

  describe('clearAllCaches', () => {
    it('should clear all API key and validation caches', async () => {
      // Mock SCAN results
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['api-key:key1', 'api-key:key2']])
        .mockResolvedValueOnce(['0', ['api-key-validation:val1', 'api-key-validation:val2']]);

      mockRedis.del.mockResolvedValue(4);

      await service.clearAllCaches();

      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
      expect(mockRedis.del).toHaveBeenCalledWith(
        'api-key:key1',
        'api-key:key2',
        'api-key-validation:val1',
        'api-key-validation:val2',
      );
    });

    it('should handle empty cache gracefully', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      await service.clearAllCaches();

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('warmCache', () => {
    it('should warm cache with multiple API keys', async () => {
      const mockKeys = [mockApiKey, { ...mockApiKey, id: 'test-id-2', description: 'test-key-2' }];

      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      await service.warmCache(mockKeys);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.setex).toHaveBeenCalledTimes(2);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should not warm cache when disabled', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'API_KEY_CACHE_ENABLED') return 'false';
        return defaultValue;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ApiKeyCacheService,
          { provide: 'REDIS_CLIENT', useValue: mockRedis },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const disabledService = module.get<ApiKeyCacheService>(ApiKeyCacheService);

      await disabledService.warmCache([mockApiKey]);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });
  });

  describe('getCacheStats', () => {
    it('should track cache hits and misses', async () => {
      // Simulate cache operations
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockApiKey)); // HIT
      mockRedis.get.mockResolvedValueOnce(null); // MISS
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockApiKey)); // HIT

      await service.getCachedKey('test-key-1');
      await service.getCachedKey('test-key-2');
      await service.getCachedKey('test-key-3');

      const stats = service.getCacheStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.hitRate).toBe('66.67%');
    });

    it('should handle zero requests', () => {
      const stats = service.getCacheStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.hitRate).toBe('0.00%');
    });
  });

  describe('resetCacheStats', () => {
    it('should reset cache statistics', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockApiKey));

      await service.getCachedKey('test-key');
      expect(service.getCacheStats().hits).toBe(1);

      service.resetCacheStats();

      const stats = service.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis is healthy', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('ok');
      mockRedis.del.mockResolvedValue(1);

      const result = await service.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when Redis fails', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should complete cache operations in reasonable time', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockApiKey));
      mockRedis.setex.mockResolvedValue('OK');

      const start = Date.now();

      // Perform 100 cache operations
      for (let i = 0; i < 100; i++) {
        await service.getCachedKey('test-key');
      }

      const duration = Date.now() - start;

      // Should complete 100 operations in under 100ms (1ms per operation)
      expect(duration).toBeLessThan(100);
    });

    it('should sanitize cache keys to prevent injection', () => {
      const maliciousDescription = 'test-key; DELETE FROM users';

      const cacheKey = (service as any).buildCacheKey(maliciousDescription);

      // Should remove special characters like ; but keep word characters, whitespace, and hyphens
      expect(cacheKey).not.toContain(';');
      expect(cacheKey).toContain('DELETE'); // Word characters are preserved
      expect(cacheKey).toContain('FROM'); // Word characters are preserved
      expect(cacheKey).toBe('api-key:test-key DELETE FROM users'); // Sanitized result
    });
  });
});
