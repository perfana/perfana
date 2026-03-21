# Rate Limiting Implementation

This document describes the comprehensive rate limiting implementation for the Perfana API to prevent DoS attacks and ensure fair resource usage.

## Overview

The rate limiting system uses **@nestjs/throttler** with a custom Redis-backed storage implementation using **ioredis**. This provides distributed rate limiting across multiple API instances and prevents memory-based attacks.

## Architecture

### Components

1. **ThrottlerStorageRedisService** (`guards/throttler-storage-redis.service.ts`)
   - Redis-backed storage for rate limit counters
   - Uses atomic Lua scripts for increment + TTL operations
   - Implements ThrottlerStorage interface from @nestjs/throttler
   - Fallback to Redis MULTI commands if Lua script fails

2. **EnhancedThrottlerGuard** (`guards/enhanced-throttler.guard.ts`)
   - Custom guard extending ThrottlerGuard
   - Differentiated rate limits based on:
     - Authentication status (JWT, API key, unauthenticated)
     - HTTP method (GET vs POST/PUT/DELETE)
     - Endpoint type (auth endpoints vs regular endpoints)
   - Automatic rate limit header injection
   - IP address extraction with proxy support

3. **ThrottleConfig Decorator** (`decorators/throttle-config.decorator.ts`)
   - Custom rate limit configuration per endpoint
   - Skip rate limiting for specific endpoints (e.g., health checks)

## Rate Limit Strategy

### Default Limits

| Authentication Type | Limit | Time Window | Use Case |
|---------------------|-------|-------------|----------|
| Authenticated (JWT/API Key) | 1000 req/min | 60 seconds | Regular authenticated users |
| Unauthenticated (GET) | 100 req/min | 60 seconds | Public read-only endpoints |
| Unauthenticated (POST/PUT/DELETE) | 20 req/min | 60 seconds | Public write operations |
| Authentication Endpoints | 5 req/min | 60 seconds | Login, token validation (prevents brute force) |

### Custom Limits (Applied via @ThrottleConfig)

| Endpoint | Limit | Reason |
|----------|-------|--------|
| POST /api/test | 200 req/min | High-volume test submission endpoint |
| POST /api-keys/validate | 5 req/min | Prevents API key brute force |
| GET /api/auth/health | Unlimited | Health checks should not be rate limited |

## Configuration

### Environment Variables

```bash
# Optional: Override default rate limits
THROTTLE_TTL=60000          # Time window in milliseconds (default: 60000)
THROTTLE_LIMIT=100          # Default request limit (default: 100)

# Skip rate limiting entirely (not recommended for production)
SKIP_RATE_LIMITING=false    # Set to 'true' to disable (default: false)

# Redis connection (reuses existing REDIS_CLIENT from QueueModule)
REDIS_URL=redis://localhost:6379
```

### Module Configuration

Rate limiting is configured globally in `app.module.ts`:

```typescript
ThrottlerModule.forRootAsync({
  imports: [ConfigModule, QueueModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    throttlers: [
      {
        name: 'default',
        ttl: configService.get('THROTTLE_TTL', 60000),
        limit: configService.get('THROTTLE_LIMIT', 100),
      },
    ],
    errorMessage: 'Too many requests. Please try again later.',
    skipIf: () => configService.get('SKIP_RATE_LIMITING', 'false') === 'true',
  }),
}),
```

## Response Headers

All rate-limited responses include the following headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1699564800
```

When rate limit is exceeded (429 Too Many Requests):

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699564860
Retry-After: 60
```

### Header Definitions

- **X-RateLimit-Limit**: Maximum number of requests allowed in the current window
- **X-RateLimit-Remaining**: Number of requests remaining in the current window
- **X-RateLimit-Reset**: Unix timestamp (seconds) when the rate limit window resets
- **Retry-After**: Seconds to wait before retrying (only on 429 responses)

## Usage

### Apply Custom Rate Limits

Use the `@ThrottleConfig` decorator to override default limits:

```typescript
import { ThrottleConfig } from '../../decorators/throttle-config.decorator';

@Controller('api')
export class MyController {
  @Post('bulk-import')
  @ThrottleConfig(50, 60000) // 50 requests per minute
  async bulkImport(@Body() data: any) {
    // Implementation
  }
}
```

### Skip Rate Limiting

Use the `@SkipThrottle` decorator for endpoints that should not be rate limited:

```typescript
import { SkipThrottle } from '../../decorators/throttle-config.decorator';

@Controller('api')
export class HealthController {
  @Get('health')
  @SkipThrottle()
  async health() {
    return { status: 'ok' };
  }
}
```

## Tracking Mechanisms

### Authenticated Users

Rate limits are tracked by **user ID** (from JWT `sub` claim or API key identifier):

```
Key: throttle:user:{userId}:/api/test-runs
```

### Unauthenticated Users

Rate limits are tracked by **IP address**:

```
Key: throttle:ip:{ipAddress}:/api/test-runs
```

### IP Address Extraction

The guard supports multiple proxy headers for accurate IP detection:

1. **X-Forwarded-For**: Standard proxy header (uses first IP)
2. **X-Real-IP**: NGINX proxy header
3. **CF-Connecting-IP**: Cloudflare header
4. **Fallback**: Socket remote address

## Redis Storage

### Data Structure

