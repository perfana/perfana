import { DataSource } from 'typeorm';
import { gzipSync } from 'zlib';
import { createTestApp, closeTestApp, IntegrationTestContext } from '../../../test/helpers/integration-test.helper';
import { SutExportService } from './sut-export.service';
import { SutImportService } from './sut-import.service';

describe('SutImportService (integration)', () => {
  let ctx: IntegrationTestContext;
  let dataSource: DataSource;
  let exportService: SutExportService;
  let importService: SutImportService;
  const sutId = '44444444-4444-4444-4444-444444444444';
  const runUuid = '55555555-5555-5555-5555-555555555555';
  const runKey = 'roundtrip-run-1';
  const srcOrg = '66666666-6666-6666-6666-666666666666';
  const targetOrg = '77777777-7777-7777-7777-777777777777';
  const grafanaInstanceId = '88888888-8888-8888-8888-888888888888';
  const grafanaDashboardId = '99999999-9999-9999-9999-999999999999';
  const appDashboardId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const streamToBuffer = (s: NodeJS.ReadableStream): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      s.on('data', (c) => chunks.push(Buffer.from(c)));
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });

  beforeAll(async () => {
    ctx = await createTestApp([], [], [SutExportService, SutImportService]);
    dataSource = ctx.dataSource;
    exportService = ctx.module.get(SutExportService);
    importService = ctx.module.get(SutImportService);
    await dataSource.query(`INSERT INTO systems_under_test (id, name, description, organization_id) VALUES ($1,'roundtrip-sut','roundtrip-sut description',$2)`, [sutId, srcOrg]);
    await dataSource.query(`INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload, organization_id) VALUES ($1,$2,$3,'test','wl-1',$4)`, [runUuid, runKey, sutId, srcOrg]);
    await dataSource.query(
      `INSERT INTO grafana_instances (id, label, client_url, org_id, organization_id) VALUES ($1,'roundtrip-grafana','https://grafana.example.com','1',$2)`,
      [grafanaInstanceId, srcOrg],
    );
    await dataSource.query(
      `INSERT INTO grafana_dashboards (id, grafana_instance_id, grafana_id, uid, name, panels, organization_id) VALUES ($1,$2,1,'roundtrip-uid','roundtrip-dashboard','{}'::jsonb,$3)`,
      [grafanaDashboardId, grafanaInstanceId, srcOrg],
    );
    await dataSource.query(
      `INSERT INTO application_dashboards (id, system_under_test_id, test_environment, grafana_instance_id, grafana_dashboard_id, dashboard_name, dashboard_label, organization_id)
       VALUES ($1,$2,'test',$3,$4,'roundtrip-app-dashboard','roundtrip-label',$5)`,
      [appDashboardId, sutId, grafanaInstanceId, grafanaDashboardId, srcOrg],
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM application_dashboards WHERE id = $1`, [appDashboardId]);
    await dataSource.query(`DELETE FROM grafana_dashboards WHERE id = $1`, [grafanaDashboardId]);
    await dataSource.query(`DELETE FROM grafana_instances WHERE id = $1`, [grafanaInstanceId]);
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
    await closeTestApp(ctx);
  });

  it('round-trips a SUT and remaps organization_id to the target org', async () => {
    const stream = await exportService.export(sutId, { testRunIds: [runUuid], includeOptional: true, includeRaw: false });
    const bundle = await streamToBuffer(stream);

    // Simulate a clean dev DB: delete the source rows, then import.
    await dataSource.query(`DELETE FROM application_dashboards WHERE id = $1`, [appDashboardId]);
    await dataSource.query(`DELETE FROM grafana_dashboards WHERE id = $1`, [grafanaDashboardId]);
    await dataSource.query(`DELETE FROM grafana_instances WHERE id = $1`, [grafanaInstanceId]);
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);

    const summary = await importService.import(bundle, targetOrg);
    expect(summary.sutId).toBe(sutId);
    expect(summary.rowCounts['test_runs']).toBe(1);

    const sut = await dataSource.query(`SELECT organization_id FROM systems_under_test WHERE id = $1`, [sutId]);
    expect(sut[0].organization_id).toBe(targetOrg); // remapped, not srcOrg
    const run = await dataSource.query(`SELECT test_run_id, organization_id FROM test_runs WHERE id = $1`, [runUuid]);
    expect(run[0].test_run_id).toBe(runKey); // key preserved
    expect(run[0].organization_id).toBe(targetOrg);

    const appDash = await dataSource.query(
      `SELECT id, organization_id FROM application_dashboards WHERE id = $1`,
      [appDashboardId],
    );
    expect(appDash).toHaveLength(1); // proves the corrected byReference SQL round-tripped rows
    expect(appDash[0].organization_id).toBe(targetOrg); // org remap covers app dashboards too
  });

  // The point of idempotency: one SUT can be exported a few test runs at a time and the parts
  // imported one after another, in any order, without the second bundle colliding with the first.
  it('merges bundles into an existing SUT so one SUT can arrive in several parts', async () => {
    const runUuid2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const runKey2 = 'roundtrip-run-2';
    const exportRuns = (ids: string[]) =>
      exportService
        .export(sutId, { testRunIds: ids, includeOptional: false, includeRaw: false })
        .then(streamToBuffer);

    try {
      await dataSource.query(
        `INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload, organization_id) VALUES ($1,$2,$3,'test','wl-1',$4)`,
        [runUuid2, runKey2, sutId, targetOrg],
      );
      const partA = await exportRuns([runUuid]);
      const partB = await exportRuns([runUuid2]);
      // Target has part A only — part B is the follow-up bundle.
      await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid2]);

      // Part A is entirely present already: merged, nothing written, nothing thrown.
      const a = await importService.import(partA, targetOrg);
      expect(a.mergedIntoExisting).toBe(true);
      expect(a.rowCounts['test_runs']).toBe(0);
      expect(a.skippedCounts['test_runs']).toBe(1);

      // Part B adds its run to the same SUT.
      const b = await importService.import(partB, targetOrg);
      expect(b.mergedIntoExisting).toBe(true);
      expect(b.rowCounts['test_runs']).toBe(1);

      // Replaying part B is a no-op, not a duplicate and not a 23505.
      const replay = await importService.import(partB, targetOrg);
      expect(replay.rowCounts['test_runs']).toBe(0);
      expect(replay.skippedCounts['test_runs']).toBe(1);

      const runs = await dataSource.query(
        `SELECT count(*)::int AS n FROM test_runs WHERE system_under_test_id = $1`,
        [sutId],
      );
      expect(runs[0].n).toBe(2);
    } finally {
      await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid2]);
    }
  });

  // Both guards below replace a 23505 that the blanket ON CONFLICT DO NOTHING would otherwise
  // swallow. Swallowing them is what makes them dangerous: the row is silently skipped and
  // counted as "already present" while the rest of the bundle writes on top of a foreign run.
  it('refuses a bundle whose test run key belongs to a different run here', async () => {
    const foreignUuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const stream = await exportService.export(sutId, {
      testRunIds: [runUuid],
      includeOptional: false,
      includeRaw: false,
    });
    const bundle = await streamToBuffer(stream);

    try {
      // Same run KEY, different uuid — exactly what two environments running one suite produce.
      await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
      await dataSource.query(
        `INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload, organization_id) VALUES ($1,$2,$3,'test','wl-1',$4)`,
        [foreignUuid, runKey, sutId, targetOrg],
      );

      await expect(importService.import(bundle, targetOrg)).rejects.toThrow(
        /already belong to a different test run/i,
      );
    } finally {
      await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [foreignUuid]);
      await dataSource.query(
        `INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload, organization_id) VALUES ($1,$2,$3,'test','wl-1',$4)`,
        [runUuid, runKey, sutId, targetOrg],
      );
    }
  });

  it('refuses to merge an existing SUT into a different organization', async () => {
    const otherOrg = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const stream = await exportService.export(sutId, {
      testRunIds: [runUuid],
      includeOptional: false,
      includeRaw: false,
    });
    const bundle = await streamToBuffer(stream);

    // The SUT row would keep org targetOrg while its new runs got otherOrg — a split that hides
    // the runs from both organizations at once.
    await expect(importService.import(bundle, otherOrg)).rejects.toThrow(
      /already exists in organization/i,
    );
  });

  it('assigns a fresh serial id for ds_panels instead of colliding on the source id', async () => {
    // ds_panels.id is an env-local serial int; a source id will already be taken in
    // the target. Import must drop it and let the sequence assign a new one, not 23505.
    const fixtureSut = '11111111-0000-0000-0000-000000000009';
    const manifestSut = '11111111-0000-0000-0000-00000000000a'; // must NOT exist → passes pre-check
    const gi = '11111111-0000-0000-0000-000000000001';
    const gd = '11111111-0000-0000-0000-000000000002';
    const ad = '11111111-0000-0000-0000-000000000003';
    const panelRunKey = 'serial-collision-run';
    try {
      await dataSource.query(`INSERT INTO systems_under_test (id, name, description, organization_id) VALUES ($1,'serial-collision-sut','sc',$2)`, [fixtureSut, targetOrg]);
      await dataSource.query(`INSERT INTO grafana_instances (id, label, client_url, org_id, organization_id) VALUES ($1,'sc-grafana','https://g.example.com','1',$2)`, [gi, targetOrg]);
      await dataSource.query(`INSERT INTO grafana_dashboards (id, grafana_instance_id, grafana_id, uid, name, panels, organization_id) VALUES ($1,$2,1,'sc-uid','sc-dash','{}'::jsonb,$3)`, [gd, gi, targetOrg]);
      await dataSource.query(`INSERT INTO application_dashboards (id, system_under_test_id, test_environment, grafana_instance_id, grafana_dashboard_id, dashboard_name, dashboard_label, organization_id) VALUES ($1,$2,'test',$3,$4,'sc-app','sc-label',$5)`, [ad, fixtureSut, gi, gd, targetOrg]);

      // Seed an existing panel and capture its serial id — the bundle will reuse it.
      const seeded = await dataSource.query(
        `INSERT INTO ds_panels (test_run_id, application_dashboard_id, organization_id) VALUES ('existing-run',$1,$2) RETURNING id`,
        [ad, targetOrg],
      );
      const existingId: number = seeded[0].id;

      const lines = [
        JSON.stringify({ __manifest__: { schemaVersion: 1, sourceSutId: manifestSut, sutName: 'serial-collision' } }),
        JSON.stringify({ __table__: 'ds_panels' }),
        // created_at/updated_at mirror a real export row (full rows); the column-explicit
        // insert takes JSON values verbatim rather than the column default.
        JSON.stringify({ id: existingId, test_run_id: panelRunKey, application_dashboard_id: ad, organization_id: srcOrg, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
      ];
      const bundle = gzipSync(Buffer.from(lines.join('\n') + '\n'));

      const summary = await importService.import(bundle, targetOrg);
      expect(summary.rowCounts['ds_panels']).toBe(1);

      const imported = await dataSource.query(`SELECT id, organization_id FROM ds_panels WHERE test_run_id = $1`, [panelRunKey]);
      expect(imported).toHaveLength(1);
      expect(imported[0].id).not.toBe(existingId); // fresh serial id, not the colliding source id
      expect(imported[0].organization_id).toBe(targetOrg); // org still remapped
    } finally {
      await dataSource.query(`DELETE FROM ds_panels WHERE test_run_id IN ('existing-run', $1)`, [panelRunKey]);
      await dataSource.query(`DELETE FROM application_dashboards WHERE id = $1`, [ad]);
      await dataSource.query(`DELETE FROM grafana_dashboards WHERE id = $1`, [gd]);
      await dataSource.query(`DELETE FROM grafana_instances WHERE id = $1`, [gi]);
      await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [fixtureSut]);
    }
  });

  it('rejects a bundle that targets a table outside the allowlist (SQL trust boundary)', async () => {
    const evilSutId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const lines = [
      JSON.stringify({ __manifest__: { schemaVersion: 1, sourceSutId: evilSutId, sutName: 'evil' } }),
      JSON.stringify({ __table__: 'api_keys' }),
      JSON.stringify({ id: 'x', some: 'row' }),
    ];
    const evilBuffer = gzipSync(Buffer.from(lines.join('\n') + '\n'));

    await expect(importService.import(evilBuffer, targetOrg)).rejects.toThrow(/unknown table/i);
  });
});
