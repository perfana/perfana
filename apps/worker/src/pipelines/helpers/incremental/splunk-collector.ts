/**
 * Splunk collector for the Incremental Metrics Pipeline.
 * Spec: docs/reference/Features/Splunk Log Metrics (spec).md.
 *
 * Each enabled `splunk_queries` row for the run's workload becomes one timechart search over the
 * time range, with `$entities` expanded to the run scope's `splunk_entity_mappings`. The result is
 * shaped as a PanelMetricsDocument and written through BatchProcessor, so the column clamp, the
 * conflict-key dedup and the ramp-up flag are the same code Dynatrace uses.
 */

import type { Logger } from 'pino';
import {
  scopeSplFilter,
  splunkTimechart,
  SplunkError,
  type SplunkConnection,
  type SplunkEntityMappingLike,
} from '@perfana/shared/services/splunk/client';
import { safeDecrypt } from '@perfana/shared/utils';
import { WorkerDatabaseService } from '../../../common/database.service.js';
import { resolveFetchProxyDispatcher } from '../../../config/proxy-resolver.js';
import { perfTestBucketSizes } from '../../../utils/time-bucketing.js';
import type { PanelMetricsDocument } from '../../../types/dynatrace/index.js';
import type { CollectionResult } from './types.js';
import type { BatchProcessor } from './batch-processor.js';
import type { TestRunContext } from './metric-processor.js';

/**
 * Re-query this far back on every live tick. Splunk indexing lag is routinely tens of seconds and
 * minutes under load; re-writing overlapping buckets is safe because the ds_metrics write upserts.
 */
// ponytail: fixed 5 min, like DYNATRACE_INGEST_LOOKBACK_MS; an env var when a deployment lags longer.
export const SPLUNK_INGEST_LOOKBACK_MS = 5 * 60 * 1000;

/** Concurrency retries before a range is given up as failed. */
const CONCURRENCY_RETRIES = 3;

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

interface SplunkQueryRow {
  id: string;
  splunk_config_id: string;
  dashboard_label: string;
  application_dashboard_id: string | null;
  metrics_source_id: string | null;
  dashboard_uid: string | null;
  panel_title: string;
  panel_id: number;
  spl: string;
  split_by: string | null;
  aggregation: string;
  metric_unit: string;
  max_series: number;
}

interface SplunkConfigRow {
  id: string;
  label: string;
  host: string;
  api_token: string | null;
  username: string | null;
  password: string | null;
  splunk_app: string;
  use_proxy: boolean;
  organization_id: string;
  max_concurrent_searches: number;
}

interface MappingRow {
  splunk_config_id: string;
  index_name: string;
  sourcetype: string | null;
  host_pattern: string | null;
  labels: string[];
}

/**
 * Bucket size: the perf-test ticks' size, from `planned_duration` (60 s without one). It must not
 * come from `end_time`: the keep-alive moves that to "now" on every post, so the size would step up
 * as a live run grows, and since `time` is in the ds_metrics conflict key, buckets of different
 * sizes would pile up rather than overwrite (worker CLAUDE.md, `perfTestBucketSizes`). One size on
 * every path — live tick, gap fill, force refetch — keeps a run on one grid.
 * ponytail: no per-second normalisation, so runs of one workload with different planned durations
 * compare counts per different spans; divide by the bucket if that shows up in ADAPT.
 */
export function splunkBucketSeconds(testRun: { startTime?: Date; plannedDuration?: number | null }): number {
  return perfTestBucketSizes({ plannedDuration: testRun.plannedDuration, startTime: testRun.startTime ?? new Date(0) }).tick;
}

export class SplunkCollector {
  constructor(
    private logger: Logger,
    private db: WorkerDatabaseService,
    private batchProcessor: BatchProcessor,
  ) {}

