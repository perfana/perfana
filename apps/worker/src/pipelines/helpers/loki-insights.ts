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
  lokiRangeQuery,
  isWarnLevel,
  withStreamMatcher,
  serviceLevelExpr,
  labelFilter,
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
/** Applications given their own patterns and lines: the ones with most errors, then most lines. */
export const LOKI_MAX_SERVICES = 20;
/** Per application: patterns kept (busiest, plus busiest error/warn ones not already in) and lines. */
const SERVICE_TOP_PATTERNS = 10;
const SERVICE_PROBLEM_PATTERNS = 5;
const SERVICE_SAMPLE_ERRORS = 10;
const SERVICE_SAMPLE_WARNINGS = 5;
/** What a service is called when its lines lack the service label. Never queried per service. */
export const NO_SERVICE = '(none)';
/** Lines clustered when the patterns API is unavailable. */
const FALLBACK_SAMPLE_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

const ERROR_RE = '(?i)(error|err|fatal|critical|crit|panic|emerg|alert|severe)';
const WARN_RE = '(?i)(warn|warning)';
const ERROR_LINE_FILTER = '|~ `(?i)\\b(error|exception|fatal|panic)\\b`';

export interface LokiInsightsResult {
  patterns: number;
  samples: number;
  services: number;
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
      if (p.firstSeen && (!prev.firstSeen || p.firstSeen < prev.firstSeen)) {prev.firstSeen = p.firstSeen;}
      if (p.lastSeen && (!prev.lastSeen || p.lastSeen > prev.lastSeen)) {prev.lastSeen = p.lastSeen;}
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

/** The busiest patterns, with the busiest error and warning ones kept even when info lines dominate. */
export function selectPatterns(all: LokiPattern[], topN = LOKI_TOP_PATTERNS, problemsN = LOKI_TOP_PROBLEM_PATTERNS): LokiPattern[] {
  const top = all.slice(0, topN);
  const taken = new Set(top.map((p) => patternKey(p.pattern)));
  const problems = all
    .filter((p) => (p.level === 'error' || p.level === 'warn') && !taken.has(patternKey(p.pattern)))
    .slice(0, problemsN);
  return [...top, ...problems];
}

function lineLevel(line: LokiLogLine, levelLabel: string): string | null {
  return normalizeLevel(line.labels[levelLabel]) ?? normalizeLevel(line.labels.detected_level) ?? levelOfLine(line.line);
}

export interface ServiceTotals {
  service: string;
  total: number;
  errors: number;
  warns: number;
}

/** Series of `sum by (service, level)` → totals per service, summed over the window and across mappings. */
export function serviceTotalsFrom(
  series: Array<{ labels: Record<string, string>; points: Array<{ value: number }> }>,
  serviceLabel: string,
  levelLabel: string,
  into = new Map<string, ServiceTotals>(),
): Map<string, ServiceTotals> {
  for (const s of series) {
    const service = s.labels[serviceLabel] || NO_SERVICE;
    const n = s.points.reduce((acc, p) => acc + (Number.isFinite(p.value) ? p.value : 0), 0);
    const t = into.get(service) ?? { service, total: 0, errors: 0, warns: 0 };
    t.total += n;
    if (isErrorLevel(s.labels[levelLabel])) {t.errors += n;}
    else if (isWarnLevel(s.labels[levelLabel])) {t.warns += n;}
    into.set(service, t);
  }
  return into;
}

/** The applications that get their own patterns and lines: most errors first, then most lines. */
export function pickServices(totals: ServiceTotals[], max = LOKI_MAX_SERVICES): ServiceTotals[] {
  return totals
    .filter((t) => t.service !== NO_SERVICE && t.total > 0)
    .sort((a, b) => b.errors - a.errors || b.total - a.total || a.service.localeCompare(b.service))
    .slice(0, max);
}

/** At most `limit` of `fns` in flight at once, results in order. */
async function inPool<T>(fns: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out = new Array<T>(fns.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < fns.length; i = next++) {out[i] = await fns[i]!();}
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, fns.length)) }, worker));
  return out;
}

type PatternRow = LokiPattern & { configId: string; source: 'patterns' | 'sampled'; service: string | null };
type SampleRow = LokiLogLine & { configId: string; level: string | null; service: string | null };
type ServiceRow = ServiceTotals & { configId: string };

