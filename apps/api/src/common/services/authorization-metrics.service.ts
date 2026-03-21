import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Metrics labels for categorizing access denial events
 */
export interface AccessDeniedLabels {
  /** User ID (Keycloak sub or api-key:{id}) */
  userId: string;
  /** Type of resource access was denied to */
  resourceType: string;
  /** Reason for denial */
  reason: string;
  /** Organization ID if applicable */
  organizationId?: string;
}

/**
 * Metrics labels for categorizing authorization checks
 */
export interface AuthCheckLabels {
  /** Type of check performed (canAccessResource, canModifyResource, isOrgMember, etc.) */
  checkType: string;
  /** Whether the check was cached */
  cached: boolean;
  /** Result of the check (allowed, denied) */
  result: 'allowed' | 'denied';
}

/**
 * Histogram bucket for duration tracking
 */
interface DurationBucket {
  le: number; // less than or equal threshold in ms
  count: number;
}

/**
 * Summary of authorization metrics for monitoring endpoints
 */
export interface AuthorizationMetricsSummary {
  /** Total access denied events */
  accessDeniedTotal: number;
  /** Access denials by resource type */
  accessDeniedByResourceType: Record<string, number>;
  /** Access denials by reason */
  accessDeniedByReason: Record<string, number>;
  /** Total authorization checks performed */
  authChecksTotal: number;
  /** Authorization checks by type */
  authChecksByType: Record<string, number>;
  /** Cache hit/miss stats for auth checks */
  cacheStats: {
    hits: number;
    misses: number;
    hitRate: string;
  };
  /** Duration percentiles for auth checks (in ms) */
  durationPercentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  /** Average duration of auth checks (in ms) */
  averageDurationMs: number;
  /** Time window for rolling metrics (in minutes) */
  windowMinutes: number;
}

/**
 * Authorization Metrics Service
 *
 * Provides comprehensive monitoring for authorization operations.
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening.
 *
 * Key Features:
 * - Tracks access denial events with categorization
 * - Measures authorization check latency
 * - Provides percentile calculations for SLA monitoring
 * - Supports rolling time windows for recent metrics
 * - Optional Prometheus integration (if @willsoto/nestjs-prometheus is installed)
 *
 * Metrics Tracked:
 * - access_denied_total: Counter for access denials by resource type and reason
 * - auth_check_duration_ms: Histogram of authorization check latencies
 * - auth_check_total: Counter for total authorization checks
 * - auth_check_cache_hits/misses: Cache performance metrics
 *
 * Usage:
 * - Inject this service in authorization guards and services
 * - Call recordAccessDenied() when access is denied
 * - Call recordAuthCheck() with timing info after each check
 * - Call getMetricsSummary() for monitoring endpoints
 */
@Injectable()
export class AuthorizationMetricsService implements OnModuleInit {
  private readonly logger = new Logger(AuthorizationMetricsService.name);

  // Rolling window configuration
  private readonly windowSizeMs: number; // 15 minutes default
  private readonly maxDataPoints: number; // Maximum data points to keep

  // Access denial tracking
  private accessDeniedEvents: Array<{
    timestamp: number;
    labels: AccessDeniedLabels;
  }> = [];

  // Authorization check tracking
  private authCheckEvents: Array<{
    timestamp: number;
    durationMs: number;
    labels: AuthCheckLabels;
  }> = [];

  // Simple counters for all-time stats
  private totalAccessDenied = 0;
  private totalAuthChecks = 0;
  private totalCacheHits = 0;
  private totalCacheMisses = 0;

  // Duration histogram buckets (in ms)
  private readonly durationBuckets: DurationBucket[] = [
    { le: 1, count: 0 },
    { le: 5, count: 0 },
    { le: 10, count: 0 },
    { le: 25, count: 0 },
    { le: 50, count: 0 },
    { le: 100, count: 0 },
    { le: 250, count: 0 },
    { le: 500, count: 0 },
    { le: 1000, count: 0 },
    { le: Infinity, count: 0 },
  ];

  // All duration values for percentile calculation
  private durationValues: number[] = [];

  constructor(@Optional() private readonly configService?: ConfigService) {
    // Default: 15 minute rolling window
    this.windowSizeMs =
      (this.configService?.get<number>('AUTH_METRICS_WINDOW_MINUTES', 15) || 15) * 60 * 1000;

    // Limit data points to prevent memory issues
    this.maxDataPoints = this.configService?.get<number>('AUTH_METRICS_MAX_DATA_POINTS', 10000) || 10000;
  }

  onModuleInit(): void {
    this.logger.log(
      `Authorization Metrics Service initialized (window: ${this.windowSizeMs / 60000} minutes, max data points: ${this.maxDataPoints})`,
    );
  }

