import { ConfigService } from '@nestjs/config';
import { createDatabaseConfig } from './database.config';

/**
 * `SLOW_QUERY_MS` → `slowQueryMs` → TypeORM `maxQueryExecutionTime`. The env value
 * arrives as a string, so the cast matters: passing it through unconverted would
 * make TypeORM compare a number against a string.
 */
describe('createDatabaseConfig — SLOW_QUERY_MS', () => {
  const configService = (env: Record<string, string>) =>
    ({
      get: (key: string, fallback?: unknown) => (key in env ? env[key] : fallback),
    }) as unknown as ConfigService;

  it('defaults maxQueryExecutionTime to 1000 when SLOW_QUERY_MS is unset', () => {
    const cfg = createDatabaseConfig(configService({})) as { maxQueryExecutionTime?: number };
    expect(cfg.maxQueryExecutionTime).toBe(1000);
  });

  it('converts SLOW_QUERY_MS from its env string to a number', () => {
    const cfg = createDatabaseConfig(configService({ SLOW_QUERY_MS: '2500' })) as {
      maxQueryExecutionTime?: unknown;
    };
    expect(cfg.maxQueryExecutionTime).toBe(2500);
    expect(typeof cfg.maxQueryExecutionTime).toBe('number');
  });

  it.each(['abc', '', '0', '-5'])('falls back to 1000 for SLOW_QUERY_MS=%j instead of silently disabling slow-query logging', (v) => {
    const cfg = createDatabaseConfig(configService({ SLOW_QUERY_MS: v })) as { maxQueryExecutionTime?: number };
    expect(cfg.maxQueryExecutionTime).toBe(1000);
  });
});
