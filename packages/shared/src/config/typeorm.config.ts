import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as migrations from '../database';
import { TruncatedQueryLogger } from './typeorm-logger';

export const DEFAULT_SLOW_QUERY_MS = 1000;

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

  /**
   * Reported as `application_name`, so work is attributable in pg_stat_activity and
   * pg_stat_statements instead of showing as `(unset)`. Without it a heavy re-evaluate
   * cannot be told apart from an ordinary API query when diagnosing WAL or lock pressure.
   */
  applicationName?: string;

  // Timeout configurations
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeout?: number;
  queryTimeout?: number;

  /**
   * Queries slower than this are logged as `slow query (Nms)`. Unset, 0 or negative
   * fall back to DEFAULT_SLOW_QUERY_MS: TypeORM treats 0 as "off", and nobody wants off.
   */
  slowQueryMs?: number;
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
    // 'warn' in every environment: that is the level logQuerySlow emits on.
    logger: new TruncatedQueryLogger({
      logging: ['error', 'warn'],
      maxQueryLength: 200,
    }),
    maxQueryExecutionTime: config.slowQueryMs && config.slowQueryMs > 0 ? config.slowQueryMs : DEFAULT_SLOW_QUERY_MS,

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
      ...(config.applicationName ? { application_name: config.applicationName } : {}),
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
      database: config.database || 'perfana',
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
