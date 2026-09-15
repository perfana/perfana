/**
 * ADAPT_MIN_SAMPLE_COUNT is read twice: `adaptMinSampleCount()` in the SQL fragments
 * (lenient — falls back to 2 so a unit test needs no config) and the zod entry in
 * config/environment.ts (strict — a bad value must refuse to boot rather than silently
 * run on the fallback). This pins the strict half; the lenient one is covered in
 * pipelines/adapt-min-sample-count.test.ts.
 *
 * `loadConfig()` caches at module level and calls process.exit(1) on a ZodError, so each
 * case re-imports the module and stubs exit.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// environment.ts calls dotenv.config() at module level; every re-import below would
// otherwise re-read apps/worker/.env and put back keys this file just deleted.
vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));

const REQUIRED = {
  // setup.ts sets LOG_LEVEL=silent, which the enum refuses; the rest are the schema's
  // only required fields.
  LOG_LEVEL: 'info',
  DB_HOST: 'localhost',
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  ENCRYPTION_KEY: 'a'.repeat(64),
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...Object.keys(REQUIRED), 'ADAPT_MIN_SAMPLE_COUNT']) saved[k] = process.env[k];
  Object.assign(process.env, REQUIRED);
  delete process.env.ADAPT_MIN_SAMPLE_COUNT;
  vi.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

async function load() {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // src/test/setup.ts mocks this module for every unit test; go around the mock.
  const mod = await vi.importActual<typeof import('../../../config/environment.js')>(
    '../../../config/environment.js',
  );
  return { exit, config: () => mod.loadConfig() };
}

describe('ADAPT_MIN_SAMPLE_COUNT at boot', () => {
  test('defaults to 2 when unset', async () => {
    const { config } = await load();
    expect(config().ADAPT_MIN_SAMPLE_COUNT).toBe(2);
  });

  test('parses a positive integer', async () => {
    process.env.ADAPT_MIN_SAMPLE_COUNT = '5';
    const { config } = await load();
    expect(config().ADAPT_MIN_SAMPLE_COUNT).toBe(5);
  });

  test('accepts 1 (the scenario-panel opt-out value)', async () => {
    process.env.ADAPT_MIN_SAMPLE_COUNT = '1';
    const { config } = await load();
    expect(config().ADAPT_MIN_SAMPLE_COUNT).toBe(1);
  });

  test.each([['0'], ['-1'], ['2.5'], ['abc']])(
    'refuses to boot on %j instead of running on the fallback',
    async (raw) => {
      process.env.ADAPT_MIN_SAMPLE_COUNT = raw;
      const { exit, config } = await load();
      expect(() => config()).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
    },
  );
});
