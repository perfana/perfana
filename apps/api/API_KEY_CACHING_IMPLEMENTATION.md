# API Key Caching Implementation

## Overview

This document describes the implementation of high-performance API key caching using Redis (ioredis) to resolve the critical N+1 query pattern in API key authentication.

## Problem Statement

### Before Optimization

The original `validateApiKey()` method in `api-keys.service.ts` had a severe performance issue:

```typescript
// ❌ BAD: Loads ALL API keys on EVERY request
const allKeys = await this.apiKeyRepository.findAll();
const apiKeyDoc = allKeys.find(key => key.description === description);
```

**Performance Impact:**
- **O(n) database query** on every authenticated request
- Loaded entire API key table regardless of which key was being validated
- No caching mechanism
- Would become a critical bottleneck as API keys scale (100+ keys)
- Database connection pool exhaustion under high load

### After Optimization

```typescript
// ✅ GOOD: Targeted cache lookup + single DB query on cache miss
let apiKeyDoc = await this.apiKeyCacheService.getCachedKey(description);

if (!apiKeyDoc) {
  apiKeyDoc = await this.apiKeyRepository.searchByDescription(description)
    .then(keys => keys.find(key => key.description === description) || null);

  if (apiKeyDoc) {
    await this.apiKeyCacheService.cacheKey(apiKeyDoc);
  }
}
```

**Performance Improvement:**
- **O(1) Redis GET** on cache hit (>95% of requests)
- **Single targeted DB query** on cache miss
- Expected 50-100x faster response time for cached keys
- Dramatically reduced database load

## Architecture

### Components

1. **ApiKeyCacheService** (`api-key-cache.service.ts`)
   - Core caching logic using ioredis
   - Cache key management and invalidation
   - Cache warming and statistics

2. **ApiKeysService** (`api-keys.service.ts`)
   - Integrates caching into validation flow
   - Handles cache invalidation on CRUD operations
   - Provides cache management endpoints

3. **Redis Client** (from `QueueModule`)
   - Shared ioredis client instance
   - Existing infrastructure, no new dependencies

### Caching Strategy

#### Two-Level Caching

1. **API Key Cache** (`api-key:{description}`)
   - Caches full API key entity by description
   - TTL: 10 minutes (configurable via `API_KEY_CACHE_TTL_SECONDS`)
   - Fast lookup without database query

2. **Validation Result Cache** (`api-key-validation:{tokenHash}`)
   - Caches validation outcome (valid/invalid)
   - Avoids expensive bcrypt comparisons
   - TTL: 10 minutes for valid, 5 minutes for invalid
   - Dramatically reduces CPU usage

#### Validation Flow

```
Request with API key token
         ↓
1. Check validation result cache (fastest)
   ├─ HIT (invalid) → Return null immediately
   └─ MISS → Continue
         ↓
2. Decode token, extract description
         ↓
3. Check API key cache by description
   ├─ HIT → Skip to step 5
   └─ MISS → Continue to step 4
         ↓
4. Query database (targeted query by description)
   ├─ Found → Cache the API key
   └─ Not found → Cache negative result, return null
         ↓
5. Validate expiration
   ├─ Expired → Cache negative result, return null
   └─ Valid → Continue
         ↓
6. Compare token with bcrypt (expensive)
   ├─ Valid → Cache positive result, update last_used
   └─ Invalid → Cache negative result
         ↓
7. Return validation result
```

## Implementation Details

### Cache Keys

```typescript
// API Key storage
api-key:{description}          → JSON serialized ApiKey entity

// Validation results
api-key-validation:{tokenHash} → "1" (valid) or "0" (invalid)
```

### Cache Invalidation

Automatic invalidation occurs on:

1. **API Key Creation** → Cache new key immediately
2. **API Key Deletion** → Invalidate by description + all validation results
3. **API Key Update** → Invalidate by description (if implemented)

### Cache Operations

```typescript
// Get cached key (O(1))
const apiKey = await apiKeyCacheService.getCachedKey(description);

// Cache key with TTL (O(1))
await apiKeyCacheService.cacheKey(apiKey);

// Invalidate specific key (O(1))
await apiKeyCacheService.invalidateKey(description);

// Clear all caches (O(n) where n = number of cache entries)
await apiKeyCacheService.clearAllCaches();

// Warm cache (batch operation)
await apiKeyCacheService.warmCache(apiKeys);
```

## Configuration

### Environment Variables

Add to `.env` file:

```bash
# API Key Cache Configuration
API_KEY_CACHE_ENABLED=true              # Enable/disable caching
API_KEY_CACHE_TTL_SECONDS=600           # Cache TTL (10 minutes default)
```

### Default Values

- **Cache Enabled**: `true`
- **Cache TTL**: `600 seconds` (10 minutes)
- **Negative Result TTL**: `300 seconds` (5 minutes)

### Tuning Guidelines

| Environment | TTL (seconds) | Rationale |
|------------|---------------|-----------|
| **Development** | 300 (5 min) | Faster invalidation for testing |
| **Production** | 600 (10 min) | Balance performance vs freshness |
| **High Traffic** | 900 (15 min) | Maximize cache hit rate |

## API Endpoints

### Cache Management

```bash
# Get cache statistics
GET /api/api-keys/cache/stats

Response:
{
  "hits": 1250,
  "misses": 50,
  "hitRate": "96.15%",
  "totalRequests": 1300
}

# Clear all caches (maintenance)
POST /api/api-keys/cache/clear

Response:
{
  "message": "All API key caches cleared successfully"
}

# Warm caches (startup/maintenance)
POST /api/api-keys/cache/warm

Response:
{
  "message": "API key caches warmed successfully"
}
```

