import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

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
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'perfana',
  password: process.env.DB_PASSWORD || 'perfana',
  database: process.env.DB_NAME || 'perfana',
  entities: ['src/entities/**/*.entity.ts'],
  migrations: ['src/database/migrations/**/*.ts'],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false, // Never auto-sync in production
  logging: ['error', 'warn', 'migration'],
});

// Initialize the data source (required for CLI)
AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
