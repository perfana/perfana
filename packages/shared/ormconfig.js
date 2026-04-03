const { DataSource } = require('typeorm');
const { config } = require('dotenv');
const { resolve } = require('path');

// Load environment variables from the API's .env file
config({ path: resolve(__dirname, '../../apps/api/.env') });

/**
 * TypeORM Data Source Configuration for CLI Commands
 *
 * This configuration is used by TypeORM CLI tools for:
 * - migration:generate - Generate new migrations
 * - migration:run - Run pending migrations
 * - migration:revert - Revert last migration
 * - migration:show - Show migration status
 *
 * Usage from root:
 * npm run migration:generate -- -n MigrationName
 * npm run migration:run
 * npm run migration:revert
 * npm run migration:show
 */
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'perfana',
  password: process.env.DB_PASSWORD || 'perfana',
  database: process.env.DB_NAME || 'perfana',
  entities: ['dist/entities/**/*.entity.js'],
  migrations: ['dist/database/migrations/**/*.js'],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false, // Never auto-sync in production
  logging: ['error', 'warn', 'migration'],
});

// Initialize and export the data source
AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
    process.exit(1);
  });

module.exports = { AppDataSource };