  // ============================================
  // Recording Methods
  // ============================================

  /**
   * Record an access denied event.
   *
   * Call this method whenever an authorization check results in denial.
   * The event is recorded with a timestamp for rolling window calculations.
   *
   * @param labels - Labels categorizing the denial event
   */
  recordAccessDenied(labels: AccessDeniedLabels): void {
    this.totalAccessDenied++;

    const event = {
      timestamp: Date.now(),
      labels,
    };

    this.accessDeniedEvents.push(event);

    // Prune old events if exceeding max data points
    this.pruneAccessDeniedEvents();

    this.logger.debug(
      `Access denied recorded: user=${labels.userId}, resource=${labels.resourceType}, reason=${labels.reason}`,
    );
  }

  /**
   * Record an authorization check with timing information.
   *
   * Call this method after each authorization check to track latency
   * and cache performance.
   *
   * @param durationMs - Duration of the authorization check in milliseconds
   * @param labels - Labels categorizing the check
   */
  recordAuthCheck(durationMs: number, labels: AuthCheckLabels): void {
    this.totalAuthChecks++;

    // Track cache stats
    if (labels.cached) {
      this.totalCacheHits++;
    } else {
      this.totalCacheMisses++;
    }

    const event = {
      timestamp: Date.now(),
      durationMs,
      labels,
    };

    this.authCheckEvents.push(event);

    // Update histogram buckets
    for (const bucket of this.durationBuckets) {
      if (durationMs <= bucket.le) {
        bucket.count++;
        break;
      }
    }

    // Store duration for percentile calculations
    this.durationValues.push(durationMs);

    // Prune old events if exceeding max data points
    this.pruneAuthCheckEvents();

    this.logger.debug(
      `Auth check recorded: type=${labels.checkType}, duration=${durationMs}ms, cached=${labels.cached}, result=${labels.result}`,
    );
  }

  /**
   * Record a cache hit for authorization lookups.
   *
   * @param checkType - Type of authorization check
   */
  recordCacheHit(checkType: string): void {
    this.totalCacheHits++;
    this.logger.debug(`Cache hit recorded for: ${checkType}`);
  }

