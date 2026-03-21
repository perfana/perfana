import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { createTypeOrmConfig as createSharedConfig, parseSslConfig } from '@perfana/shared/config';
import { getConfig } from './environment.js';

/**
 * TypeORM configuration for the worker application
 * Uses shared configuration factory from @perfana/shared
 */
export const createTypeOrmConfig = (): TypeOrmModuleOptions => {
  const config = getConfig();

  // Parse SSL configuration using shared helper (matches API and grafana-sync services)
  const sslConfig = parseSslConfig(config.DB_SSL);

  // Create configuration using shared factory (matches API and grafana-sync services)
  // Increased pool size for parallel batch processing (10 test runs simultaneously)
  // Each test run needs 2-3 connections during batch INSERT operations
  return createSharedConfig({
    host: config.DB_HOST,
    port: config.DB_PORT,
    username: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    ssl: sslConfig,
    nodeEnv: config.NODE_ENV,
    poolSize: config.DB_POOL_SIZE || 100,
    minConnections: 30,
    idleTimeoutMillis: 600000, // 10 minutes - must exceed longest transaction duration (ADAPT can take 5+ min)
    connectionTimeoutMillis: 60000, // 1 minute to acquire a connection from pool
    statementTimeout: 600000, // 10 minute query timeout
    queryTimeout: 600000, // 10 minute query timeout
  });
};
