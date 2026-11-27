/**
 * Loki collector for the Incremental Metrics Pipeline.
 * Spec: docs/reference/Features/Loki Log Metrics (spec).md.
 *
 * The Splunk collector with the nouns changed: each enabled `loki_queries` row for the run's
 * workload becomes one metric query per stream mapping in scope (through the Grafana instance's
 * `/api/ds/query`), shaped as a PanelMetricsDocument and written through BatchProcessor, so the
 * column clamp, the conflict-key dedup and the ramp-up flag are the code Dynatrace and Splunk use.
 */

import type { Logger } from 'pino';
import {
  lokiPanelPoints,
  LokiError,
  type LokiConnection,
  type LokiMatcher,
  type LokiStreamMappingLike,
} from '@perfana/shared/services/loki/client';
import { safeDecrypt } from '@perfana/shared/utils';
import { LOKI_STARTER_PANEL_TITLES } from '@perfana/shared/constants';
import { DEFAULT_PERFORMANCE_THRESHOLDS } from '../../../constants/performance-metrics.js';
import { WorkerDatabaseService } from '../../../common/database.service.js';
import { resolveFetchProxyDispatcher } from '../../../config/proxy-resolver.js';
import type { PanelMetricsDocument } from '../../../types/dynatrace/index.js';
import type { CollectionResult } from './types.js';
import type { BatchProcessor } from './batch-processor.js';
import type { TestRunContext } from './metric-processor.js';
import { splunkBucketSeconds } from './splunk-collector.js';

/**
 * Re-query this far back on every live tick: promtail/alloy batch and Loki's ingesters flush on
 * their own cadence, so the newest minute is routinely incomplete. Re-writing overlapping buckets
 * is safe because the ds_metrics write upserts.
 */
// ponytail: fixed 2 min, between Dynatrace's 2 and Splunk's 5; an env var when a deployment lags longer.
export const LOKI_INGEST_LOOKBACK_MS = 2 * 60 * 1000;

const RETRIES = 3;

/** One bucket rule for every source that collects on the perf-test grid (planned_duration). */
export const lokiBucketSeconds = splunkBucketSeconds;

interface TestRunData {
  testRunId: string;
  systemUnderTestId: string;
  workload: string;
  testEnvironment: string;
  startTime?: Date;
  endTime?: Date;
  completed?: boolean;
  plannedDuration?: number | null;
  analysisStartOffset?: number;
  analysisEndOffset?: number;
  organizationId?: string | null;
  teamId?: string | null;
}

export interface LokiQueryRow {
  id: string;
  loki_config_id: string;
  dashboard_label: string;
  application_dashboard_id: string | null;
  metrics_source_id: string | null;
  dashboard_uid: string | null;
  panel_title: string;
  panel_id: number;
  logql: string;
  split_by: string | null;
  aggregation: string;
  metric_unit: string;
  max_series: number;
}

export interface LokiConfigRow {
  id: string;
  label: string;
  datasource_uid: string;
  level_label: string;
  /** none | json | logfmt; read through to_jsonb so a worker ahead of migration 1840 reads 'none'. */
  level_parser: string;
  /** NULL-safe before migration 1839, which adds the column: read through to_jsonb. */
  service_label: string;
  max_concurrent_queries: number;
  organization_id: string;
  grafana_label: string;
  base_url: string;
  grafana_org_id: string | null;
  api_key: string | null;
  username: string | null;
  password: string | null;
  use_proxy: boolean;
  grafana_organization_id: string;
}

export interface LokiMappingRow {
  loki_config_id: string;
  matchers: LokiMatcher[];
  labels: string[];
}

