/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
import { DataSource } from 'typeorm';
import * as path from 'path';

/**
 * TypeORM DataSource for CLI migrations
 * Run with: npm run migration:run
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'perfana',
  password: process.env.DB_PASSWORD || 'perfana',
  database: process.env.DB_NAME || 'perfana',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false', ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) }
    : false,
  entities: [],
  migrations: [path.resolve(__dirname, '../../../packages/shared/dist/database/migrations/*.js')],
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
});
