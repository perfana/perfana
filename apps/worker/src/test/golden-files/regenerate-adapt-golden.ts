/**
 * Regenerate adapt-real-golden.json from the current database state.
 *
 * Run from repo root:
 *   npx tsx apps/worker/src/test/golden-files/regenerate-adapt-golden.ts
 */

import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00005';

const dataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'perfana',
  password: 'perfana',
  database: 'perfana',
  synchronize: false,
  logging: false,
});

await dataSource.initialize();

console.log('Connected to database. Capturing golden file for', TEST_RUN_ID, '...');

// 1. Result count
const countRows = await dataSource.query(
  `SELECT count(*) as cnt FROM ds_adapt_results WHERE test_run_id = $1`,
  [TEST_RUN_ID],
);
const resultCount = parseInt(countRows[0].cnt, 10);
console.log('  resultCount:', resultCount);

// 2. Conclusion label distribution
const labelRows = await dataSource.query(
  `SELECT conclusion->>'label' as label, count(*)::int as cnt
   FROM ds_adapt_results WHERE test_run_id = $1
   GROUP BY conclusion->>'label' ORDER BY label`,
  [TEST_RUN_ID],
);
const conclusionLabelCounts: Record<string, number> = {};
for (const row of labelRows) {
  conclusionLabelCounts[row.label] = row.cnt;
}
console.log('  conclusionLabelCounts:', conclusionLabelCounts);

// 3. Overall conclusion
const conclusionRows = await dataSource.query(
  `SELECT conclusion, details FROM ds_adapt_conclusion WHERE test_run_id = $1`,
  [TEST_RUN_ID],
);
if (conclusionRows.length !== 1) {
  throw new Error(`Expected 1 overall conclusion row, got ${conclusionRows.length}`);
}
const overallConclusion = {
  conclusion: conclusionRows[0].conclusion,
  details: conclusionRows[0].details,
};
console.log('  overallConclusion:', overallConclusion);

// 4. All result rows
const results = await dataSource.query(
  `SELECT application_dashboard_id, panel_id, metric_name,
          dashboard_uid, dashboard_label, panel_title, unit,
          statistic, thresholds, checks, conclusion,
          compare_config, metric_classification,
          is_constant, all_missing, exists_data,
          uses_default_value, default_value
   FROM ds_adapt_results
   WHERE test_run_id = $1
   ORDER BY application_dashboard_id, panel_id, metric_name`,
  [TEST_RUN_ID],
);
console.log('  results rows:', results.length);

await dataSource.destroy();

const golden = {
  description: 'Golden-file: regenerated to match current pipeline output.',
  capturedAt: new Date().toISOString(),
  testRunId: TEST_RUN_ID,
  controlGroupId: TEST_RUN_ID,
  controlGroupTestRuns: [
    'PerfanaWebshop-acc-loadTest-00004',
    'PerfanaWebshop-acc-loadTest-00003',
    'PerfanaWebshop-acc-loadTest-00002',
    'PerfanaWebshop-acc-loadTest-00001',
  ],
  overallConclusion,
  resultCount,
  conclusionLabelCounts,
  results,
};

const outPath = path.join(__dirname, 'adapt-real-golden.json');
fs.writeFileSync(outPath, JSON.stringify(golden, null, 4));
console.log(`\nWrote ${outPath} (${results.length} results)`);
