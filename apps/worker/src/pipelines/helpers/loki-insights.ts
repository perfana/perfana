/**
 * Loki pattern and error-line snapshots for the test run page's Loki card.
 * Spec: docs/reference/Features/Loki Log Metrics (spec).md, "What the card shows".
 *
 * Taken at analysis, not read live by the card, for two reasons: Loki's pattern ingester keeps only
 * recent hours of patterns, and log retention drops the lines themselves long before Perfana drops
 * the run. A snapshot also makes "new since the baseline" a cheap comparison of stored keys.
 *
 * Best-effort by contract: every failure is logged and returned, never thrown, and a snapshot that
 * comes back empty (Loki no longer holds the window) leaves the stored one alone.
 */

import type { Logger } from 'pino';
import {
  buildLogExpr,
  buildStreamSelector,
  clusterLogLines,
  isErrorLevel,
  levelOfLine,
  lokiLogLines,
  lokiPatterns,
  LokiError,
  normalizeLevel,
  patternKey,
  type LokiLogLine,
  type LokiPattern,
} from '@perfana/shared/services/loki/client';
import { jsonbSafeText } from '@perfana/shared/constants';
import type { WorkerDatabaseService } from '../../common/database.service.js';
import { resolveFetchProxyDispatcher } from '../../config/proxy-resolver.js';
import { getCollectableLokiConfigIds } from '../../services/collectable-sources.js';
import {
  loadLokiConfig,
  loadLokiMappings,
  lokiConfigBelongsTo,
  lokiConnectionOf,
} from './incremental/loki-collector.js';

/** Patterns kept per run: the busiest overall, plus the busiest error/warn ones not already in. */
export const LOKI_TOP_PATTERNS = 30;
export const LOKI_TOP_PROBLEM_PATTERNS = 20;
/** Newest lines kept per run. */
export const LOKI_SAMPLE_ERRORS = 50;
export const LOKI_SAMPLE_WARNINGS = 20;
/** Lines clustered when the patterns API is unavailable. */
const FALLBACK_SAMPLE_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

const ERROR_RE = '(?i)(error|err|fatal|critical|crit|panic|emerg|alert|severe)';
const WARN_RE = '(?i)(warn|warning)';
const ERROR_LINE_FILTER = '|~ `(?i)\\b(error|exception|fatal|panic)\\b`';

export interface LokiInsightsResult {
  patterns: number;
  samples: number;
  source: 'patterns' | 'sampled' | null;
  errors: string[];
}

interface RunForInsights {
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  startTime?: Date | null;
  endTime?: Date | null;
  organizationId?: string | null;
  teamId?: string | null;
}

/** Same pattern from several mappings: one row, counts added, the widest first/last seen. */
export function mergePatterns(lists: LokiPattern[][]): LokiPattern[] {
  const byKey = new Map<string, LokiPattern>();
  for (const list of lists) {
    for (const p of list) {
      const key = patternKey(p.pattern);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...p });
        continue;
      }
      prev.count += p.count;
      prev.level = prev.level ?? p.level;
      if (p.firstSeen && (!prev.firstSeen || p.firstSeen < prev.firstSeen)) prev.firstSeen = p.firstSeen;
      if (p.lastSeen && (!prev.lastSeen || p.lastSeen > prev.lastSeen)) prev.lastSeen = p.lastSeen;
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/** The busiest patterns, with the busiest error and warning ones kept even when info lines dominate. */
export function selectPatterns(all: LokiPattern[]): LokiPattern[] {
  const top = all.slice(0, LOKI_TOP_PATTERNS);
  const taken = new Set(top.map((p) => patternKey(p.pattern)));
  const problems = all
    .filter((p) => (p.level === 'error' || p.level === 'warn') && !taken.has(patternKey(p.pattern)))
    .slice(0, LOKI_TOP_PROBLEM_PATTERNS);
  return [...top, ...problems];
}

function lineLevel(line: LokiLogLine, levelLabel: string): string | null {
  return normalizeLevel(line.labels[levelLabel]) ?? normalizeLevel(line.labels.detected_level) ?? levelOfLine(line.line);
}

/**
 * Snapshot every collectable Loki connection of the run. Replaces the run's stored rows only when
 * something was found, so re-analysing a run whose window Loki has dropped keeps the old snapshot.
 */
