#!/usr/bin/env ts-node
/**
 * Database Setup Script for Tests
 *
 * This script runs BEFORE the test suite using ts-node for proper TypeScript compilation.
 * It initializes the test database schema once, making tests fast and efficient.
 *
 * Supports two modes:
 * 1. Testcontainers (default): Spins up isolated PostgreSQL container
 * 2. Existing database: Uses environment variables for connection
 *
 * Run via: ts-node -r tsconfig-paths/register src/test/setup-database.ts
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { startTestContainers, stopTestContainers, getPostgresConnectionInfo } from './testcontainers-helper';

// Import all entities from the test entities barrel
import * as allEntities from './test-entities';

// Load environment variables
config({ path: '.env.test' });
config({ path: '.env.local' });
config({ path: '.env' });

// Set test environment
process.env.NODE_ENV = 'test';

async function setupTestDatabase(): Promise<void> {
  console.log('\n🔧 Setting up test database...');

  // Get all entity classes as an array
  const entityClasses = Object.values(allEntities).filter(
    (value) => typeof value === 'function' && value.prototype
  );

  console.log(`  Found ${entityClasses.length} total entities`);

  // Use testcontainers by default, unless USE_TESTCONTAINERS=false
  const useTestcontainers = process.env.USE_TESTCONTAINERS !== 'false';

  if (useTestcontainers) {
    console.log('  Using testcontainers for isolated database...');

    try {
      // Start containers and get initialized dataSource
      const context = await startTestContainers();

      // Store connection info in environment for tests to use
      const pgInfo = getPostgresConnectionInfo(context.postgresContainer);
      process.env.TEST_DB_HOST = pgInfo.host;
      process.env.TEST_DB_PORT = String(pgInfo.port);
      process.env.TEST_DB_USERNAME = pgInfo.username;
      process.env.TEST_DB_PASSWORD = pgInfo.password;
      process.env.TEST_DB_NAME = pgInfo.database;

      // Write connection info to file for Jest workers to read
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, '../../.test-db-config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        host: pgInfo.host,
        port: pgInfo.port,
        username: pgInfo.username,
        password: pgInfo.password,
        database: pgInfo.database,
      }, null, 2));

      console.log('  ✓ Database setup complete\n');

      // Note: We don't stop containers here - they will be reused across test runs
      // and automatically cleaned up when the process exits

      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to set up testcontainers:', error);
      process.exit(1);
    }
  } else {
    console.log('  Using existing database from environment variables...');

    const dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'perfana',
      password: process.env.DB_PASSWORD || 'perfana',
      database: process.env.DB_NAME || 'perfana_test',
      entities: entityClasses as any[],
      synchronize: true, // Auto-create schema from entities for tests
      dropSchema: true, // Drop existing schema first for clean state
      logging: false,
    });

    try {
      // Initialize the data source (this will auto-create tables)
      await dataSource.initialize();
      console.log('  ✓ Connected to database');
      console.log('  ✓ Database schema synchronized from entities');

      // Close the connection
      await dataSource.destroy();
      console.log('  ✓ Database setup complete\n');

      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to set up test database:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  setupTestDatabase();
}

export default setupTestDatabase;