Each rate limit counter is stored as a Redis string with automatic TTL:

```
Key: throttle:{type}:{identifier}:{path}
Value: {count}
TTL: {ttl_seconds}
```

Example:
```
Key: throttle:user:user-123:/api/test-runs
Value: 45
TTL: 60
```

### Atomic Operations

The storage service uses Lua scripts for atomic increment + TTL operations:

```lua
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local current = redis.call('incr', key)
if current == 1 then
  redis.call('expire', key, ttl)
end
return current
```

This ensures race-condition-free counter management across distributed API instances.

## Security Benefits

### DoS Attack Prevention

1. **Request Flooding**: Limited to configured requests per time window
2. **Distributed DoS**: Each IP address is tracked independently
3. **Resource Exhaustion**: Prevents overwhelming database/API with excessive requests

### Brute Force Protection

1. **Authentication Endpoints**: Strict 5 req/min limit on login/token endpoints
2. **API Key Validation**: 5 req/min limit prevents key enumeration attacks
3. **Failed Login Tracking**: Combined with Keycloak's built-in protection

### Fair Resource Usage

1. **Authenticated Users**: Higher limits reward legitimate usage
2. **API Keys**: Same high limits as authenticated users
3. **Public Access**: Lower limits protect against abuse while allowing legitimate traffic

## Testing

### Unit Tests

Run the test suites:

```bash
cd apps/api
npm test -- enhanced-throttler.guard.spec.ts
npm test -- throttler-storage-redis.service.spec.ts
```

### Integration Testing

Test rate limiting with curl:

```bash
# Test unauthenticated rate limiting (should hit limit after 100 requests)
for i in {1..110}; do
  curl -w "%{http_code}\n" http://localhost:3001/api/test-runs
done

# Test authenticated rate limiting (should have much higher limit)
TOKEN="your-jwt-token"
for i in {1..1010}; do
  curl -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/test-runs
done

# Test authentication endpoint strict limit (should hit limit after 5 requests)
for i in {1..10}; do
  curl -X POST -w "%{http_code}\n" \
    -H "Content-Type: application/json" \
    -d '{"token":"test-token"}' \
    http://localhost:3001/api/api-keys/validate
done
```

### Monitor Redis Keys

Check active rate limit counters in Redis:

```bash
# Connect to Redis
redis-cli

# View all throttle keys
KEYS throttle:*

# Check specific key value and TTL
GET throttle:ip:192.168.1.1:/api/test-runs
TTL throttle:ip:192.168.1.1:/api/test-runs

# Clear all rate limit counters (for testing)
KEYS throttle:* | xargs redis-cli DEL
```

## Production Considerations

### Scaling

- **Distributed Rate Limiting**: Redis-backed storage ensures consistent limits across multiple API instances
- **Redis Clustering**: For high-traffic deployments, use Redis Cluster or Sentinel
- **Connection Pooling**: Reuses existing ioredis connection from QueueModule

### Monitoring

Monitor rate limit effectiveness:

```typescript
// Add custom metrics (future enhancement)
- perfana_api_rate_limit_hits_total (counter)
- perfana_api_rate_limit_exceeded_total (counter)
- perfana_api_rate_limit_remaining (gauge)
```

### Whitelisting

For internal services or trusted IPs, consider:

1. **Environment-based skipping**: Set `SKIP_RATE_LIMITING=true` for specific instances
2. **Custom guard logic**: Add IP whitelist check in EnhancedThrottlerGuard
3. **Service-to-service auth**: Use API keys with higher limits

### Performance Impact

- **Minimal overhead**: ~1-2ms per request for Redis lookup/increment
- **Lua scripts**: Atomic operations reduce round trips to Redis
- **Connection reuse**: No additional Redis connections required

## Troubleshooting

### Rate Limit Not Applied

1. Check if endpoint has `@SkipThrottle()` decorator
2. Verify Redis connection is working: `redis-cli PING`
3. Check environment variable: `SKIP_RATE_LIMITING=false`
4. Ensure QueueModule is properly imported and provides `REDIS_CLIENT`

### False Positives

1. Verify IP extraction is correct (check proxy headers)
2. For authenticated users, ensure JWT is properly decoded
3. Check if multiple users share the same IP (NAT/corporate proxy)

### Redis Connection Issues

1. Verify Redis URL: `REDIS_URL=redis://localhost:6379`
2. Check Redis server status: `redis-cli PING`
3. Review application logs for Redis connection errors
4. Ensure Redis client is initialized in QueueModule

## Future Enhancements

1. **Dynamic rate limits**: Adjust limits based on API health/load
2. **User-specific limits**: Different limits for different user roles
3. **Bypass tokens**: Temporary rate limit bypass for legitimate high-volume use cases
4. **Rate limit analytics**: Dashboard showing rate limit usage patterns
5. **Adaptive throttling**: Automatically adjust limits during traffic spikes
6. **Distributed tracing**: Integrate with OpenTelemetry for rate limit metrics

## References

- [@nestjs/throttler Documentation](https://github.com/nestjs/throttler)
- [ioredis Documentation](https://github.com/luin/ioredis)
- [OWASP Rate Limiting Guidelines](https://owasp.org/www-community/controls/Rate_limiting)
- [RFC 6585 - Additional HTTP Status Codes](https://datatracker.ietf.org/doc/html/rfc6585#section-4)
