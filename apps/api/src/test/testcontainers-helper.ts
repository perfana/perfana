/**
 * Testcontainers Helper
 *
 * Provides isolated PostgreSQL and Redis containers for testing.
 * Each test suite gets its own containers, ensuring complete isolation.
 *
 * Benefits:
 * - No shared state between tests
 * - Works identically locally and in CI/CD
 * - No manual database setup required
 * - Automatic cleanup after tests
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { DataSource } from 'typeorm';
import * as testEntities from './test-entities';

export interface TestContainersContext {
  postgresContainer: StartedPostgreSqlContainer;
  redisContainer: StartedTestContainer;
  dataSource: DataSource;
}

/**
 * Starts PostgreSQL and Redis containers and initializes the database
 */
export async function startTestContainers(): Promise<TestContainersContext> {
  console.log('🚀 Starting testcontainers...');

  // Start PostgreSQL container
  const postgresContainer = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('testdb')
    .withUsername('testuser')
    .withPassword('testpass')
    .withReuse() // Reuse container across multiple test runs for speed
    .start();

  console.log('  ✓ PostgreSQL container started');

  // Start Redis container
  const redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withReuse()
    .start();

  console.log('  ✓ Redis container started');

  // Get all entity classes
  const entityClasses = Object.values(testEntities).filter(
    (value) => typeof value === 'function' && value.prototype,
  ) as any[];

  // Create DataSource with container connection details
  const dataSource = new DataSource({
    type: 'postgres',
    host: postgresContainer.getHost(),
    port: postgresContainer.getPort(),
    username: postgresContainer.getUsername(),
    password: postgresContainer.getPassword(),
    database: postgresContainer.getDatabase(),
    entities: entityClasses,
    synchronize: true, // Auto-create schema
    dropSchema: true, // Clean slate for each test run
    logging: false,
  });

  await dataSource.initialize();
  console.log('  ✓ Database schema initialized');
  console.log(`  ✓ PostgreSQL: ${postgresContainer.getHost()}:${postgresContainer.getPort()}`);
  console.log(`  ✓ Redis: ${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  return {
    postgresContainer,
    redisContainer,
    dataSource,
  };
}

/**
 * Stops containers and cleans up resources
 */
export async function stopTestContainers(context: TestContainersContext): Promise<void> {
  console.log('🛑 Stopping testcontainers...');

  if (context.dataSource?.isInitialized) {
    await context.dataSource.destroy();
    console.log('  ✓ Database connection closed');
  }

  // Containers are stopped automatically by testcontainers
  // But we can explicitly stop them if needed
  await context.postgresContainer.stop();
  await context.redisContainer.stop();

  console.log('  ✓ Containers stopped');
}

/**
 * Get connection info for a running PostgreSQL container
 */
export function getPostgresConnectionInfo(container: StartedPostgreSqlContainer) {
  return {
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    connectionUri: container.getConnectionUri(),
  };
}

/**
 * Get connection info for a running Redis container
 */
export function getRedisConnectionInfo(container: StartedTestContainer) {
  return {
    host: container.getHost(),
    port: container.getMappedPort(6379),
  };
}