/** A connection row with the Grafana instance it queries through, credentials decrypted. */
export async function loadLokiConfig(db: WorkerDatabaseService, id: string): Promise<LokiConfigRow | null> {
  const rows = await db.query<LokiConfigRow>(
    `SELECT c.id, c.label, c.datasource_uid, c.level_label,
            COALESCE(to_jsonb(c)->>'service_label', 'service_name') AS service_label,
            COALESCE(to_jsonb(c)->>'level_parser', 'none') AS level_parser,
            c.max_concurrent_queries, c.organization_id,
            g.label AS grafana_label, COALESCE(NULLIF(g.server_url, ''), g.client_url) AS base_url,
            g.org_id AS grafana_org_id, g.api_key, g.username, g.password, g.use_proxy,
            g.organization_id AS grafana_organization_id
       FROM loki_configs c
       JOIN grafana_instances g ON g.id = c.grafana_instance_id
      WHERE c.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {return null;}
  // Raw SQL bypasses the entity's encrypted-column transformer, so decrypt here.
  return {
    ...row,
    api_key: row.api_key ? safeDecrypt(row.api_key) : null,
    password: row.password ? safeDecrypt(row.password) : null,
  };
}

export function lokiConnectionOf(config: LokiConfigRow): LokiConnection {
  return {
    baseUrl: config.base_url,
    grafanaOrgId: config.grafana_org_id,
    apiKey: config.api_key,
    username: config.username,
    password: config.password,
    datasourceUid: config.datasource_uid,
    label: `${config.grafana_label} / ${config.label}`,
  };
}

/** The run scope's mappings: system level, its environment's, its workload's. */
export async function loadLokiMappings(
  db: WorkerDatabaseService,
  testRun: { systemUnderTestId: string; testEnvironment: string; workload: string },
): Promise<LokiMappingRow[]> {
  return db.query<LokiMappingRow>(
    `SELECT loki_config_id, matchers, labels
       FROM loki_stream_mappings
      WHERE system_under_test_id = $1
        AND (level = 'sut'
             OR (level = 'environment' AND test_environment = $2)
             OR (level = 'workload' AND test_environment = $2 AND workload = $3))
      ORDER BY selector`,
    [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload],
  );
}

/** Neither the connection nor the Grafana instance it queries through may be another organization's. */
export function lokiConfigBelongsTo(config: LokiConfigRow, organizationId: string | null | undefined): boolean {
  return !!organizationId && config.organization_id === organizationId && config.grafana_organization_id === organizationId;
}

/** The starter panel whose rise is a regression: error lines, lower is better. */
export const LOKI_ERROR_PANEL_TITLE: string = LOKI_STARTER_PANEL_TITLES[1];
/** `config_data.source` of the row seedLokiCompareConfigs writes. */
export const LOKI_STARTER_COMPARE_SOURCE = 'loki-starter';

export const LOKI_ERROR_PANEL_CONFIG = {
  metricClassification: { classification: 'USE_errors', higherIsBetter: false },
  thresholds: {
    aggregation: 'mean',
    percentageThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.percentageThreshold,
    iqrThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.iqrThreshold,
    absoluteThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.absoluteThreshold,
  },
  source: LOKI_STARTER_COMPARE_SOURCE,
};

/**
 * Classify the "Error lines by service" panel for ADAPT, so more error lines than the baseline is a
 * regression rather than an unclassified difference. Only that panel: lines by level mixes error
 * and info lines, and log volume moves with load, so both stay unclassified.
 *
 * Panel-level, `ON CONFLICT DO NOTHING`: a row someone saved (or a template wrote) wins. Stamped
 * `worker-pipeline` like the perf-test pipeline's own rows, so a golden-path template merges into
 * it instead of reading it as a hand edit. Matched by the starter's title: a renamed panel is the
 * user's, and is left alone. Best effort, like every seed: a failure never fails collection.
 */
export async function seedLokiCompareConfigs(
  db: WorkerDatabaseService,
  logger: Logger,
  testRun: TestRunData,
  queries: Array<Pick<LokiQueryRow, 'panel_title' | 'panel_id' | 'application_dashboard_id'>>,
): Promise<void> {
  const targets = queries.filter((q) => q.panel_title === LOKI_ERROR_PANEL_TITLE && q.application_dashboard_id);
  if (targets.length === 0) return;
  try {
    await db.query(
      `INSERT INTO ds_compare_config (
          system_under_test_id, test_environment, workload, application_dashboard_id, panel_id,
          metric_name, config_data, organization_id, team_id, created_by, updated_by)
       SELECT $1, $2, $3, t.dashboard_id, t.panel_id, NULL, $6::jsonb, ad.organization_id, ad.team_id, 'worker-pipeline', 'worker-pipeline'
         FROM unnest($4::uuid[], $5::int[]) AS t(dashboard_id, panel_id)
         JOIN application_dashboards ad ON ad.id = t.dashboard_id
       ON CONFLICT DO NOTHING`,
      [
        testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload,
        targets.map((q) => q.application_dashboard_id), targets.map((q) => q.panel_id),
        JSON.stringify(LOKI_ERROR_PANEL_CONFIG),
      ],
    );
  } catch (err) {
    logger.warn(`Loki: could not classify the error lines panel for ADAPT: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export class LokiCollector {
  constructor(
    private logger: Logger,
    private db: WorkerDatabaseService,
    private batchProcessor: BatchProcessor,
  ) {}

  async collect(
    testRunId: string,
    testRun: TestRunData,
    lokiConfigId: string | undefined,
    fromTime: Date,
    toTime: Date,
  ): Promise<CollectionResult> {
    const started = Date.now();
    const errors: string[] = [];
    // Only a connection-level failure fails the tick; a panel whose query errors keeps its error in
    // errors[] and the rest stands (worker CLAUDE.md, "Gap-filling a completed run", rule 4).
    let fatal = false;
    let dataPoints = 0;
    let maxDataTimestamp: Date | undefined;

    try {
      const queries = await this.loadQueries(testRun, lokiConfigId);
      if (queries.length === 0) {
        return { success: true, dataPoints: 0, errors: [], duration: Date.now() - started };
      }
      await seedLokiCompareConfigs(this.db, this.logger, testRun, queries);
      const mappings = await loadLokiMappings(this.db, testRun);
      const context: TestRunContext = {
        startTime: testRun.startTime,
        endTime: testRun.endTime,
        analysisStartOffset: testRun.analysisStartOffset,
        analysisEndOffset: testRun.analysisEndOffset,
        organizationId: testRun.organizationId ?? null,
        teamId: testRun.teamId ?? null,
      };

      const byConfig = new Map<string, LokiQueryRow[]>();
      for (const q of queries) {byConfig.set(q.loki_config_id, [...(byConfig.get(q.loki_config_id) ?? []), q]);}

      const lookback = testRun.completed ? 0 : LOKI_INGEST_LOOKBACK_MS;
      const from = new Date(Math.max(fromTime.getTime() - lookback, testRun.startTime?.getTime() ?? 0));
      const bucketSeconds = lokiBucketSeconds(testRun);

      for (const [configId, configQueries] of byConfig) {
        const config = await loadLokiConfig(this.db, configId);
        if (!config) {
          errors.push(`Loki connection ${configId} not found`);
          fatal = true;
          continue;
        }
        // Fail closed: a run with no organization cannot prove the connection is its own.
        if (!lokiConfigBelongsTo(config, testRun.organizationId)) {
          errors.push(`Loki connection ${config.label} belongs to another organization than this run`);
          fatal = true;
          continue;
        }
        const dispatcher = await resolveFetchProxyDispatcher(config.organization_id, config.use_proxy);
        const configMappings: LokiStreamMappingLike[] = mappings
          .filter((m) => m.loki_config_id === configId)
          .map((m) => ({ matchers: m.matchers, labels: m.labels }));
        const documents = await this.runQueries(
          lokiConnectionOf(config), configQueries, configMappings, testRunId, from, toTime, bucketSeconds,
          Math.max(1, config.max_concurrent_queries), dispatcher, errors,
        );
        const batch = await this.batchProcessor.processLokiDocuments(documents, context);
        dataPoints += batch.totalRecords;
        errors.push(...batch.errors);
        if (batch.maxDataTimestamp && (!maxDataTimestamp || batch.maxDataTimestamp > maxDataTimestamp)) {
          maxDataTimestamp = batch.maxDataTimestamp;
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Unknown Loki collection error');
      fatal = true;
    }

    if (errors.length > 0) {this.logger.error(`Loki collection for ${testRunId} had errors: ${errors.join(' | ')}`);}
    return { success: !fatal, dataPoints, errors, duration: Date.now() - started, maxDataTimestamp };
  }

  /** At most `concurrency` panels at once per connection, to spare Loki's query frontend. */
  private async runQueries(
    conn: LokiConnection,
    queries: LokiQueryRow[],
    mappings: LokiStreamMappingLike[],
    testRunId: string,
    from: Date,
    to: Date,
    bucketSeconds: number,
    concurrency: number,
    dispatcher: unknown,
    errors: string[],
  ): Promise<PanelMetricsDocument[]> {
    const documents: PanelMetricsDocument[] = [];
    const queue = [...queries];

    const worker = async () => {
      for (let q = queue.shift(); q; q = queue.shift()) {
        if (!q.application_dashboard_id || !q.dashboard_uid) {
          errors.push(`Loki panel "${q.panel_title}" has no dashboard; re-save it in the Loki tab`);
          continue;
        }
        try {
          const result = await this.withRetry(() =>
            lokiPanelPoints(
              conn,
              { logql: q.logql, aggregation: q.aggregation, splitBy: q.split_by, maxSeries: q.max_series, panelTitle: q.panel_title },
              mappings, from, to, bucketSeconds, testRunId,
              {
                dispatcher,
                // String interpolation only: pino drops a second-argument object.
                onQuery: (expr, info) => this.logger.debug(
                  `Loki panel "${q.panel_title}" query (${info.ms}ms, ${info.frames} frames, ${info.from.toISOString()}..${info.to.toISOString()}): ${expr}`,
                ),
              },
            ),
          );
          if (result.exprs.length === 0) {
            // An $entities[tag] with no mapping carrying that tag: nothing to read, not a failure.
            this.logger.warn(`Loki panel "${q.panel_title}": no mapped stream matches its $entities, skipped`);
            continue;
          }
          if (!result.points.some((p) => p.value !== 0)) {
            this.logger.info(`Loki panel "${q.panel_title}" returned no lines for ${from.toISOString()}..${to.toISOString()}: ${result.exprs.join(' ; ')}`);
          }
          documents.push({
            testRunId,
            applicationDashboardId: q.application_dashboard_id,
            metricsSourceId: q.metrics_source_id ?? undefined,
            dashboardUid: q.dashboard_uid,
            panelId: q.panel_id,
            panelTitle: q.panel_title,
            dashboardLabel: q.dashboard_label,
            // timestep and rampUp are recomputed from the run by the flattener.
            data: result.points.map((p) => ({
              metricName: p.series,
              time: p.time,
              timestep: 0,
              rampUp: false,
              value: p.value,
              unit: q.metric_unit,
            })),
            errors: [],
            benchmarkIds: [],
          });
        } catch (err) {
          if (err instanceof LokiError && err.detail) {this.logger.warn(`Loki panel "${q.panel_title}" cause: ${err.detail}`);}
          errors.push(`Loki panel "${q.panel_title}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, worker));
    return documents;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof LokiError) || !err.retryable || attempt > RETRIES) {throw err;}
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  private async loadQueries(testRun: TestRunData, lokiConfigId?: string): Promise<LokiQueryRow[]> {
    const params: unknown[] = [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload];
    let sql = `
      SELECT q.id, q.loki_config_id, q.dashboard_label, q.application_dashboard_id, q.metrics_source_id,
             ad.dashboard_uid, q.panel_title, q.panel_id, q.logql, q.split_by, q.aggregation, q.metric_unit, q.max_series
        FROM loki_queries q
        LEFT JOIN application_dashboards ad ON ad.id = q.application_dashboard_id
       WHERE q.system_under_test_id = $1 AND q.test_environment = $2 AND q.workload = $3 AND q.enabled`;
    if (lokiConfigId) {
      params.push(lokiConfigId);
      sql += ` AND q.loki_config_id = $4`;
    }
    return this.db.query<LokiQueryRow>(sql + ' ORDER BY q.panel_id', params);
  }
}