  /**
   * Record a cache miss for authorization lookups.
   *
   * @param checkType - Type of authorization check
   */
  recordCacheMiss(checkType: string): void {
    this.totalCacheMisses++;
    this.logger.debug(`Cache miss recorded for: ${checkType}`);
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get comprehensive metrics summary for monitoring.
   *
   * Returns aggregated metrics for the configured rolling window.
   * Useful for health check endpoints and dashboards.
   *
   * @returns AuthorizationMetricsSummary with all tracked metrics
   */
  getMetricsSummary(): AuthorizationMetricsSummary {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    // Filter events within window
    const recentDenials = this.accessDeniedEvents.filter((e) => e.timestamp >= windowStart);
    const recentChecks = this.authCheckEvents.filter((e) => e.timestamp >= windowStart);

    // Aggregate access denials by resource type
    const accessDeniedByResourceType: Record<string, number> = {};
    const accessDeniedByReason: Record<string, number> = {};

    for (const event of recentDenials) {
      const resourceType = event.labels.resourceType;
      const reason = event.labels.reason;

      accessDeniedByResourceType[resourceType] =
        (accessDeniedByResourceType[resourceType] || 0) + 1;
      accessDeniedByReason[reason] = (accessDeniedByReason[reason] || 0) + 1;
    }

    // Aggregate auth checks by type
    const authChecksByType: Record<string, number> = {};
    let windowCacheHits = 0;
    let windowCacheMisses = 0;
    const windowDurations: number[] = [];

    for (const event of recentChecks) {
      const checkType = event.labels.checkType;
      authChecksByType[checkType] = (authChecksByType[checkType] || 0) + 1;

      if (event.labels.cached) {
        windowCacheHits++;
      } else {
        windowCacheMisses++;
      }

      windowDurations.push(event.durationMs);
    }

    // Calculate cache hit rate
    const totalCacheOps = windowCacheHits + windowCacheMisses;
    const hitRate =
      totalCacheOps > 0
        ? ((windowCacheHits / totalCacheOps) * 100).toFixed(2)
        : '0.00';

    // Calculate duration percentiles
    const sortedDurations = [...windowDurations].sort((a, b) => a - b);
    const durationPercentiles = {
      p50: this.calculatePercentile(sortedDurations, 50),
      p90: this.calculatePercentile(sortedDurations, 90),
      p95: this.calculatePercentile(sortedDurations, 95),
      p99: this.calculatePercentile(sortedDurations, 99),
    };

    // Calculate average duration
    const averageDurationMs =
      windowDurations.length > 0
        ? windowDurations.reduce((sum, d) => sum + d, 0) / windowDurations.length
        : 0;

    return {
      accessDeniedTotal: recentDenials.length,
      accessDeniedByResourceType,
      accessDeniedByReason,
      authChecksTotal: recentChecks.length,
      authChecksByType,
      cacheStats: {
        hits: windowCacheHits,
        misses: windowCacheMisses,
        hitRate: `${hitRate}%`,
      },
      durationPercentiles,
      averageDurationMs: Math.round(averageDurationMs * 100) / 100,
      windowMinutes: this.windowSizeMs / 60000,
    };
  }

  /**
   * Get all-time totals (not windowed).
   *
   * @returns Object with all-time counter values
   */
  getAllTimeTotals(): {
    totalAccessDenied: number;
    totalAuthChecks: number;
    totalCacheHits: number;
    totalCacheMisses: number;
    cacheHitRate: string;
  } {
    const totalCacheOps = this.totalCacheHits + this.totalCacheMisses;
    const hitRate =
      totalCacheOps > 0
        ? ((this.totalCacheHits / totalCacheOps) * 100).toFixed(2)
        : '0.00';

    return {
      totalAccessDenied: this.totalAccessDenied,
      totalAuthChecks: this.totalAuthChecks,
      totalCacheHits: this.totalCacheHits,
      totalCacheMisses: this.totalCacheMisses,
      cacheHitRate: `${hitRate}%`,
    };
  }

  /**
   * Get recent access denied events for security monitoring.
   *
   * @param limit - Maximum number of events to return (default: 100)
   * @returns Array of recent access denied events with timestamps
   */
  getRecentAccessDeniedEvents(limit = 100): Array<{
    timestamp: Date;
    userId: string;
    resourceType: string;
    reason: string;
    organizationId?: string;
  }> {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    return this.accessDeniedEvents
      .filter((e) => e.timestamp >= windowStart)
      .slice(-limit)
      .map((e) => ({
        timestamp: new Date(e.timestamp),
        userId: e.labels.userId,
        resourceType: e.labels.resourceType,
        reason: e.labels.reason,
        organizationId: e.labels.organizationId,
      }))
      .reverse(); // Most recent first
  }

  /**
   * Get histogram bucket counts for duration distribution.
   *
   * @returns Array of bucket thresholds and their counts
   */
  getDurationHistogram(): Array<{
    le: string;
    count: number;
  }> {
    return this.durationBuckets.map((bucket) => ({
      le: bucket.le === Infinity ? '+Inf' : `${bucket.le}ms`,
      count: bucket.count,
    }));
  }

  // ============================================
  // Health & Diagnostics
  // ============================================

  /**
   * Health check for the metrics service.
   *
   * @returns true if the service is operational
   */
  healthCheck(): boolean {
    try {
      // Verify we can record and retrieve metrics
      const summary = this.getMetricsSummary();
      return typeof summary.accessDeniedTotal === 'number';
    } catch {
      return false;
    }
  }

  /**
   * Reset all metrics counters and event logs.
   *
   * Use sparingly - primarily for testing.
   */
  reset(): void {
    this.accessDeniedEvents = [];
    this.authCheckEvents = [];
    this.totalAccessDenied = 0;
    this.totalAuthChecks = 0;
    this.totalCacheHits = 0;
    this.totalCacheMisses = 0;
    this.durationValues = [];

    for (const bucket of this.durationBuckets) {
      bucket.count = 0;
    }

    this.logger.log('Authorization metrics reset');
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Calculate percentile value from sorted array
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)] ?? 0;
  }

  /**
   * Prune old access denied events to stay within limits
   */
  private pruneAccessDeniedEvents(): void {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    // Remove events outside the window
    this.accessDeniedEvents = this.accessDeniedEvents.filter(
      (e) => e.timestamp >= windowStart,
    );

    // Also enforce max data points
    if (this.accessDeniedEvents.length > this.maxDataPoints) {
      this.accessDeniedEvents = this.accessDeniedEvents.slice(-this.maxDataPoints);
    }
  }

  /**
   * Prune old auth check events to stay within limits
   */
  private pruneAuthCheckEvents(): void {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    // Remove events outside the window
    this.authCheckEvents = this.authCheckEvents.filter(
      (e) => e.timestamp >= windowStart,
    );

    // Also enforce max data points
    if (this.authCheckEvents.length > this.maxDataPoints) {
      this.authCheckEvents = this.authCheckEvents.slice(-this.maxDataPoints);
    }

    // Also prune duration values
    if (this.durationValues.length > this.maxDataPoints) {
      this.durationValues = this.durationValues.slice(-this.maxDataPoints);
    }
  }
}
