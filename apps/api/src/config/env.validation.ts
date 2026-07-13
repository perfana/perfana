import * as Joi from 'joi';

/**
 * Environment variable validation schema using Joi
 * This ensures all required configuration is present and valid before app startup
 */
const envValidationSchema = Joi.object({
  // Application Configuration
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Application environment'),
  PORT: Joi.number()
    .port()
    .default(3001)
    .description('Server port'),

  // Database Configuration
  DB_HOST: Joi.string()
    .required()
    .description('PostgreSQL database host'),
  DB_PORT: Joi.number()
    .port()
    .default(5432)
    .description('PostgreSQL database port'),
  DB_USERNAME: Joi.string()
    .required()
    .description('PostgreSQL database username'),
  DB_PASSWORD: Joi.string()
    .required()
    .min(1)
    .description('PostgreSQL database password'),
  DB_NAME: Joi.string()
    .required()
    .description('PostgreSQL database name'),
  DB_SSL: Joi.string()
    .valid('true', 'false', 'require')
    .default('false')
    .description('PostgreSQL SSL mode'),
  DB_ENABLE_RLS_ROLE: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable RLS role enforcement via perfana_app role in middleware queryRunner'),

  // Keycloak Configuration
  KEYCLOAK_URL: Joi.string()
    .uri()
    .required()
    .description('Keycloak server URL'),
  KEYCLOAK_REALM: Joi.string()
    .required()
    .description('Keycloak realm name'),
  KEYCLOAK_CLIENT_ID: Joi.string()
    .required()
    .description('Keycloak client ID'),
  KEYCLOAK_CLIENT_SECRET: Joi.string()
    .allow('')
    .description('Keycloak client secret (optional for public clients)'),
  KEYCLOAK_POLICY_ENFORCEMENT: Joi.string()
    .valid('ENFORCING', 'PERMISSIVE', 'DISABLED')
    .default('PERMISSIVE')
    .description('Keycloak policy enforcement mode'),
  KEYCLOAK_TOKEN_VALIDATION: Joi.string()
    .valid('ONLINE', 'OFFLINE', 'NONE')
    .default('ONLINE')
    .description('Keycloak token validation method'),

  // Redis Configuration (for BullMQ and realtime features)
  REDIS_HOST: Joi.string()
    .default('127.0.0.1')
    .description('Redis server host'),
  REDIS_PORT: Joi.number()
    .port()
    .default(6379)
    .description('Redis server port'),
  REDIS_PASSWORD: Joi.string()
    .allow('')
    .default('')
    .description('Redis password (optional)'),

  // API Key Cache Configuration
  API_KEY_CACHE_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description('Enable API key caching with Redis'),
  API_KEY_CACHE_TTL_SECONDS: Joi.number()
    .positive()
    .default(600)
    .description('API key cache TTL in seconds (default: 600 = 10 minutes)'),

  // Optional CORS Configuration
  CORS_ALLOWED_ORIGINS: Joi.string()
    .default('http://localhost:4001')
    .description('Comma-separated list of allowed CORS origins'),
  FRONTEND_URL: Joi.string()
    .default('http://localhost:4001')
    .description('Frontend URL for CORS fallback and Socket.IO'),

  // Optional Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info')
    .description('Application log level'),

  // Provisioning Configuration
  PROVISIONING_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description('Enable YAML-based provisioning on startup'),
  PROVISIONING_DIR: Joi.string()
    .default('/data/provisioning')
    .description('Path to directory containing provisioning YAML files'),

  // Log Viewer Configuration
  LOG_VIEWER_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable log viewer feature for admin access to Docker logs'),
  LOG_VIEWER_COMPOSE_PROJECT: Joi.string()
    .default('perfana')
    .description('Docker Compose project name for log viewer'),
  SUT_TRANSFER_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable admin SUT export/import feature (exports production data to a file)'),

  // Health Check Configuration
  HEALTH_HEAP_THRESHOLD_MB: Joi.number()
    .positive()
    .default(1500)
    .description('Health check heap memory threshold in MB'),
  HEALTH_RSS_THRESHOLD_MB: Joi.number()
    .positive()
    .default(3000)
    .description('Health check RSS memory threshold in MB'),
});

/**
 * Validation options for ConfigModule
 */
export const envValidationOptions = {
  validationSchema: envValidationSchema,
  validationOptions: {
    // Allow unknown environment variables (system env vars)
    allowUnknown: true,
    // Stop immediately on first error
    abortEarly: false,
  },
};
