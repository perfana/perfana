import { DataSource } from 'typeorm';
import { createGunzip } from 'zlib';
import * as readline from 'readline';
import { createTestApp, closeTestApp, IntegrationTestContext } from '../../../test/helpers/integration-test.helper';
import { SutExportService } from './sut-export.service';

describe('SutExportService (integration)', () => {
  let ctx: IntegrationTestContext;
  let dataSource: DataSource;
  let service: SutExportService;
  const sutId = '11111111-1111-1111-1111-111111111111';
  const runUuid = '22222222-2222-2222-2222-222222222222';
  const runKey = 'export-it-run-1';
  const orgId = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    ctx = await createTestApp([], [], [SutExportService]);
    dataSource = ctx.dataSource;
    service = ctx.module.get(SutExportService);
    await dataSource.query(`INSERT INTO systems_under_test (id, name, description, organization_id) VALUES ($1,'export-it-sut','export-it-sut description',$2)`, [sutId, orgId]);
    await dataSource.query(`INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload, organization_id) VALUES ($1,$2,$3,'test','wl-1',$4)`, [runUuid, runKey, sutId, orgId]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
    await closeTestApp(ctx);
  });

  async function readBundle(stream: NodeJS.ReadableStream): Promise<{ manifest: any; rowsByTable: Record<string, any[]> }> {
    const rl = readline.createInterface({ input: (stream as any).pipe(createGunzip()) });
    let manifest: any = null;
    let current: string | null = null;
    const rowsByTable: Record<string, any[]> = {};
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (obj.__manifest__) { manifest = obj.__manifest__; continue; }
      if (obj.__table__) { current = obj.__table__ as string; rowsByTable[current] = []; continue; }
      if (obj.__summary__) continue;
      if (current) rowsByTable[current]!.push(obj);
    }
    return { manifest, rowsByTable };
  }

  it('streams the SUT and selected test run as NDJSON, manifest first', async () => {
    const stream = await service.export(sutId, { testRunIds: [runUuid], includeOptional: true, includeRaw: false });
    const { manifest, rowsByTable } = await readBundle(stream);
    expect(manifest.sourceSutId).toBe(sutId);
    expect(manifest.sutName).toBe('export-it-sut');
    expect(rowsByTable['systems_under_test']).toHaveLength(1);
    expect(rowsByTable['systems_under_test']![0].id).toBe(sutId);
    expect(rowsByTable['test_runs']).toHaveLength(1);
    expect(rowsByTable['test_runs']![0].test_run_id).toBe(runKey);
    expect(rowsByTable['requests_raw']).toBeUndefined(); // raw not requested
  });
});
