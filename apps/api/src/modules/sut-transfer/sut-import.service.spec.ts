import { DataSource } from 'typeorm';
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

  it('rejects import when the SUT already exists', async () => {
    const stream = await exportService.export(sutId, { testRunIds: [runUuid], includeOptional: false, includeRaw: false });
    const bundle = await streamToBuffer(stream);
    await expect(importService.import(bundle, targetOrg)).rejects.toThrow(/already exists/i);
  });
});
