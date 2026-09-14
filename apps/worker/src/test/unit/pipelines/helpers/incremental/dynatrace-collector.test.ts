import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../services/dynatrace/DynatraceAPIClient.js');
vi.mock('../../../../../services/dynatrace/DynatraceRepository.js');
vi.mock('../../../../../services/dynatrace/DataProcessor.js');
vi.mock('../../../../../config/proxy-resolver.js', () => ({
  resolveDynatraceAxiosProxy: vi.fn(async () => undefined),
}));

import { DynatraceAPIClient } from '../../../../../services/dynatrace/DynatraceAPIClient.js';
import { DynatraceRepository } from '../../../../../services/dynatrace/DynatraceRepository.js';
import { DataProcessor } from '../../../../../services/dynatrace/DataProcessor.js';
import {
  DynatraceCollector,
  DYNATRACE_INGEST_LOOKBACK_MS,
} from '../../../../../pipelines/helpers/incremental/dynatrace-collector.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function makeCollector() {
  const db = { query: vi.fn(async () => [{ id: 'q1', dynatrace_config_id: 'cfg', query: 'builtin:host.cpu' }]) };
  const batchProcessor = {
    processDynatraceDocuments: vi.fn(async () => ({ totalRecords: 0, errors: [], maxDataTimestamp: undefined })),
  };
  const metricProcessor = { cleanTimeRangeFromQuery: (q: string) => q, replaceTemplateVariables: (q: string) => q };
  vi.mocked(DynatraceRepository).mockImplementation(() => ({
    getDynatraceConfigById: vi.fn(async () => ({ id: 'cfg', host: 'h', apiToken: 't', label: 'l', dynatraceType: 'saas' })),
  }) as never);
  vi.mocked(DataProcessor).mockImplementation(() => ({ processDynatraceResults: vi.fn(async () => ({ metricsDocuments: [] })) }) as never);
  return new DynatraceCollector(logger, db as never, metricProcessor as never, batchProcessor as never);
}

const executeBatchQueries = vi.fn(async () => []);
const testRun = {
  testRunId: 'run-1', systemUnderTestId: 's', workload: 'w', testEnvironment: 'e',
  startTime: new Date('2026-09-14T15:00:00Z'),
  completed: false,
};

beforeEach(() => {
  executeBatchQueries.mockClear();
  vi.mocked(DynatraceAPIClient).mockImplementation(() => ({ executeBatchQueries, close: vi.fn() }) as never);
});

describe('DynatraceCollector ingest lookback', () => {
  it('queries the API from 2 min before the tick window', async () => {
    const from = new Date('2026-09-14T15:05:00Z');
    const to = new Date('2026-09-14T15:06:00Z');
    await makeCollector().collect('run-1', testRun, undefined, undefined, undefined, from, to);
    const [, qFrom, qTo] = executeBatchQueries.mock.calls[0] as unknown as [unknown, Date, Date];
    expect(qFrom.getTime()).toBe(from.getTime() - DYNATRACE_INGEST_LOOKBACK_MS);
    expect(qTo).toEqual(to);
  });

  it('never looks back past the run start', async () => {
    const from = new Date('2026-09-14T15:00:30Z');
    const to = new Date('2026-09-14T15:01:00Z');
    await makeCollector().collect('run-1', testRun, undefined, undefined, undefined, from, to);
    const [, qFrom] = executeBatchQueries.mock.calls[0] as unknown as [unknown, Date];
    expect(qFrom).toEqual(testRun.startTime);
  });

  it('applies no lookback on a completed run (gap fill decompresses exactly [from, to])', async () => {
    const from = new Date('2026-09-14T15:05:00Z');
    const to = new Date('2026-09-14T15:06:00Z');
    await makeCollector().collect('run-1', { ...testRun, completed: true }, undefined, undefined, undefined, from, to);
    const [, qFrom] = executeBatchQueries.mock.calls[0] as unknown as [unknown, Date];
    expect(qFrom).toEqual(from);
  });

  it('does not clamp when the run has no startTime', async () => {
    const from = new Date('2026-09-14T15:05:00Z');
    const to = new Date('2026-09-14T15:06:00Z');
    const testRunNoStart = { ...testRun, startTime: undefined };
    await makeCollector().collect('run-1', testRunNoStart, undefined, undefined, undefined, from, to);
    const [, qFrom] = executeBatchQueries.mock.calls[0] as unknown as [unknown, Date];
    expect(qFrom.getTime()).toBe(from.getTime() - DYNATRACE_INGEST_LOOKBACK_MS);
  });
});
