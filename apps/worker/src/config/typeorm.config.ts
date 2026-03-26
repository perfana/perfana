import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { createTypeOrmConfig as createSharedConfig, parseSslConfig } from '@perfana/shared/config';
import { getConfig } from './environment.js';

/**
 * Write-dedicated TypeORM configuration for the worker.
 * Small pool that can never be starved by analytical queries.
 * Used for INSERT INTO ds_metrics and other write-heavy operations.
 *
 * See: 2026-03-26 write starvation post-mortem (recommendation C)
 */
export const createWriteTypeOrmConfig = (): TypeOrmModuleOptions => {
  const config = getConfig();
  const sslConfig = parseSslConfig(config.DB_SSL);

  return {
    ...createSharedConfig({
      host: config.DB_HOST,
      port: config.DB_PORT,
      username: config.DB_USERNAME,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      ssl: sslConfig,
      nodeEnv: config.NODE_ENV,
      poolSize: 8,            // Small dedicated pool — just for writes
      minConnections: 2,      // Minimal pre-allocation
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 30000,
      statementTimeout: 60000,  // 1 minute — writes should be fast
      queryTimeout: 60000,
    }),
    name: 'write', // Named connection for injection
  };
};

/**
 * TypeORM configuration for the worker application
 * Uses shared configuration factory from @perfana/shared
 */
export const createTypeOrmConfig = (): TypeOrmModuleOptions => {
  const config = getConfig();

  // Parse SSL configuration using shared helper (matches API and grafana-sync services)
  const sslConfig = parseSslConfig(config.DB_SSL);

  // Pool sized for 2 concurrent analyze jobs (default) with headroom.
  // Previously 100/30 — caused connection saturation during load tests.
  // With concurrency 2, each job needs ~3 connections → 6 active + buffer.
  // See: 2026-03-26 write starvation post-mortem
  return createSharedConfig({
    host: config.DB_HOST,
    port: config.DB_PORT,
    username: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    ssl: sslConfig,
    nodeEnv: config.NODE_ENV,
    poolSize: config.DB_POOL_SIZE || 30,
    minConnections: 10,
    idleTimeoutMillis: 600000, // 10 minutes - must exceed longest transaction duration (ADAPT can take 5+ min)
    connectionTimeoutMillis: 60000, // 1 minute to acquire a connection from pool
    statementTimeout: 600000, // 10 minute global timeout (analytics get shorter via SET LOCAL)
    queryTimeout: 600000, // 10 minute query timeout
  });
};
