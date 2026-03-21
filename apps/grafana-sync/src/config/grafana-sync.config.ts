import { registerAs } from '@nestjs/config';

export default registerAs('grafanaSync', () => ({
  // Sync settings
  syncInterval: parseInt(process.env.GRAFANA_SYNC_INTERVAL, 10) || 30000,
  maxSeries: parseInt(process.env.GRAFANA_MAX_SERIES, 10) || 2,
  propagateTemplateUpdates: process.env.GRAFANA_PROPAGATE_TEMPLATE_UPDATES === 'true',
  prometheusQueryRangeDays: parseInt(process.env.GRAFANA_PROMETHEUS_QUERY_RANGE_DAYS, 10) || 1,

  // Grafana database access
  grafanaDb: {
    useDirectAccess: process.env.GRAFANA_USE_DB_DIRECT_ACCESS === 'true',

    mysql: {
      host: process.env.GRAFANA_MYSQL_HOST,
      user: process.env.GRAFANA_MYSQL_USER,
      password: process.env.GRAFANA_MYSQL_PASSWORD,
      database: process.env.GRAFANA_MYSQL_DATABASE || 'grafana',
    },

    postgres: {
      host: process.env.GRAFANA_PG_HOST,
      port: parseInt(process.env.GRAFANA_PG_PORT, 10) || 5432,
      user: process.env.GRAFANA_PG_USER,
      password: process.env.GRAFANA_PG_PASSWORD,
      database: process.env.GRAFANA_PG_DATABASE || 'grafana',
      schema: process.env.GRAFANA_PG_SCHEMA || 'public',
      ssl: process.env.GRAFANA_PG_SSL === 'true',
    },
  },

  // Sanity checker settings
  sanityChecker: {
    testRun: {
      enabled: process.env.TESTRUN_SANITY_CHECKER_ENABLED === 'true',
      delayMinutes: parseInt(process.env.TESTRUN_SANITY_CHECKER_DELAY_MINUTES, 10) || 10,
      interval: parseInt(process.env.TESTRUN_SANITY_CHECKER_INTERVAL, 10) || 300000,
    },
    general: {
      enabled: process.env.SANITY_CHECKER_ENABLED === 'true',
      interval: parseInt(process.env.SANITY_CHECKER_INTERVAL, 10) || 3600000,
    },
  },

  // Application settings
  port: parseInt(process.env.PORT, 10) || 3002,
}));
