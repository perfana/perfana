/**
 * Realtime updates module
 *
 * Provides shared realtime publishing functionality for both API and worker.
 * The RealtimePublisherService publishes events to Redis channels,
 * which the API subscribes to and broadcasts via Socket.IO to frontend clients.
 */

export * from './realtime-publisher.service.js';
export * from './redis.config.js';
