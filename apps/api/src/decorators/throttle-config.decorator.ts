import { SetMetadata } from '@nestjs/common';

export const THROTTLE_CONFIG_KEY = 'throttle_config';

/**
 * Custom throttle configuration for specific endpoints
 *
 * @param limit - Maximum number of requests allowed
 * @param ttl - Time window in milliseconds
 *
 * @example
 * // Strict rate limiting for authentication
 * @ThrottleConfig(5, 60000) // 5 requests per minute
 * @Post('login')
 * async login() { ... }
 *
 * @example
 * // Relaxed rate limiting for public endpoints
 * @ThrottleConfig(200, 60000) // 200 requests per minute
 * @Get('health')
 * async health() { ... }
 */
export const ThrottleConfig = (limit: number, ttl: number) =>
  SetMetadata(THROTTLE_CONFIG_KEY, { limit, ttl });

/**
 * Skip rate limiting for specific endpoints
 * Use sparingly - only for truly unlimited endpoints
 *
 * @example
 * @SkipThrottle()
 * @Get('internal/health')
 * async internalHealth() { ... }
 */
export const SkipThrottle = () =>
  SetMetadata(THROTTLE_CONFIG_KEY, { skip: true });