## Performance Metrics

### Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Cache Hit** | N/A | ~2-5ms | N/A |
| **Cache Miss** | ~50-100ms | ~10-20ms | 5-10x faster |
| **Database Queries** | 1 per request (all keys) | 0.01 per request (1% miss rate) | 100x reduction |
| **CPU Usage** | High (bcrypt every request) | Low (bcrypt only on miss) | 50-90% reduction |
| **Throughput** | ~100 req/s | ~1000+ req/s | 10x increase |

### Monitoring

Track these metrics in production:

1. **Cache Hit Rate** → Target: >95%
2. **Average Response Time** → Target: <5ms
3. **Database Query Count** → Target: <1% of requests
4. **Redis Memory Usage** → Target: <100MB for 1000 keys

## Testing

### Manual Testing

```bash
# 1. Create an API key
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "test-key",
    "ttl": "30d"
  }'

# Save the returned token

# 2. Validate multiple times (first = MISS, subsequent = HIT)
for i in {1..10}; do
  time curl -X POST http://localhost:3001/api/api-keys/validate \
    -H "Content-Type: application/json" \
    -d '{"token": "YOUR_TOKEN_HERE"}'
done

# 3. Check cache stats
curl http://localhost:3001/api/api-keys/cache/stats

# 4. Clear cache and retest
curl -X POST http://localhost:3001/api/api-keys/cache/clear
```

### Unit Testing

```typescript
describe('ApiKeyCacheService', () => {
  it('should cache and retrieve API key', async () => {
    await cacheService.cacheKey(mockApiKey);
    const cached = await cacheService.getCachedKey(mockApiKey.description);
    expect(cached).toEqual(mockApiKey);
  });

  it('should invalidate cached key', async () => {
    await cacheService.cacheKey(mockApiKey);
    await cacheService.invalidateKey(mockApiKey.description);
    const cached = await cacheService.getCachedKey(mockApiKey.description);
    expect(cached).toBeNull();
  });

  it('should track cache statistics', async () => {
    await cacheService.getCachedKey('test'); // miss
    await cacheService.cacheKey(mockApiKey);
    await cacheService.getCachedKey(mockApiKey.description); // hit

    const stats = cacheService.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('50.00%');
  });
});
```

### Load Testing

```bash
# Install k6 or similar load testing tool
k6 run - <<EOF
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 100,
  duration: '30s',
};

export default function() {
  const token = 'YOUR_TOKEN_HERE';
  const res = http.get('http://localhost:3001/api/test-runs', {
    headers: { 'Authorization': \`Bearer \${token}\` },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 50ms': (r) => r.timings.duration < 50,
  });
}
EOF
```

## Troubleshooting

### Common Issues

1. **Cache not working**
   - Check `API_KEY_CACHE_ENABLED=true` in `.env`
   - Verify Redis connection: `redis-cli ping`
   - Check logs for cache errors

2. **Low cache hit rate (<80%)**
   - Increase TTL: `API_KEY_CACHE_TTL_SECONDS=900`
   - Warm cache on startup: `POST /api/api-keys/cache/warm`
   - Check for frequent key deletions/updates

3. **Stale cache data**
   - Verify cache invalidation is working
   - Reduce TTL if needed
   - Clear cache manually: `POST /api/api-keys/cache/clear`

4. **High Redis memory usage**
   - Check number of cached keys: `redis-cli dbsize`
   - Reduce TTL to expire entries faster
   - Implement cache size limits if needed

### Debug Commands

```bash
# Check Redis connection
redis-cli ping

# View cached keys
redis-cli --scan --pattern "api-key:*"

# View specific cache entry
redis-cli get "api-key:test-key"

# Clear all cache entries (dangerous!)
redis-cli flushdb

# Monitor Redis operations in real-time
redis-cli monitor | grep "api-key"
```

## Security Considerations

1. **No Plain Tokens in Cache**: Only hashed tokens stored in database
2. **Token Hash in Cache Key**: Validation cache uses token hash, not full token
3. **TTL Enforcement**: Automatic expiration prevents stale credentials
4. **Cache Invalidation**: Immediate invalidation on key deletion
5. **Redis Security**: Use password-protected Redis in production

## Future Enhancements

1. **Distributed Caching**: Redis Cluster for multi-instance deployments
2. **Cache Warming on Startup**: Automatically warm frequently used keys
3. **Adaptive TTL**: Adjust TTL based on usage patterns
4. **Cache Preloading**: Preload keys for scheduled jobs
5. **Metrics Export**: Export cache metrics to Prometheus/Grafana
6. **LRU Eviction**: Implement LRU policy for memory-constrained environments

## Rollback Plan

If issues arise, caching can be disabled without code changes:

```bash
# Disable caching
export API_KEY_CACHE_ENABLED=false

# Restart API service
npm run dev:api
```

This will cause the system to fall back to database queries only.

## References

- **Redis Commands**: https://redis.io/commands
- **ioredis Documentation**: https://github.com/luin/ioredis
- **Cache Invalidation Strategies**: https://martinfowler.com/bliki/TwoHardThings.html
- **NestJS Caching**: https://docs.nestjs.com/techniques/caching

## Changelog

### Version 1.0.0 (2025-11-06)

- Initial implementation of API key caching
- Two-level cache strategy (API keys + validation results)
- Cache invalidation on CRUD operations
- Cache monitoring endpoints
- Environment-based configuration
- Comprehensive documentation
