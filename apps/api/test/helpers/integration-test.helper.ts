import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';

// Import all entity classes from the test entities barrel
import * as testEntities from '../../src/test/test-entities';

/**
 * Integration Test Helper
 *
 * Provides utilities for integration testing with real database operations
 */

export interface IntegrationTestContext {
  app: INestApplication;
  module: TestingModule;
  dataSource: DataSource;
  request: ReturnType<typeof request>;
}

/**
 * Creates a test application with database connection
 */
export async function createTestApp(
  imports: any[],
  controllers: any[],
  providers: any[],
): Promise<IntegrationTestContext> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['.env.test', '.env.local', '.env'],
      }),
      TypeOrmModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          // Get all entity classes as an array from the test entities barrel
          const entityClasses = Object.values(testEntities).filter(
            (value) => typeof value === 'function' && value.prototype,
          );

          // Use testcontainer connection if available (set by setup-database.ts),
          // otherwise fall back to regular environment variables
          const host = configService.get('TEST_DB_HOST') || configService.get('DB_HOST', 'localhost');
          const port = configService.get('TEST_DB_PORT') || configService.get('DB_PORT', 5432);
          const username = configService.get('TEST_DB_USERNAME') || configService.get('DB_USERNAME', 'perfana');
          const password = configService.get('TEST_DB_PASSWORD') || configService.get('DB_PASSWORD', 'perfana');
          const database = configService.get('TEST_DB_NAME') || configService.get('DB_NAME', 'perfana_test');

          return {
            type: 'postgres',
            host,
            port: typeof port === 'string' ? parseInt(port, 10) : port,
            username,
            password,
            database,
            entities: entityClasses as any[],
            synchronize: false, // Don't sync in tests, use existing schema from setup-database.ts
            logging: false,
          };
        },
      }),
      ...imports,
    ],
    controllers,
    providers,
  }).compile();

  const app = module.createNestApplication();

  // Apply global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.init();

  const dataSource = module.get<DataSource>(DataSource);

  return {
    app,
    module,
    dataSource,
    request: request(app.getHttpServer()),
  };
}

/**
 * Cleans up test application
 */
export async function closeTestApp(context: IntegrationTestContext): Promise<void> {
  if (context.dataSource?.isInitialized) {
    await context.dataSource.destroy();
  }
  if (context.app) {
    await context.app.close();
  }
}

/**
 * Wraps a test in a database transaction that rolls back after execution
 */
export async function withTransaction<T>(
  dataSource: DataSource,
  callback: (queryRunner: any) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const result = await callback(queryRunner);
    await queryRunner.rollbackTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Mock Keycloak JWT token for authentication
 */
export function mockKeycloakToken(roles: string[] = []): string {
  // Simple base64 encoded mock token
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'test-user-id',
      email: 'test@example.com',
      preferred_username: 'testuser',
      realm_access: { roles },
      resource_access: {
        perfana: { roles },
      },
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    }),
  ).toString('base64');
  const signature = Buffer.from('mock-signature').toString('base64');

  return `${header}.${payload}.${signature}`;
}

/**
 * Mock API key token
 */
export function mockApiKeyToken(description: string, id: string): string {
  return Buffer.from(`${description}#${id}`).toString('base64');
}

/**
 * Get authorization headers with Keycloak JWT
 */
export function getAuthHeaders(roles: string[] = []): Record<string, string> {
  return {
    Authorization: `Bearer ${mockKeycloakToken(roles)}`,
  };
}

/**
 * Get authorization headers with API key
 */
export function getApiKeyHeaders(description: string, id: string): Record<string, string> {
  return {
    Authorization: `Bearer ${mockApiKeyToken(description, id)}`,
  };
}

/**
 * Creates a test database query runner for manual queries
 */
export async function createQueryRunner(dataSource: DataSource) {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  return queryRunner;
}

/**
 * Cleans up all test data from specified tables
 */
export async function cleanupTestData(
  dataSource: DataSource,
  tables: string[],
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.startTransaction();

    // Disable foreign key checks temporarily
    await queryRunner.query('SET session_replication_role = replica;');

    for (const table of tables) {
      // Check if table exists before trying to delete from it
      const tableExists = await queryRunner.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )`, [table]);

      if (tableExists[0]?.exists) {
        await queryRunner.query(`DELETE FROM "${table}" WHERE created_at > NOW() - INTERVAL '1 hour'`);
      }
    }

    // Re-enable foreign key checks
    await queryRunner.query('SET session_replication_role = DEFAULT;');

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.warn(`Warning: cleanupTestData failed for tables ${tables.join(', ')}: ${error instanceof Error ? error.message : String(error)}`);
    // Don't throw - allow tests to continue
  } finally {
    await queryRunner.release();
  }
}

/**
 * Wait for async operations to complete
 */
export async function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a unique test run ID
 */
export function generateTestRunId(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generates a UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
