import { createTypeOrmConfig } from '../typeorm.config';
import { TruncatedQueryLogger } from '../typeorm-logger';

// The migration index pulls in every migration file; none of that matters here.
jest.mock('../../database', () => ({}));

/**
 * Slow-query logging.
 *
 * Two things this pins: `maxQueryExecutionTime` is what makes TypeORM call
 * `logQuerySlow` at all, and the logger has to be listening on 'warn' — that is
 * the level `TruncatedQueryLogger.logQuerySlow` emits on. Before this change the
 * logger was `['error']` outside development, so a production slow query would
 * have been measured and then dropped on the floor.
 */
describe('createTypeOrmConfig — slow query logging', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('defaults maxQueryExecutionTime to 1000 ms', () => {
    const cfg = createTypeOrmConfig({}) as { maxQueryExecutionTime?: number };
    expect(cfg.maxQueryExecutionTime).toBe(1000);
  });

  it('honours slowQueryMs', () => {
    const cfg = createTypeOrmConfig({ slowQueryMs: 5000 }) as { maxQueryExecutionTime?: number };
    expect(cfg.maxQueryExecutionTime).toBe(5000);
  });

  it.each([0, -5, NaN])('falls back to the default for slowQueryMs=%p (TypeORM treats 0 as off)', (slowQueryMs) => {
    const cfg = createTypeOrmConfig({ slowQueryMs }) as { maxQueryExecutionTime?: number };
    expect(cfg.maxQueryExecutionTime).toBe(1000);
  });

  it.each(['production', 'development', 'test', undefined])(
    'logger emits slow queries at warn level when nodeEnv=%s (regression: was error-only outside development)',
    (nodeEnv) => {
      const cfg = createTypeOrmConfig({ nodeEnv }) as { logger?: TruncatedQueryLogger };
      expect(cfg.logger).toBeInstanceOf(TruncatedQueryLogger);

      cfg.logger!.logQuerySlow(1234, 'SELECT 1');

      expect(warn).toHaveBeenCalledWith('slow query (1234ms): SELECT 1');
    },
  );

  it('logger still truncates a long slow query to 200 chars', () => {
    const cfg = createTypeOrmConfig({}) as { logger?: TruncatedQueryLogger };
    const query = 'SELECT '.repeat(100);

    cfg.logger!.logQuerySlow(2000, query);

    const line = warn.mock.calls[0]?.[0] as string;
    expect(line.startsWith('slow query (2000ms): ' + query.substring(0, 200))).toBe(true);
    expect(line).toContain(`[truncated, total ${query.length} chars]`);
  });
});