/**
 * Snapshot every collectable Loki connection of the run: over all mapped streams (service NULL),
 * and, once migration 1839 has run, per application (the connection's service label, default
 * `service_name`): lines / errors / warnings per service, and patterns and lines for the busiest
 * `LOKI_MAX_SERVICES`. Replaces the run's stored rows only when something was found, so
 * re-analysing a run whose window Loki has dropped keeps the old snapshot.
 */
export async function snapshotLokiInsights(
  db: WorkerDatabaseService,
  logger: Logger,
  run: RunForInsights,
): Promise<LokiInsightsResult> {
  const result: LokiInsightsResult = { patterns: 0, samples: 0, services: 0, source: null, errors: [] };
  if (!run.startTime || !run.endTime) {return result;}
  const from = new Date(run.startTime);
  const to = new Date(run.endTime);
  const present = await db.query<{ patterns: boolean; services: boolean }>(
    `SELECT to_regclass('public.loki_run_patterns') IS NOT NULL AS patterns, to_regclass('public.loki_run_services') IS NOT NULL AS services`,
  );
  if (!present[0]?.patterns) {return result;}
  // Before migration 1839 the service columns do not exist: take the overall snapshot only.
  const perService = !!present[0]?.services;

  const configIds = await getCollectableLokiConfigIds(db, run);
  if (configIds.length === 0) {return result;}
  const allMappings = await loadLokiMappings(db, run);

  const patternRows: PatternRow[] = [];
  const sampleRows: SampleRow[] = [];
  const serviceRows: ServiceRow[] = [];
  const step = Math.max(60, Math.ceil((to.getTime() - from.getTime()) / 1000 / 200));
  const byTime = (a: LokiLogLine, b: LokiLogLine) => b.time.getTime() - a.time.getTime();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

  for (const configId of configIds) {
    const config = await loadLokiConfig(db, configId);
    if (!config) {continue;}
    if (!lokiConfigBelongsTo(config, run.organizationId)) {
      result.errors.push(`Loki connection ${config.label} belongs to another organization than this run`);
      continue;
    }
    const conn = lokiConnectionOf(config);
    const dispatcher = await resolveFetchProxyDispatcher(config.organization_id, config.use_proxy);
    const opts = { dispatcher, timeoutMs: 60_000 };
    const mappings = allMappings.filter((m) => m.loki_config_id === configId).map((m) => ({ matchers: m.matchers, labels: m.labels }));
    if (mappings.length === 0) {continue;}
    const level = config.level_label;
    const serviceLabel = config.service_label || 'service_name';
    const errorFilter = `| ${level}=~"${ERROR_RE}"`;
    const warnFilter = `| ${level}=~"${WARN_RE}"`;

    // 1. Newest error and warning lines per mapping. A stream without the level label matches no
    //    label filter, so an empty answer falls back to a line filter on the usual words.
    const errors: LokiLogLine[] = [];
    const warns: LokiLogLine[] = [];
    for (const m of mappings) {
      try {
        let lines = await lokiLogLines(conn, buildLogExpr(m, errorFilter), from, to, LOKI_SAMPLE_ERRORS, opts);
        if (lines.length === 0) {lines = await lokiLogLines(conn, buildLogExpr(m, ERROR_LINE_FILTER), from, to, LOKI_SAMPLE_ERRORS, opts);}
        errors.push(...lines);
        warns.push(...await lokiLogLines(conn, buildLogExpr(m, warnFilter), from, to, LOKI_SAMPLE_WARNINGS, opts));
      } catch (err) {
        result.errors.push(`Loki sample lines for ${buildStreamSelector(m.matchers)}: ${errMsg(err)}`);
      }
    }
    for (const l of errors.sort(byTime).slice(0, LOKI_SAMPLE_ERRORS)) {sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'error', service: null });}
    for (const l of warns.sort(byTime).slice(0, LOKI_SAMPLE_WARNINGS)) {sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'warn', service: null });}

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
        logger.info(`Loki patterns API unavailable for ${config.label} (${status ?? 'no status'}): ${errMsg(err)}; clustering sampled lines instead`);
        break;
      }
    }
    const apiPatterns = apiAvailable ? mergePatterns(fromApi) : [];
    const sampled: LokiLogLine[] = [];
    if (apiPatterns.length > 0) {
      for (const p of selectPatterns(apiPatterns)) {patternRows.push({ ...p, configId, source: 'patterns', service: null });}
    } else {
      apiAvailable = false;
      for (const m of mappings) {
        try {
          let lines = await lokiLogLines(conn, buildLogExpr(m, `| ${level}=~"${ERROR_RE.slice(0, -1)}|warn|warning)"`), from, to, FALLBACK_SAMPLE_LINES, opts);
          if (lines.length === 0) {lines = await lokiLogLines(conn, buildLogExpr(m, ERROR_LINE_FILTER), from, to, FALLBACK_SAMPLE_LINES, opts);}
          sampled.push(...lines);
        } catch (err) {
          result.errors.push(`Loki pattern sample for ${buildStreamSelector(m.matchers)}: ${errMsg(err)}`);
        }
      }
      for (const p of selectPatterns(clusterLogLines(sampled, level))) {patternRows.push({ ...p, configId, source: 'sampled', service: null });}
    }

    if (!perService) {continue;}

    // 3. Per application. Lines per (service, level) over the window; the run window is covered by
    //    evaluation points from + step .. the first step boundary at or past `to`.
    const totals = new Map<string, ServiceTotals>();
    const evalEnd = new Date(from.getTime() + Math.ceil((to.getTime() - from.getTime()) / (step * 1000)) * step * 1000);
    for (const m of mappings) {
      try {
        const series = await lokiRangeQuery(conn, serviceLevelExpr(m, serviceLabel, level, step), new Date(from.getTime() + step * 1000), evalEnd, step, opts);
        serviceTotalsFrom(series, serviceLabel, level, totals);
      } catch (err) {
        result.errors.push(`Loki lines per ${serviceLabel} for ${buildStreamSelector(m.matchers)}: ${errMsg(err)}`);
      }
    }
    for (const t of totals.values()) {serviceRows.push({ ...t, configId });}
    const picked = pickServices([...totals.values()]);
    if (picked.length === 0) {
      if (totals.size > 0) {logger.info(`Loki snapshot for ${run.testRunId}: no line carries the label "${serviceLabel}", no per-application patterns`);}
      continue;
    }

    // Lines: a label filter, which matches whether the service label is a stream label, structured
    // metadata or parsed. Patterns: the API takes a selector only, so a stream matcher; a service
    // label that is not a stream label returns no patterns for that application, and its overall
    // patterns still stand.
    await inPool(picked.map((svc) => async () => {
      const only = labelFilter(serviceLabel, svc.service);
      const svcErrors: LokiLogLine[] = [];
      const svcWarns: LokiLogLine[] = [];
      for (const m of mappings) {
        try {
          let lines = svc.errors > 0
            ? await lokiLogLines(conn, buildLogExpr(m, `${only} ${errorFilter}`), from, to, SERVICE_SAMPLE_ERRORS, opts)
            : [];
          if (lines.length === 0) {lines = await lokiLogLines(conn, buildLogExpr(m, `${only} ${ERROR_LINE_FILTER}`), from, to, SERVICE_SAMPLE_ERRORS, opts);}
          svcErrors.push(...lines);
          if (svc.warns > 0) {svcWarns.push(...await lokiLogLines(conn, buildLogExpr(m, `${only} ${warnFilter}`), from, to, SERVICE_SAMPLE_WARNINGS, opts));}
        } catch (err) {
          result.errors.push(`Loki lines for ${serviceLabel}=${svc.service}: ${errMsg(err)}`);
        }
      }
      for (const l of svcErrors.sort(byTime).slice(0, SERVICE_SAMPLE_ERRORS)) {sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'error', service: svc.service });}
      for (const l of svcWarns.sort(byTime).slice(0, SERVICE_SAMPLE_WARNINGS)) {sampleRows.push({ ...l, configId, level: lineLevel(l, level) ?? 'warn', service: svc.service });}

      if (apiAvailable) {
        const lists: LokiPattern[][] = [];
        for (const m of mappings) {
          try {
            lists.push(await lokiPatterns(conn, buildStreamSelector(withStreamMatcher(m, serviceLabel, svc.service).matchers), from, to, step, opts));
          } catch (err) {
            result.errors.push(`Loki patterns for ${serviceLabel}=${svc.service}: ${errMsg(err)}`);
          }
        }
        for (const p of selectPatterns(mergePatterns(lists), SERVICE_TOP_PATTERNS, SERVICE_PROBLEM_PATTERNS)) {
          patternRows.push({ ...p, configId, source: 'patterns', service: svc.service });
        }
      }
    }), Math.max(1, config.max_concurrent_queries));

    // Without the patterns API, cluster the already-sampled lines per application.
    if (!apiAvailable) {
      const wanted = new Set(picked.map((p) => p.service));
      const bySvc = new Map<string, LokiLogLine[]>();
      for (const l of sampled) {
        const svc = l.labels[serviceLabel];
        if (svc && wanted.has(svc)) {bySvc.set(svc, [...(bySvc.get(svc) ?? []), l]);}
      }
      for (const [svc, lines] of bySvc) {
        for (const p of selectPatterns(clusterLogLines(lines, level), SERVICE_TOP_PATTERNS, SERVICE_PROBLEM_PATTERNS)) {
          patternRows.push({ ...p, configId, source: 'sampled', service: svc });
        }
      }
    }
  }

  if (patternRows.length === 0 && sampleRows.length === 0 && serviceRows.length === 0) {
    if (result.errors.length === 0) {logger.info(`Loki snapshot for ${run.testRunId}: nothing in the run window, stored snapshot left as it was`);}
    return result;
  }

  const org = run.organizationId;
  if (!org) {
    result.errors.push('Run has no organization; Loki snapshot not stored');
    return result;
  }
  const cut = (v: string, n: number) => jsonbSafeText(v).slice(0, n);
  await db.transaction(async (em) => {
    await em.query('DELETE FROM loki_run_patterns WHERE test_run_id = $1', [run.testRunId]);
    await em.query('DELETE FROM loki_run_samples WHERE test_run_id = $1', [run.testRunId]);
    if (perService) {await em.query('DELETE FROM loki_run_services WHERE test_run_id = $1', [run.testRunId]);}
    for (const p of patternRows) {
      const values = [run.testRunId, run.systemUnderTestId, p.configId, cut(p.pattern, MAX_LINE_LENGTH), patternKey(p.pattern).slice(0, MAX_LINE_LENGTH),
        p.level, Math.round(p.count), p.firstSeen, p.lastSeen, p.source, org, run.teamId ?? null];
      await em.query(
        perService
          ? `INSERT INTO loki_run_patterns (test_run_id, system_under_test_id, loki_config_id, pattern, pattern_key, level, count, first_seen, last_seen, source, organization_id, team_id, created_by, service)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'worker-pipeline', $13)`
          : `INSERT INTO loki_run_patterns (test_run_id, system_under_test_id, loki_config_id, pattern, pattern_key, level, count, first_seen, last_seen, source, organization_id, team_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'worker-pipeline')`,
        perService ? [...values, p.service === null ? null : cut(p.service, 255)] : values,
      );
    }
    for (const s of sampleRows) {
      const labels = Object.fromEntries(Object.entries(s.labels).slice(0, 30).map(([k, v]) => [cut(k, 100), cut(String(v), 300)]));
      const values = [run.testRunId, run.systemUnderTestId, s.configId, s.time, s.level, cut(s.line, MAX_LINE_LENGTH), JSON.stringify(labels), org, run.teamId ?? null];
      await em.query(
        perService
          ? `INSERT INTO loki_run_samples (test_run_id, system_under_test_id, loki_config_id, "time", level, line, labels, organization_id, team_id, created_by, service)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'worker-pipeline', $10)`
          : `INSERT INTO loki_run_samples (test_run_id, system_under_test_id, loki_config_id, "time", level, line, labels, organization_id, team_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'worker-pipeline')`,
        perService ? [...values, s.service === null ? null : cut(s.service, 255)] : values,
      );
    }
    for (const t of serviceRows) {
      await em.query(
        `INSERT INTO loki_run_services (test_run_id, system_under_test_id, loki_config_id, service, total_lines, error_lines, warn_lines, organization_id, team_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'worker-pipeline')`,
        [run.testRunId, run.systemUnderTestId, t.configId, cut(t.service, 255), Math.round(t.total), Math.round(t.errors), Math.round(t.warns), org, run.teamId ?? null],
      );
    }
  });
  result.patterns = patternRows.length;
  result.samples = sampleRows.length;
  result.services = serviceRows.length;
  result.source = patternRows[0]?.source ?? null;
  const errorPatterns = patternRows.filter((p) => isErrorLevel(p.level)).length;
  logger.info(`Loki snapshot for ${run.testRunId}: ${result.patterns} patterns (${errorPatterns} error, from ${result.source ?? 'none'}), ${result.samples} sample lines, ${result.services} applications`);
  return result;
}
