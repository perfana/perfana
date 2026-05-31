import { getService } from '../nestjs-bootstrap.js';
import { RealtimePublisherService } from '@perfana/shared/realtime';

/**
 * Realtime Publisher Service Accessor
 *
 * Provides a convenient way to access the RealtimePublisherService
 * from anywhere in the worker application (pipelines, services, etc.)
 *
 * Usage:
 * ```typescript
 * import { getRealtimePublisher } from '../common/realtime-accessor.js';
 *
 * const realtime = getRealtimePublisher();
 * await realtime.triggerTestRunUpdated(testRun);
 * ```
 */

let cachedService: RealtimePublisherService | null = null;

/**
 * Get the RealtimePublisherService instance
 * This uses the NestJS DI container under the hood
 */
export function getRealtimePublisher(): RealtimePublisherService {
  if (!cachedService) {
    cachedService = getService(RealtimePublisherService);
  }
  return cachedService;
}
