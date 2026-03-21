/**
 * Test utilities and mock helpers
 */

import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * Create a mock TypeORM repository with common methods
 */
export function createMockRepository<T = any>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {} as any,
    metadata: {} as any,
    target: {} as any,
    query: jest.fn(),
  } as any;
}

/**
 * Create a mock NestJS Logger
 */
export function createMockLogger(): jest.Mocked<Logger> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
    setLogLevels: jest.fn(),
    localInstance: {} as any,
  } as any;
}

/**
 * Create a mock ConfigService
 */
export function createMockConfigService(config: Record<string, any> = {}): any {
  return {
    get: jest.fn((key: string, defaultValue?: any) => {
      const value = key.split('.').reduce((obj, k) => obj?.[k], config);
      return value !== undefined ? value : defaultValue;
    }),
    getOrThrow: jest.fn((key: string) => {
      const value = key.split('.').reduce((obj, k) => obj?.[k], config);
      if (value === undefined) {
        throw new Error(`Configuration key "${key}" not found`);
      }
      return value;
    }),
  };
}

/**
 * Create a mock GrafanaClient
 */
export function createMockGrafanaClient(): any {
  return {
    request: jest.fn(),
    getDashboard: jest.fn(),
    listDashboards: jest.fn(),
    saveDashboard: jest.fn(),
    deleteDashboard: jest.fn(),
    searchDashboards: jest.fn(),
  };
}

/**
 * Create a mock GrafanaInstance entity
 */
export function createMockGrafanaInstance(overrides: Partial<any> = {}): any {
  return {
    id: 'test-instance-id',
    label: 'Test Grafana Instance',
    client_url: 'http://localhost:3000',
    apiKey: 'test-api-key',
    orgId: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock TestRun entity
 */
export function createMockTestRun(overrides: Partial<any> = {}): any {
  return {
    id: 'test-run-id',
    test_run_id: 'test-123',
    testRunName: 'test-run',
    startTime: new Date(),
    endTime: null,
    status: { evaluatingAdapt: 'RUNNING' },
    rampupTime: 60,
    constantLoadTime: 300,
    duration: 360,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock QueryBuilder
 */
export function createMockQueryBuilder(): any {
  const queryBuilder: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getOne: jest.fn(),
    getCount: jest.fn(),
    getRawMany: jest.fn(),
    getRawOne: jest.fn(),
    execute: jest.fn(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
  };

  return queryBuilder;
}

/**
 * Wait for async operations to complete
 */
export async function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Create a mock date for consistent testing
 */
export function createMockDate(isoString = '2024-01-01T00:00:00.000Z'): Date {
  return new Date(isoString);
}

/**
 * Mock setTimeout/setInterval for testing scheduled jobs
 */
export function useFakeTimers(): void {
  jest.useFakeTimers();
}

/**
 * Restore real timers
 */
export function useRealTimers(): void {
  jest.useRealTimers();
}

/**
 * Advance timers by specified milliseconds
 */
export function advanceTimersByTime(ms: number): void {
  jest.advanceTimersByTime(ms);
}

/**
 * Run all pending timers
 */
export function runAllTimers(): void {
  jest.runAllTimers();
}
