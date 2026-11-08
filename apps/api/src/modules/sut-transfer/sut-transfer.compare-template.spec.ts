import { DataSource } from 'typeorm';
import { gzipSync } from 'zlib';
import { SutImportService } from './sut-import.service';
import { SUT_RESOURCES } from './sut-resource-graph';

/**
 * `ds_compare_config.template_id` / `template_base` in the SUT bundle (migration 1822).
 *
 * `template_id` names a compare-config template with NO foreign key, on purpose: it is display
 * provenance, and the templates it points at are live configuration that must not travel (they
 * would start seeding runs in the target). So a row carrying it has to import as plain data, not be
 * dropped or nulled the way `generated_reports.template_id` and `ds_metric_series_groups.rule_id`
 * are when their parent is missing.
 */

const SUT_ID = '11111111-0000-0000-0000-000000000001';
const TARGET_ORG = '22222222-0000-0000-0000-000000000002';
const APP_DASH_ID = '33333333-0000-0000-0000-000000000001';
const TEMPLATE_ID = '77777777-0000-0000-0000-000000000001';

type Row = Record<string, unknown>;

const CONFIG_ROW: Row = {
  id: '88888888-0000-0000-0000-000000000001',
  system_under_test_id: SUT_ID,
  test_environment: 'test',
  workload: 'wl-1',
  application_dashboard_id: APP_DASH_ID,
  panel_id: 7,
  metric_name: null,
  config_data: { thresholds: { absoluteThreshold: 5 }, metricClassification: { classification: 'USE_saturation' } },
  template_id: TEMPLATE_ID,
  template_base: { thresholds: { absoluteThreshold: null } },
  organization_id: '22222222-0000-0000-0000-000000000001',
  team_id: null,
  created_by: 'system:golden-path',
  updated_by: 'system:golden-path',
};

const bundle = (tables: Record<string, Row[]>): Buffer => {
  const lines = [JSON.stringify({ __manifest__: { schemaVersion: 1, sourceSutId: SUT_ID, sutName: 'sut' } })];
  for (const [table, rows] of Object.entries(tables)) {
    lines.push(JSON.stringify({ __table__: table }));
    for (const r of rows) lines.push(JSON.stringify(r));
  }
  return gzipSync(Buffer.from(lines.join('\n') + '\n'));
};

describe('compare-config template provenance in the SUT bundle', () => {
  it('imports a ds_compare_config row with template_id and template_base exactly as exported', async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async () => []),
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) =>
        cb({
          query: jest.fn(async (sql: string, params: unknown[] = []) => {
            statements.push({ sql, params });
            return /^INSERT INTO/.test(sql) ? JSON.parse(params[0] as string).map(() => ({ '?column?': 1 })) : [];
          }),
        }),
      ),
    };
    const importer = new SutImportService(dataSource as unknown as DataSource);

    const summary = await importer.import(
      bundle({
        systems_under_test: [{ id: SUT_ID, name: 'sut', organization_id: 'x', team_id: null }],
        application_dashboards: [{ id: APP_DASH_ID, system_under_test_id: SUT_ID, organization_id: 'x' }],
        ds_compare_config: [CONFIG_ROW],
      }),
      TARGET_ORG,
    );

    const insert = statements.find((s) => s.sql.startsWith('INSERT INTO ds_compare_config '))!;
    expect(insert.sql).toBe(
      'INSERT INTO ds_compare_config SELECT * FROM json_populate_recordset(null::ds_compare_config, $1::json) ON CONFLICT DO NOTHING RETURNING 1',
    );
    const [row] = JSON.parse(insert.params[0] as string) as Row[];
    expect(row).toEqual({ ...CONFIG_ROW, organization_id: TARGET_ORG });
    // No parent lookup against the template table: the id is not a reference to check.
    expect(statements.some((s) => /provisioned_template_ds_compare_configs/.test(s.sql))).toBe(false);
    expect(summary.rowCounts['ds_compare_config']).toBe(1);
    expect(summary.droppedCounts['ds_compare_config']).toBeUndefined();
  });

  it('never exports the templates themselves, only rows scoped to the system', () => {
    // `bySut` selects `system_under_test_id = $1`; a template has it NULL, so none travel.
    expect(SUT_RESOURCES.find((r) => r.table === 'provisioned_template_ds_compare_configs')?.filter).toBe('bySut');
  });
});