  async collect(
    testRunId: string,
    testRun: TestRunData,
    splunkConfigId: string | undefined,
    fromTime: Date,
    toTime: Date,
  ): Promise<CollectionResult> {
    const started = Date.now();
    const errors: string[] = [];
    // Only a connection-level failure (config gone, wrong org, load/write threw) fails the tick.
    // A panel whose search errors keeps its error in errors[] and the rest of the tick stands,
    // exactly like GrafanaCollector: failing the range on one broken panel would re-search the
    // whole run on every tick (worker CLAUDE.md, "Gap-filling a completed run", rule 4).
    let fatal = false;
    let dataPoints = 0;
    let maxDataTimestamp: Date | undefined;

    try {
      const queries = await this.loadQueries(testRun, splunkConfigId);
      if (queries.length === 0) {
        return { success: true, dataPoints: 0, errors: [], duration: Date.now() - started };
      }
      const mappings = await this.loadMappings(testRun);
      const context: TestRunContext = {
        startTime: testRun.startTime,
        endTime: testRun.endTime,
        analysisStartOffset: testRun.analysisStartOffset,
        analysisEndOffset: testRun.analysisEndOffset,
        organizationId: testRun.organizationId ?? null,
        teamId: testRun.teamId ?? null,
      };

      const byConfig = new Map<string, SplunkQueryRow[]>();
      for (const q of queries) {byConfig.set(q.splunk_config_id, [...(byConfig.get(q.splunk_config_id) ?? []), q]);}

      const lookback = testRun.completed ? 0 : SPLUNK_INGEST_LOOKBACK_MS;
      const from = new Date(Math.max(fromTime.getTime() - lookback, testRun.startTime?.getTime() ?? 0));
      const bucketSeconds = splunkBucketSeconds(testRun);

      for (const [configId, configQueries] of byConfig) {
        const config = await this.loadConfig(configId);
        if (!config) {
          errors.push(`Splunk connection ${configId} not found`);
          fatal = true;
          continue;
        }
        // A query must never read another organization's mapping, nor use another organization's
        // token. Fail closed: a run with no organization cannot prove the connection is its own.
        if (!testRun.organizationId || config.organization_id !== testRun.organizationId) {
          errors.push(`Splunk connection ${config.label} belongs to another organization than this run`);
          fatal = true;
          continue;
        }
        const conn: SplunkConnection = {
          host: config.host,
          apiToken: config.api_token,
          username: config.username,
          password: config.password,
          splunkApp: config.splunk_app,
          label: config.label,
        };
        const dispatcher = await resolveFetchProxyDispatcher(config.organization_id, config.use_proxy);
        const configMappings = mappings.filter((m) => m.splunk_config_id === configId);
        const documents = await this.runQueries(
          conn, configQueries, configMappings, testRunId, from, toTime, bucketSeconds,
          Math.max(1, config.max_concurrent_searches), dispatcher, errors,
        );
        const batch = await this.batchProcessor.processSplunkDocuments(documents, context);
        dataPoints += batch.totalRecords;
        errors.push(...batch.errors);
        if (batch.maxDataTimestamp && (!maxDataTimestamp || batch.maxDataTimestamp > maxDataTimestamp)) {
          maxDataTimestamp = batch.maxDataTimestamp;
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Unknown Splunk collection error');
      fatal = true;
    }

    if (errors.length > 0) {this.logger.error(`Splunk collection for ${testRunId} had errors: ${errors.join(' | ')}`);}
    return { success: !fatal, dataPoints, errors, duration: Date.now() - started, maxDataTimestamp };
  }

  /** Runs at most `concurrency` searches at once per connection (Splunk's per-user search quota). */
  private async runQueries(
    conn: SplunkConnection,
    queries: SplunkQueryRow[],
    mappings: MappingRow[],
    testRunId: string,
    from: Date,
    to: Date,
    bucketSeconds: number,
    concurrency: number,
    dispatcher: unknown,
    errors: string[],
  ): Promise<PanelMetricsDocument[]> {
    const mappingLikes: SplunkEntityMappingLike[] = mappings.map((m) => ({
      indexName: m.index_name,
      sourcetype: m.sourcetype,
      hostPattern: m.host_pattern,
      labels: m.labels,
    }));
    const documents: PanelMetricsDocument[] = [];
    const queue = [...queries];

    const worker = async () => {
      for (let q = queue.shift(); q; q = queue.shift()) {
        if (!q.application_dashboard_id || !q.dashboard_uid) {
          errors.push(`Splunk panel "${q.panel_title}" has no dashboard; re-save it in the Splunk tab`);
          continue;
        }
        const filter = scopeSplFilter(q.spl, mappingLikes, testRunId);
        if (filter === null) {
          // An $entities[label] with no mapping carrying that label: nothing to read, not a failure.
          this.logger.warn(`Splunk panel "${q.panel_title}": no mapped source matches its $entities, skipped`);
          continue;
        }
        try {
          const points = await this.withConcurrencyRetry(() =>
            splunkTimechart(
              conn,
              { filter, from, to, bucketSeconds, aggregation: q.aggregation, splitBy: q.split_by, maxSeries: q.max_series },
              {
                dispatcher,
                // String interpolation only: pino drops a second-argument object.
                onSearch: (search, st, ms) => this.logger.debug(
                  `Splunk panel "${q.panel_title}" search (${ms}ms, ${st.lines} lines, ${st.finalRows} final rows, ${st.previewRows} preview rows${st.usedPreview ? ', used last preview set' : ''}): ${search}`,
                ),
              },
            ),
          );
          if (points.length === 0) {
            // The only trace of an empty search: say what was asked, so it can be pasted into Splunk.
            this.logger.info(
              `Splunk panel "${q.panel_title}" returned no data for ${from.toISOString()}..${to.toISOString()} (earliest=${Math.floor(from.getTime() / 1000)} latest=${Math.ceil(to.getTime() / 1000)}): ${filter}`,
            );
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
            data: points.map((p) => ({
              metricName: p.series === 'count' && !q.split_by ? q.panel_title : p.series,
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
          if (err instanceof SplunkError && err.detail) {this.logger.warn(`Splunk panel "${q.panel_title}" cause: ${err.detail}`);}
          errors.push(`Splunk panel "${q.panel_title}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, worker));
    return documents;
  }

  private async withConcurrencyRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof SplunkError) || !err.retryable || attempt > CONCURRENCY_RETRIES) {throw err;}
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  private async loadQueries(testRun: TestRunData, splunkConfigId?: string): Promise<SplunkQueryRow[]> {
    const params: unknown[] = [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload];
    let sql = `
      SELECT q.id, q.splunk_config_id, q.dashboard_label, q.application_dashboard_id, q.metrics_source_id,
             ad.dashboard_uid, q.panel_title, q.panel_id, q.spl, q.split_by, q.aggregation, q.metric_unit, q.max_series
        FROM splunk_queries q
        LEFT JOIN application_dashboards ad ON ad.id = q.application_dashboard_id
       WHERE q.system_under_test_id = $1 AND q.test_environment = $2 AND q.workload = $3 AND q.enabled`;
    if (splunkConfigId) {
      params.push(splunkConfigId);
      sql += ` AND q.splunk_config_id = $4`;
    }
    return this.db.query<SplunkQueryRow>(sql + ' ORDER BY q.panel_id', params);
  }

  private async loadMappings(testRun: TestRunData): Promise<MappingRow[]> {
    return this.db.query<MappingRow>(
      `SELECT splunk_config_id, index_name, sourcetype, host_pattern, labels
         FROM splunk_entity_mappings
        WHERE system_under_test_id = $1
          AND (level = 'sut'
               OR (level = 'environment' AND test_environment = $2)
               OR (level = 'workload' AND test_environment = $2 AND workload = $3))`,
      [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload],
    );
  }

  private async loadConfig(id: string): Promise<SplunkConfigRow | null> {
    const rows = await this.db.query<SplunkConfigRow>(
      `SELECT id, label, host, api_token, username, password, splunk_app, use_proxy, organization_id, max_concurrent_searches
         FROM splunk_configs WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) {return null;}
    // Raw SQL bypasses the entity's encrypted-column transformer, so decrypt here.
    return {
      ...row,
      api_token: row.api_token ? safeDecrypt(row.api_token) : null,
      password: row.password ? safeDecrypt(row.password) : null,
    };
  }
}
