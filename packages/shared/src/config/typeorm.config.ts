import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as migrations from '../database';
import { TruncatedQueryLogger } from './typeorm-logger';

/**
 * Configuration options for creating TypeORM connection
 */
export interface DatabaseConfig {
  // Connection options (either url or individual params)
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;

  // SSL configuration
  ssl?: boolean | { rejectUnauthorized: boolean };

  // Connection pool options
  poolSize?: number;
  minConnections?: number;

  // Environment and logging
  nodeEnv?: string;

  // Timeout configurations
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeout?: number;
  queryTimeout?: number;
}

/**
 * Creates a TypeORM configuration object for PostgreSQL
 * This is shared across API and worker applications
 *
 * @param config - Database configuration options
 * @returns TypeOrmModuleOptions for TypeORM initialization
 */
export const createTypeOrmConfig = (config: DatabaseConfig): TypeOrmModuleOptions => {
  // Parse SSL configuration
  let sslConfig: boolean | { rejectUnauthorized: boolean } = false;

  if (config.ssl !== undefined) {
    sslConfig = config.ssl;
  } else if (config.nodeEnv === 'production') {
    // Default to SSL with certificate validation in production
    sslConfig = { rejectUnauthorized: true };
  }

  // Build the base configuration
  const baseConfig: TypeOrmModuleOptions = {
    type: 'postgres',

    // IMPORTANT: Set to false to prevent TypeORM from altering existing database schema
    // Database schema is managed by migrations
    synchronize: false,

    // Custom logger that truncates SQL queries in error output
    // Prevents massive INSERT statements from flooding logs
    logger: new TruncatedQueryLogger({
      logging: config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
      maxQueryLength: 200,
    }),

    // SSL configuration
    ssl: sslConfig,

    // PostgreSQL-specific options
    extra: {
      timezone: 'UTC',
      max: config.poolSize || 50, // Connection pool size
      min: config.minConnections || 20, // Minimum connections (pre-warmed)
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 30000,
      statement_timeout: config.statementTimeout || 300000, // 5 minute query timeout
      query_timeout: config.queryTimeout || 300000,
    },

    // Auto-load entities - works with forFeature() registrations in modules
    autoLoadEntities: true,

    // Migrations configuration - shared across API and worker
    migrations: Object.values(migrations),
    migrationsRun: false, // Don't auto-run migrations on connection
  };

  // Use connection URL if provided, otherwise use individual connection params
  if (config.url) {
    return {
      ...baseConfig,
      url: config.url,
    };
  } else {
    return {
      ...baseConfig,
      host: config.host || 'localhost',
      port: config.port || 5432,
      username: config.username || 'perfana',
      password: config.password || 'perfana_dev_password',
      database: config.database || 'perfana_native',
    };
  }
};

/**
 * Helper function to parse DB_SSL environment variable into SSL configuration
 *
 * @param dbSslValue - Value from DB_SSL environment variable
 * @returns SSL configuration object or false
 */
export const parseSslConfig = (
  dbSslValue?: string
): boolean | { rejectUnauthorized: boolean; ca?: string } => {
  if (!dbSslValue || dbSslValue === 'false') {
    return false;
  }

  if (dbSslValue === 'true' || dbSslValue === 'require') {
    // SSL enabled with certificate validation by default.
    // Provide DB_SSL_CA with a PEM-encoded CA certificate for custom CAs.
    // Set DB_SSL_REJECT_UNAUTHORIZED=false only for self-signed certs in development.
    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
    const ca = process.env.DB_SSL_CA;
    return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
  }

  return false;
};
