import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  // Grafana Sync
  GRAFANA_SYNC_INTERVAL: Joi.number().min(1000).default(30000),
  GRAFANA_MAX_SERIES: Joi.number().min(1).default(2),
  GRAFANA_PROPAGATE_TEMPLATE_UPDATES: Joi.boolean().default(false),
  GRAFANA_PROMETHEUS_QUERY_RANGE_DAYS: Joi.number().min(1).default(1),

  // Grafana DB Access
  GRAFANA_USE_DB_DIRECT_ACCESS: Joi.boolean().default(false),

  // When direct access enabled, require credentials
  GRAFANA_MYSQL_HOST: Joi.string().when('GRAFANA_USE_DB_DIRECT_ACCESS', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Sanity Checkers
  TESTRUN_SANITY_CHECKER_ENABLED: Joi.boolean().default(false),
  TESTRUN_SANITY_CHECKER_DELAY_MINUTES: Joi.number().min(1).default(10),
  TESTRUN_SANITY_CHECKER_INTERVAL: Joi.number().min(10000).default(300000),
  SANITY_CHECKER_ENABLED: Joi.boolean().default(false),
  SANITY_CHECKER_INTERVAL: Joi.number().min(10000).default(3600000),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'log', 'info', 'debug', 'verbose').default('info'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Encryption (required for reading encrypted Grafana credentials)
  ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required()
    .description('64-character hex string for encrypting/decrypting sensitive data'),

  // Auto-configuration
  AUTO_CONFIG_ENABLED: Joi.boolean().default(true),

  // Application
  PORT: Joi.number().default(3002),
});