export async function snapshotLokiInsights(
  db: WorkerDatabaseService,
  logger: Logger,
  run: RunForInsights,
): Promise<LokiInsightsResult> {
  const result: LokiInsightsResult = { patterns: 0, samples: 0, source: null, errors: [] };
  if (!run.startTime || !run.endTime) return result;
  const from = new Date(run.startTime);
  const to = new Date(run.endTime);
  const present = await db.query<{ present: boolean }>(`SELECT to_regclass('public.loki_run_patterns') IS NOT NULL AS present`);
  if (!present[0]?.present) return result;

  const configIds = await getCollectableLokiConfigIds(db, run);
  if (configIds.length === 0) return result;
  const allMappings = await loadLokiMappings(db, run);

  const patternRows: Array<LokiPattern & { configId: string; source: 'patterns' | 'sampled' }> = [];
  const sampleRows: Array<LokiLogLine & { configId: string; level: string | null }> = [];
  const step = Math.max(60, Math.ceil((to.getTime() - from.getTime()) / 1000 / 200));

  for (const configId of configIds) {
    const config = await loadLokiConfig(db, configId);
    if (!config) continue;
    if (!lokiConfigBelongsTo(config, run.organizationId)) {
      result.errors.push(`Loki connection ${config.label} belongs to another organization than this run`);
      continue;
    }
    const conn = lokiConnectionOf(config);
    const dispatcher = await resolveFetchProxyDispatcher(config.organization_id, config.use_proxy);
    const opts = { dispatcher, timeoutMs: 60_000 };
    const mappings = allMappings.filter((m) => m.loki_config_id === configId).map((m) => ({ matchers: m.matchers, labels: m.labels }));
    if (mappings.length === 0) continue;
    const level = config.level_label;

    // 1. Newest error and warning lines per mapping. A stream without the level label matches no
    //    label filter, so an empty answer falls back to a line filter on the usual words.
    const errors: LokiLogLine[] = [];
    const warns: LokiLogLine[] = [];
    for (const m of mappings) {
      try {
        let lines = await lokiLogLines(conn, buildLogExpr(m, `| ${level}=~"${ERROR_RE}"`), from, to, LOKI_SAMPLE_ERRORS, opts);
        if (lines.length === 0) lines = await lokiLogLines(conn, buildLogExpr(m, ERROR_LINE_FILTER), from, to, LOKI_SAMPLE_ERRORS, opts);
        errors.push(...lines);
        warns.push(...await lokiLogLines(conn, buildLogExpr(m, `| ${level}=~"${WARN_RE}"`), from, to, LOKI_SAMPLE_WARNINGS, opts));
      } catch (err) {
        result.errors.push(`Loki sample lines for ${buildStreamSelector(m.matchers)}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    const byTime = (a: LokiLogLine, b: LokiLogLine) => b.time.getTime() - a.time.getTime();
    for (const l of errors.sort(byTime).slice(0, LOKI_SAMPLE_ERRORS)) sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'error' });
    for (const l of warns.sort(byTime).slice(0, LOKI_SAMPLE_WARNINGS)) sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'warn' });

    // 2. Patterns: Loki's patterns API over every line, else lines clustered by shape.
    const fromApi: LokiPattern[][] = [];
    let apiAvailable = true;
    for (const m of mappings) {
      try {
        fromApi.push(await lokiPatterns(conn, buildStreamSelector(m.matchers), from, to, step, opts));
      } catch (err) {
        // 404/400/501: no pattern ingester, or a Grafana older than 11 that does not proxy the call.
        apiAvailable = false;
        const status = err instanceof LokiError ? err.status : undefined;
        logger.info(`Loki patterns API unavailable for ${config.label} (${status ?? 'no status'}): ${err instanceof Error ? err.message : err}; clustering sampled lines instead`);
        break;
      }
    }
    const apiPatterns = apiAvailable ? mergePatterns(fromApi) : [];
    if (apiPatterns.length > 0) {
      for (const p of selectPatterns(apiPatterns)) patternRows.push({ ...p, configId, source: 'patterns' });
      continue;
    }
    const sampled: LokiLogLine[] = [];
    for (const m of mappings) {
      try {
        let lines = await lokiLogLines(conn, buildLogExpr(m, `| ${level}=~"${ERROR_RE.slice(0, -1)}|warn|warning)"`), from, to, FALLBACK_SAMPLE_LINES, opts);
        if (lines.length === 0) lines = await lokiLogLines(conn, buildLogExpr(m, ERROR_LINE_FILTER), from, to, FALLBACK_SAMPLE_LINES, opts);
        sampled.push(...lines);
      } catch (err) {
        result.errors.push(`Loki pattern sample for ${buildStreamSelector(m.matchers)}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    for (const p of selectPatterns(clusterLogLines(sampled, level))) patternRows.push({ ...p, configId, source: 'sampled' });
  }

  if (patternRows.length === 0 && sampleRows.length === 0) {
    if (result.errors.length === 0) logger.info(`Loki snapshot for ${run.testRunId}: nothing in the run window, stored snapshot left as it was`);
    return result;
  }

  const org = run.organizationId;
  if (!org) {
    result.errors.push('Run has no organization; Loki snapshot not stored');
    return result;
  }
  await db.transaction(async (em) => {
    await em.query('DELETE FROM loki_run_patterns WHERE test_run_id = $1', [run.testRunId]);
    await em.query('DELETE FROM loki_run_samples WHERE test_run_id = $1', [run.testRunId]);
    for (const p of patternRows) {
      await em.query(
        `INSERT INTO loki_run_patterns (test_run_id, system_under_test_id, loki_config_id, pattern, pattern_key, level, count, first_seen, last_seen, source, organization_id, team_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'worker-pipeline')`,
        [run.testRunId, run.systemUnderTestId, p.configId, jsonbSafeText(p.pattern).slice(0, MAX_LINE_LENGTH), patternKey(p.pattern).slice(0, MAX_LINE_LENGTH),
          p.level, Math.round(p.count), p.firstSeen, p.lastSeen, p.source, org, run.teamId ?? null],
      );
    }
    for (const s of sampleRows) {
      const labels = Object.fromEntries(Object.entries(s.labels).slice(0, 30).map(([k, v]) => [jsonbSafeText(k).slice(0, 100), jsonbSafeText(String(v)).slice(0, 300)]));
      await em.query(
        `INSERT INTO loki_run_samples (test_run_id, system_under_test_id, loki_config_id, "time", level, line, labels, organization_id, team_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'worker-pipeline')`,
        [run.testRunId, run.systemUnderTestId, s.configId, s.time, s.level, jsonbSafeText(s.line).slice(0, MAX_LINE_LENGTH), JSON.stringify(labels), org, run.teamId ?? null],
      );
    }
  });
  result.patterns = patternRows.length;
  result.samples = sampleRows.length;
  result.source = patternRows[0]?.source ?? null;
  const errorPatterns = patternRows.filter((p) => isErrorLevel(p.level)).length;
  logger.info(`Loki snapshot for ${run.testRunId}: ${result.patterns} patterns (${errorPatterns} error, from ${result.source ?? 'none'}), ${result.samples} sample lines`);
  return result;
}
