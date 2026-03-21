#!/usr/bin/env node

import { Pool } from 'pg';
import { getConfig } from '../config/environment.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('resetStuckStatuses');

/**
 * Utility script to manually reset stuck IN_PROGRESS statuses
 * Usage: npm run reset-stuck-statuses [test-run-id]
 */

async function resetStuckStatuses(specificTestRunId?: string) {
  const config = getConfig();
  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    max: 10,
  });

  try {
    logger.info('Checking for stuck IN_PROGRESS statuses...');

    let whereClause = `
      WHERE (
        (status->>'evaluatingAdapt' = 'IN_PROGRESS' AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes')
        OR (status->>'evaluatingComparisons' = 'IN_PROGRESS' AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes')
      )
    `;

    const params: any[] = [];

    if (specificTestRunId) {
      whereClause += ` AND test_run_id = $1`;
      params.push(specificTestRunId);
    }

    const resetQuery = `
      UPDATE test_runs
      SET status = jsonb_set(
        jsonb_set(
          jsonb_set(
            status,
            '{evaluatingAdapt}',
            CASE
              WHEN status->>'evaluatingAdapt' = 'IN_PROGRESS'
                   AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes'
              THEN '"FAILED"'::jsonb
              ELSE status->'evaluatingAdapt'
            END
          ),
          '{evaluatingComparisons}',
          CASE
            WHEN status->>'evaluatingComparisons' = 'IN_PROGRESS'
                 AND (status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes'
            THEN '"FAILED"'::jsonb
            ELSE status->'evaluatingComparisons'
          END
        ),
        '{lastUpdate}',
        to_jsonb(NOW()::text)
      )
      ${whereClause}
      RETURNING test_run_id,
                status->>'evaluatingAdapt' as adapt_status,
                status->>'evaluatingComparisons' as comparisons_status,
                status->>'lastUpdate' as last_update
    `;

    const result = await pool.query(resetQuery, params);

    if (result.rows.length === 0) {
      logger.info('No stuck statuses found to reset.');
    } else {
      logger.info(`Reset ${result.rows.length} stuck status(es):`);
      for (const row of result.rows) {
        logger.info(`  - ${row.test_run_id}: adapt=${row.adapt_status}, comparisons=${row.comparisons_status}, updated=${row.last_update}`);
      }
    }

  } catch (error) {
    logger.error('Error resetting stuck statuses:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Check if running as script
if (import.meta.url === `file://${process.argv[1]}`) {
  const testRunId = process.argv[2];
  resetStuckStatuses(testRunId)
    .then(() => {
      logger.info('Reset completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Reset failed:', error);
      process.exit(1);
    });
}

export { resetStuckStatuses };