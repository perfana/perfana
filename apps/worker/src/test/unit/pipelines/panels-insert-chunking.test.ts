/**
 * `PanelsPipeline.insertPanelDocuments` chunks against the Postgres bind-parameter cap.
 *
 * The insert binds `rows x 19` parameters and Postgres refuses a statement carrying more
 * than 65535, so a single statement covering every panel document fails outright past
 * 3449 panels — a whole analyze stage lost on a large run, not a slow one. Panels scale
 * with dashboards per run, so that ceiling is reachable.
 * (worker pipeline review 2026-09-14, COL-P7.)
 *
 * These tests drive the private method directly. That is deliberate: the ceiling is a
 * property of the SQL this method builds, and reaching it through `execute()` would mean
 * standing up thousands of fake Grafana panels to assert something about parameter
 * arithmetic.
 */

import { describe, test, expect, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { PanelsPipeline } from '../../../pipelines/PanelsPipeline.js';
import { PG_MAX_BIND_PARAMS } from '../../../utils/bind-params.js';

const PANEL_COLUMN_COUNT = 19;
const CEILING = Math.floor(PG_MAX_BIND_PARAMS / PANEL_COLUMN_COUNT); // 3449

const makePanelDoc = (panelId: number) => ({
  test_run_id: 'test-run-123',
  application_dashboard_id: 'app-dash-uuid',
  metrics_source_id: 'ms-uuid-456',
  dashboard_uid: 'dash-uid',
  panel_id: panelId,
  panel_title: `Panel ${panelId}`,
  dashboard_label: 'Label',
  panel: {},
  query_variables: {},
  datasource_type: 'prometheus',
  benchmark_ids: [],
  requests: [],
  errors: null,
  warnings: null,
});

/** Captures every statement the method issues, with its parameter array. */
const captureInserts = () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: vi.fn((sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as EntityManager;
  return { calls, manager };
};

const insert = async (manager: EntityManager, docs: unknown[]) => {
  const pipeline = Object.create(PanelsPipeline.prototype) as PanelsPipeline;
  await (pipeline as unknown as {
    insertPanelDocuments: (m: EntityManager, d: unknown[], t: unknown) => Promise<void>;
  }).insertPanelDocuments(manager, docs, { organizationId: 'org-1', teamId: null });
};

describe('PanelsPipeline.insertPanelDocuments chunking', () => {
  test('never exceeds the bind-parameter cap, even well past the ceiling', async () => {
    // 4000 > 3449, so the pre-fix single statement would have bound 76,000 parameters.
    const { calls, manager } = captureInserts();
    await insert(manager, Array.from({ length: 4000 }, (_, i) => makePanelDoc(i)));

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.params.length).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
    }
  });

  test('writes every document exactly once across the chunks', async () => {
    // Chunking that loses or duplicates a row is worse than the bug it replaces.
    const total = 4000;
    const { calls, manager } = captureInserts();
    await insert(manager, Array.from({ length: total }, (_, i) => makePanelDoc(i)));

    const rowsWritten = calls.reduce((n, c) => n + c.params.length / PANEL_COLUMN_COUNT, 0);
    expect(rowsWritten).toBe(total);

    // panel_id is the 5th column, so it appears at offset 4 of each row's slice.
    const seen: number[] = [];
    for (const call of calls) {
      for (let off = 0; off < call.params.length; off += PANEL_COLUMN_COUNT) {
        seen.push(call.params[off + 4] as number);
      }
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  test('parameter placeholders restart at $1 in every chunk', async () => {
    // Each chunk is its own statement, so numbering must not continue from the last.
    const { calls, manager } = captureInserts();
    await insert(manager, Array.from({ length: 4000 }, (_, i) => makePanelDoc(i)));

    for (const call of calls) {
      expect(call.sql).toContain('($1, $2,');
      const highest = Math.max(
        ...[...call.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
      );
      expect(highest).toBe(call.params.length);
    }
  });

  test('a load that fits stays a single statement', async () => {
    // The common case must not pay for the fix.
    const { calls, manager } = captureInserts();
    await insert(manager, Array.from({ length: 50 }, (_, i) => makePanelDoc(i)));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toHaveLength(50 * PANEL_COLUMN_COUNT);
  });

  test('issues nothing at all for an empty document list', async () => {
    const { calls, manager } = captureInserts();
    await insert(manager, []);
    expect(calls).toHaveLength(0);
  });

  test('still carries metrics_source_id, which the deleted Dynatrace test used to cover', async () => {
    // This assertion previously lived in DynatracePipeline.test.ts against a dead private
    // method (COL-P8). The live ds_panels insert is here, so the coverage moves here too.
    const { calls, manager } = captureInserts();
    await insert(manager, [makePanelDoc(1)]);

    expect(calls[0]!.sql).toContain('ds_panels');
    expect(calls[0]!.sql).toContain('metrics_source_id');
    expect(calls[0]!.params[2]).toBe('ms-uuid-456');
  });

  test('the ceiling this guards is the one the column list implies', () => {
    // Pins the arithmetic to the real column count: if ds_panels gains a column and
    // nobody updates PANEL_COLUMNS, the chunk size must fall, not stay put.
    expect(CEILING).toBe(3449);
    expect((CEILING + 1) * PANEL_COLUMN_COUNT).toBeGreaterThan(PG_MAX_BIND_PARAMS);
  });
});
