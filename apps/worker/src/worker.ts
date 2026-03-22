#!/usr/bin/env node

// CRITICAL: Must be the very first import for TypeORM decorators to work
import 'reflect-metadata';

import { INestApplicationContext } from '@nestjs/common';
import { loadConfig } from './config/environment.js';
import { testRedisConnection } from './config/redis.js';
import { getRedisPool, getRedisPoolStats } from './config/redis-pool.js';
import { createLogger } from './lib/utils/logger.js';
import { registerSimpleWorkers, stopSimpleWorkers } from './workers/simple-workers.js';
import type Redis from 'ioredis';
import { bootstrapNestJS, shutdownNestJS } from './nestjs-bootstrap.js';
import { StuckJobScanner } from './services/StuckJobScanner.js';

export class PerfanaWorkerApp {
  private redisConnection: Redis | null = null;
  private nestApp: INestApplicationContext | null = null;
  private logger = createLogger();
  private isShuttingDown = false;
  private poolMonitorInterval: NodeJS.Timeout | null = null;
  private stuckJobScanner: StuckJobScanner | null = null;
  private scannerRedis: Redis | null = null;

  constructor() {
    // Load and validate configuration
    loadConfig();
    this.logger.info('🚀 Perfana DS Worker starting up...');
  }

  async start(): Promise<void> {
    try {
      // Initialize NestJS application context (TypeORM + Dependency Injection)
      this.logger.info('🔧 Initializing NestJS application context...');
      this.nestApp = await bootstrapNestJS();
      this.logger.info('✅ NestJS application context initialized');
      this.logger.info('💎 All database operations use TypeORM (pg Pool removed)');

      // Initialize Redis connection pool
      this.logger.info('🔧 Initializing Redis connection pool...');
      const redisPool = getRedisPool({
        maxConnections: 20,
        minConnections: 5,
        enableHealthCheck: true
      });

      // Test pool with a single connection
      this.redisConnection = await redisPool.acquire();
      await testRedisConnection(this.redisConnection);
      redisPool.release(this.redisConnection);
      this.redisConnection = null; // We'll use pool from now on

      this.logger.info('✅ Redis connection pool initialized');

      // Log initial pool stats
      const poolStats = getRedisPoolStats();
      this.logger.info('📊 Redis pool stats:', poolStats);

      // Test all connections
      await this.testConnections();

      // Register simplified workers (2-queue architecture with BRPOPLPUSH)
      this.logger.info('🔧 Starting simplified worker registration...');
      await registerSimpleWorkers();
      this.logger.info('✅ All simplified workers registered');

      // Start StuckJobScanner
      this.logger.info('🔧 Starting StuckJobScanner...');
      this.scannerRedis = await redisPool.acquire();
      this.stuckJobScanner = new StuckJobScanner(this.scannerRedis);
      this.stuckJobScanner.start();
      this.logger.info('✅ StuckJobScanner started (scans every 2 minutes)');

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      this.logger.info('🎯 Perfana DS Worker is ready for jobs (BRPOPLPUSH blocking mode)');
      this.logger.info('📋 Simplified Architecture: 2 Queues');
      this.logger.info('  Queue 1: perfana-analyze (single test analysis)');
      this.logger.info('    - analyze-test, metrics-collection, statistics-calculation');
      this.logger.info('    - control-groups-pipeline, adapt-analysis, checks-evaluation');
      this.logger.info('    - panels-processing, dynatrace-collection, reevaluate-checks');
      this.logger.info('    - collect-metrics-incremental (scheduled incremental collection)');
      this.logger.info('  Queue 2: perfana-batch (batch processing)');
      this.logger.info('    - batch-analysis, batch-flow, reevaluation-batch');
      this.logger.info('🚀 NO priority, NO rate limiting → <10ms job pickup expected');
      this.logger.info('💎 Using TypeORM for database operations (NestJS integration active)');
      this.logger.info('⏰ Scheduled tasks:');
      this.logger.info('   - IncrementalCollectionScheduler (cron: every 2 minutes)');
      this.logger.info('   - StuckJobScanner (interval: every 2 minutes)');

      // Keep the process running
      process.on('SIGINT', () => this.shutdown('SIGINT'));
      process.on('SIGTERM', () => this.shutdown('SIGTERM'));

    } catch (error) {
      this.logger.error('❌ Failed to start worker:', error);
      if (error instanceof Error) {
        this.logger.error('❌ Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
      } else {
        this.logger.error('❌ Non-Error object thrown:', String(error));
      }
      await this.cleanup();
      process.exit(1);
    }
  }

  private async testConnections(): Promise<void> {
    // Test TypeORM database connection via NestJS
    if (!this.nestApp) {
      throw new Error('NestJS application context not initialized');
    }

    try {
      // TypeORM connection is tested during NestJS bootstrap
      // We can verify it's working by getting the DataSource
      const { getDatabaseService } = await import('./common/database-accessor.js');
      const dbService = getDatabaseService();

      // Quick sanity check - try to query something simple
      await dbService.dataSource.query('SELECT 1');
      this.logger.info('✅ TypeORM database connection verified');
    } catch (error) {
      this.logger.error('❌ TypeORM database connection test failed:', error);
      throw new Error('TypeORM database connection test failed');
    }

    // Note: Skipping Redis connection test for lazy connections
    // BullMQ will automatically establish connections when needed

    // Note: Skipping queue connection test for faster startup
    // BullMQ will create connections automatically when workers start

    this.logger.info('✅ All connection tests passed');
  }

  private setupGracefulShutdown(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('❌ Uncaught exception:', error);
      this.shutdown('uncaughtException').finally(() => {
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('❌ Unhandled promise rejection:', {
        reason,
        promise: promise.toString(),
      });
      this.shutdown('unhandledRejection').finally(() => {
        process.exit(1);
      });
    });
  }

  private async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.info('⏳ Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info(`🛑 Shutting down worker... (signal: ${signal || 'manual'})`);

    await this.cleanup();
    this.logger.info('✅ Worker shutdown complete');
    process.exit(0);
  }

  // Pool monitoring removed - TypeORM manages connections internally

  private async cleanup(): Promise<void> {
    const cleanupPromises: Promise<void>[] = [];

    // Stop StuckJobScanner
    if (this.stuckJobScanner) {
      try {
        this.stuckJobScanner.stop();
        this.logger.info('✅ StuckJobScanner stopped');
      } catch (error) {
        this.logger.error('❌ Error stopping StuckJobScanner:', error);
      }
    }

    // Stop all simplified BullMQ workers
    cleanupPromises.push(
      (async () => {
        try {
          await stopSimpleWorkers();
          this.logger.info('✅ All simplified workers stopped');
        } catch (error) {
          this.logger.error('❌ Error stopping simplified workers:', error);
        }
      })()
    );

    // Close NestJS application context (TypeORM)
    cleanupPromises.push(
      (async () => {
        try {
          await shutdownNestJS();
          this.logger.info('✅ NestJS application context closed');
        } catch (error) {
          this.logger.error('❌ Error closing NestJS context:', error);
        }
      })()
    );

    // Release scanner Redis connection
    if (this.scannerRedis) {
      try {
        const redisPool = getRedisPool();
        redisPool.release(this.scannerRedis);
        this.scannerRedis = null;
        this.logger.info('✅ Scanner Redis connection released');
      } catch (error) {
        this.logger.error('❌ Error releasing scanner Redis connection:', error);
      }
    }

    // Close Redis connection pool
    cleanupPromises.push(
      (async () => {
        try {
          const redisPool = getRedisPool();
          await redisPool.destroy();
          this.logger.info('✅ Redis connection pool destroyed');
        } catch (error) {
          this.logger.error('❌ Error destroying Redis pool:', error);
        }
      })()
    );

    // Database pool cleanup removed - TypeORM is managed by NestJS shutdown

    // Wait for all cleanup operations to complete
    await Promise.allSettled(cleanupPromises);
  }

  get redis(): Redis | null {
    return this.redisConnection;
  }
}

// Start the worker if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = new PerfanaWorkerApp();
  const logger = createLogger();
  app.start().catch((error) => {
    logger.error('❌ Failed to start Perfana DS Worker:', error);
    process.exit(1);
  });
}