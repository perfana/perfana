/**
 * Slow-query threshold per worker pool.
 *
 * Both pools run statements that routinely take seconds (analytics aggregations on the
 * main pool, ds_metrics upsert batches on the write pool), so both carry 5 s rather than
 * the shared 1 s default the API uses. Both go through
 * `@perfana/shared`'s `createTypeOrmConfig`, which is mocked here to capture what each
 * factory hands it — the mapping to TypeORM's `maxQueryExecutionTime` is pinned in
 * packages/shared/src/config/__tests__/typeorm.config.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';

const captured: Record<string, unknown>[] = [];

vi.mock('@perfana/shared/config', () => ({
  createTypeOrmConfig: vi.fn((cfg: Record<string, unknown>) => {
    captured.push(cfg);
    return { type: 'postgres', captured: cfg };
  }),
  parseSslConfig: vi.fn(() => false),
}));

vi.mock('../../../config/environment.js', () => ({
  getConfig: () => ({
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_USERNAME: 'u',
    DB_PASSWORD: 'p',
    DB_NAME: 'd',
    DB_SSL: 'false',
    NODE_ENV: 'test',
  }),
}));

import { createTypeOrmConfig, createWriteTypeOrmConfig } from '../../../config/typeorm.config.js';

describe('worker typeorm config — slowQueryMs', () => {
  it('main pool logs queries slower than 5 s', () => {
    captured.length = 0;
    createTypeOrmConfig();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ applicationName: 'perfana-worker', slowQueryMs: 5000 });
  });

  it('write pool logs queries slower than 5 s too', () => {
    captured.length = 0;
    createWriteTypeOrmConfig();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ applicationName: 'perfana-worker-write', slowQueryMs: 5000 });
  });
});
