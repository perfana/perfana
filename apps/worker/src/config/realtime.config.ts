import { RealtimePublisherService } from '@perfana/shared/realtime';
import { getConfig } from './environment.js';

/**
 * Create a RealtimePublisherService instance for the worker
 *
 * This service enables the worker to publish realtime updates to Redis,
 * which the API subscribes to and broadcasts via Socket.IO to frontend clients.
 *
 * Architecture:
 *   Worker Pipeline → RealtimePublisherService.triggerTestRunUpdated()
 *                  → Redis Publish (test_run:updated channel)
 *                  → API RealtimeService subscribes
 *                  → Socket.IO broadcasts to frontend clients
 *                  → Frontend UI updates instantly
 */
export function createRealtimePublisher(): RealtimePublisherService {
  const config = getConfig();

  // Construct Redis URL from REDIS_HOST and REDIS_PORT (set in docker-compose)
  // Fallback to REDIS_URL if provided, otherwise use host:port
  const redisUrl = config.REDIS_URL && config.REDIS_URL !== 'redis://127.0.0.1:6379'
    ? config.REDIS_URL
    : `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
  const redisPassword = config.REDIS_PASSWORD;

  return new RealtimePublisherService(redisUrl, redisPassword);
}
