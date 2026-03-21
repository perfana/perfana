import { Injectable, ExecutionContext, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import { AuthenticatedRequest } from './keycloak-enhanced-auth.guard';
import { THROTTLE_CONFIG_KEY } from '../decorators/throttle-config.decorator';

/**
 * Enhanced Throttler Guard with differentiated rate limits
 *
 * Rate Limiting Strategy:
 * - Authenticated users: Higher limits (identified by user ID)
 * - Unauthenticated/Public: Lower limits (identified by IP address)
 * - Authentication endpoints: Strictest limits (prevents brute force)
 *
 * Response Headers:
 * - X-RateLimit-Limit: Maximum requests allowed
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 * - Retry-After: Seconds to wait before retrying (on 429 errors)
 */
@Injectable()
export class EnhancedThrottlerGuard {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ThrottlerStorage)
    private readonly storageService: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = await this.getThrottlerConfig(context);

    // Skip rate limiting if configured
    if (config.skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse();

    // Generate unique key for this request
    const tracker = await this.getTracker(request);
    const key = `${tracker}:${request.url}`;

    // Increment counter in storage
    const ttlSeconds = Math.ceil(config.ttl / 1000);
    const storageRecord = await this.storageService.increment(
      key,
      ttlSeconds,
      config.limit,
      0, // blockDuration
      'default', // throttlerName
    );

    const remaining = Math.max(0, config.limit - storageRecord.totalHits);
    const resetTime = Math.ceil(Date.now() / 1000) + ttlSeconds;

    // Always add rate limit headers
    response.setHeader('X-RateLimit-Limit', config.limit);
    response.setHeader('X-RateLimit-Remaining', remaining);
    response.setHeader('X-RateLimit-Reset', resetTime);

    // Check if limit exceeded
    if (storageRecord.totalHits > config.limit) {
      response.setHeader('Retry-After', ttlSeconds);
      throw new ThrottlerException(
        `Rate limit exceeded. Maximum ${config.limit} requests per ${ttlSeconds} seconds. Please retry after ${ttlSeconds} seconds.`,
      );
    }

    return true;
  }

  /**
   * Generate throttle key based on authentication status
   * Authenticated users are tracked by user ID, others by IP
   */
  private async getTracker(req: AuthenticatedRequest): Promise<string> {
    // For authenticated users, use user identifier
    if (req.authType === 'keycloak-jwt' && req.user?.sub) {
      return `throttle:user:${req.user.sub}`;
    }

    if (req.authType === 'api-key') {
      return `throttle:api-key:${this.getRequestIP(req)}`;
    }

    // For unauthenticated requests, use IP address
    return `throttle:ip:${this.getRequestIP(req)}`;
  }

  /**
   * Extract IP address from request
   * Handles proxies and load balancers correctly
   */
  private getRequestIP(req: Record<string, any>): string {
    const headers = req.headers as Record<string, string | string[] | undefined>;

    // Check common proxy headers
    const xForwardedFor = headers['x-forwarded-for'];
    const xRealIp = headers['x-real-ip'];
    const cfConnectingIp = headers['cf-connecting-ip']; // Cloudflare

    if (xForwardedFor) {
      // X-Forwarded-For can contain multiple IPs, use the first one
      const ips = Array.isArray(xForwardedFor)
        ? xForwardedFor[0]
        : xForwardedFor;
      return ips?.split(',')[0]?.trim() || '0.0.0.0';
    }

    if (xRealIp) {
      return Array.isArray(xRealIp) ? (xRealIp[0] || '0.0.0.0') : xRealIp;
    }

    if (cfConnectingIp) {
      return Array.isArray(cfConnectingIp) ? (cfConnectingIp[0] || '0.0.0.0') : cfConnectingIp;
    }

    // Fallback to socket IP
    const connection = req.connection as { remoteAddress?: string } | undefined;
    const socket = req.socket as { remoteAddress?: string } | undefined;

    return (
      connection?.remoteAddress ||
      socket?.remoteAddress ||
      '0.0.0.0'
    );
  }

  /**
   * Get rate limit configuration based on route and authentication status
   */
  private async getThrottlerConfig(context: ExecutionContext): Promise<{
    limit: number;
    ttl: number;
    skip?: boolean;
  }> {
    // Check for custom throttle configuration from decorator
    const customConfig = this.reflector.getAllAndOverride<{ limit?: number; ttl?: number; skip?: boolean }>(
      THROTTLE_CONFIG_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If skip flag is set, return skip indicator
    if (customConfig?.skip) {
      return { limit: 0, ttl: 0, skip: true };
    }

    // If custom config exists, use it
    if (customConfig?.limit && customConfig?.ttl) {
      return { limit: customConfig.limit, ttl: customConfig.ttl };
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.url || '';
    const method = request.method || 'GET';

    // Strict limits for authentication endpoints (prevent brute force)
    if (this.isAuthenticationEndpoint(path, method)) {
      return { limit: 5, ttl: 60000 }; // 5 requests per minute
    }

    // For authenticated users (JWT or API key), use higher limits
    if (request.authType === 'keycloak-jwt' || request.authType === 'api-key') {
      return { limit: 1000, ttl: 60000 }; // 1000 requests per minute
    }

    // Lower limits for write operations from unauthenticated sources
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return { limit: 20, ttl: 60000 }; // 20 requests per minute
    }

    // Default limit for public endpoints
    return { limit: 100, ttl: 60000 }; // 100 requests per minute
  }

  /**
   * Check if endpoint is authentication-related
   */
  private isAuthenticationEndpoint(path: string, method: string): boolean {
    if (method !== 'POST') return false;

    const authPaths = [
      '/api/auth/login',
      '/api/auth/token',
      '/api/auth/refresh',
      '/api/api-keys/validate',
    ];

    return authPaths.some((authPath) => path.startsWith(authPath));
  }
}
