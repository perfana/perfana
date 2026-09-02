import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file if it exists
dotenv.config();

// Note: Cannot use logger here due to circular dependency
// Logger initialization depends on config, config initialization happens here

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database Configuration (matches API and grafana-sync services)
  DB_HOST: z.string({
    required_error: 'DB_HOST is required'
  }),
  DB_PORT: z.coerce.number().default(5432),
  DB_USERNAME: z.string({
    required_error: 'DB_USERNAME is required'
  }),
  DB_PASSWORD: z.string({
    required_error: 'DB_PASSWORD is required'
  }),
  DB_NAME: z.string({
    required_error: 'DB_NAME is required'
  }),
  DB_SSL: z.string().default('false'), // SSL mode: 'false', 'true' (no cert validation), 'require' (cert validation)

  // Grafana API Configuration
  // Grafana credentials come from grafana_instances table in DB, not from env vars
  GRAFANA_CONCURRENCY: z.coerce.number().default(30),
  GRAFANA_BATCH_SIZE: z.coerce.number().default(20),

  // Redis Configuration
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),

  // BullMQ Queue Configuration
  QUEUE_CONCURRENCY: z.coerce.number().default(10),
  QUEUE_RETRY_LIMIT: z.coerce.number().default(3),
  QUEUE_RETRY_DELAY: z.coerce.number().default(30),

  // Worker Concurrency Configuration
  // Reduced from 5 to 2: each analyze job runs heavy CTEs (Statistics, ADAPT)
  // that hold connections for 1-4 minutes. 5 concurrent jobs saturated PostgreSQL.
  // See: 2026-03-26 write starvation post-mortem
  WORKER_ANALYZE_CONCURRENCY: z.coerce.number().default(2),
  WORKER_BATCH_CONCURRENCY: z.coerce.number().default(2),

  // Statement timeout for analytical queries (ms). Heavy CTEs (StatisticsPipeline,
  // ControlGroupStatisticsPipeline, AdaptPipeline) get this timeout via SET LOCAL.
  // Prevents queries from holding connections indefinitely under load.
  ANALYTICS_STATEMENT_TIMEOUT_MS: z.coerce.number().default(120000),

  // Budget for the heavy aggregation transactions (StatisticsPipeline,
  // ControlGroupStatisticsPipeline). Separate from ANALYTICS_STATEMENT_TIMEOUT_MS
  // on purpose: that one is a CAP on runaway reads and must stay lowerable, while
  // these two are the job's own work and a 20M-row run needs more than 120s.
  // Same shape as ROLLUP_STATEMENT_TIMEOUT_MS in TransactionStatsRollupPipeline.
  //
  // Keep the timeout strictly BELOW the analytics pool's client-side query_timeout
  // (600000, config/typeorm.config.ts). At equal deadlines node-postgres destroys
  // the connection instead of letting Postgres cancel the statement, which loses
  // both the clean rollback and the diagnosable error.
  //
  // work_mem is charged per hash/sort node AND per parallel worker, then again per
  // concurrent job (WORKER_ANALYZE_CONCURRENCY + WORKER_BATCH_CONCURRENCY, 2 each),
  // so the deploy-wide peak is roughly this value x (1 + max_parallel_workers_per_gather) x 4.
  AGGREGATION_STATEMENT_TIMEOUT_MS: z.coerce.number().default(540000),
  AGGREGATION_WORK_MEM: z.string().default('128MB'),

  // Performance Tuning
  DB_POOL_SIZE: z.coerce.number().default(30), // Pool for 2 concurrent analyze jobs + headroom (reduced from 100 after write starvation post-mortem)
  METRICS_BATCH_SIZE: z.coerce.number().default(200),
  METRICS_DUAL_WRITE: z.coerce.boolean().default(false), // Enable dual write to both PostgreSQL and MongoDB during migration

  // Encryption key for credential storage (64 hex chars = 32 bytes)
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex string (32 bytes)'),

  // Dynatrace Configuration
  DYNATRACE_HOST: z.string().optional(),
  DYNATRACE_API_TOKEN: z.string().optional(),
  DYNATRACE_PLATFORM_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

export function loadConfig(): Config {
  if (config) {
    return config;
  }

  try {
    config = envSchema.parse(process.env);
    return config;
  } catch (error) {
    // Use console here since logger depends on config
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment configuration:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error('❌ Failed to load configuration:', error);
    }
    process.exit(1);
  }
}

export function getConfig(): Config {
  if (!config) {
    // Auto-load configuration if not already loaded
    loadConfig();
  }
  return config;
}