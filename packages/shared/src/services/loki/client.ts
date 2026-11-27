/**
 * Loki client, shared by apps/api (connection test, label discovery, preview, run summary) and
 * apps/worker (collection, pattern and sample-line snapshots).
 *
 * Perfana never talks to Loki directly: every call goes through a Grafana instance Perfana already
 * holds credentials for, to the Loki datasource on it —
 *
 *   - metric and log queries through `POST /api/ds/query` (the call the worker already uses for
 *     Grafana panels on a Loki datasource), and
 *   - labels, label values and patterns through the datasource's resource calls
 *     (`/api/datasources/uid/:uid/resources/<loki path>`), which Grafana proxies to Loki's
 *     `/loki/api/v1/<path>`.
 *
 * Both need `datasources:query` only, which a Viewer service account holds; nothing here asks
 * Grafana for the datasource's config (root CLAUDE.md, "The Grafana service account needs
 * Viewer"). A multi-tenant Loki gets its `X-Scope-OrgID` from the datasource, not from Perfana.
 *
 * Native fetch only, and no imports that would pull a dependency into an app that does not
 * declare it: the web app imports the validators from here too.
 * Spec: docs/reference/Features/Loki Log Metrics (spec).md.
 */

export interface LokiCredentials {
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface LokiConnection extends LokiCredentials {
  /** Grafana base URL the server calls: the instance's server_url, else its client_url. */
  baseUrl: string;
  /** Grafana organization (grafana_instances.org_id), sent as X-Grafana-Org-Id when numeric. */
  grafanaOrgId?: string | null;
  /** The Loki datasource's uid on that Grafana. */
  datasourceUid: string;
  label?: string | null;
}

/**
 * Same contract as grafanaAuthHeader (`@perfana/shared/services/grafana/auth`): a token wins,
 * else username + password, else null. Duplicated rather than imported so this module stays
 * import-free for the browser bundle; `loki/__tests__/client.spec.ts` pins the two together.
 */
export function lokiAuthHeader(creds: LokiCredentials): string | null {
  const apiKey = creds?.apiKey?.trim();
  if (apiKey) return `Bearer ${apiKey}`;
  const username = creds?.username?.trim();
  const password = creds?.password; // not trimmed: whitespace can be part of a password
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  return null;
}

export class LokiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or undefined for a connection-level failure. */
    readonly status?: number,
    /** True for Loki/Grafana refusing on load (429, 503, too many outstanding requests): retry. */
    readonly retryable = false,
    /** Raw cause chain, for server-side logs only: it can carry the resolved IP:port. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LokiError';
  }
}

// ---------------------------------------------------------------------------
// Stream selectors
// ---------------------------------------------------------------------------

export const LOKI_MATCHER_OPS = ['=', '!=', '=~', '!~'] as const;
export type LokiMatcherOp = (typeof LOKI_MATCHER_OPS)[number];

export interface LokiMatcher {
  label: string;
  op: LokiMatcherOp;
  value: string;
}

export interface LokiStreamMappingLike {
  matchers: LokiMatcher[];
  /** Perfana tags (`frontend`, `db`) a query can target with `$entities[tag]`. Not Loki labels. */
  labels?: string[] | null;
}

const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** LogQL string literal: double-quoted, backslash, quote and newlines escaped. */
export function lokiQuote(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/** True when the (RE2-ish) pattern matches the empty string. JS regex is close enough to decide that. */
function regexMatchesEmpty(pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test('');
  } catch {
    return false;
  }
}

/**
 * Validate a mapping's matchers. Returns an error message, or null. Loki itself refuses a selector
 * whose every matcher accepts the empty string (`{app=~".*"}`), and a mapping that broad would read
 * every stream the datasource can see, so Perfana refuses it first, with a message that says why.
 */
export function validateMatchers(matchers: LokiMatcher[] | null | undefined): string | null {
  if (!Array.isArray(matchers) || matchers.length === 0) return 'A Loki mapping needs at least one label matcher';
  if (matchers.length > 20) return 'A Loki mapping takes at most 20 label matchers';
  for (const m of matchers) {
    if (!m || typeof m !== 'object') return 'Invalid label matcher';
    if (!LABEL_NAME_RE.test(m.label ?? '')) return `Invalid Loki label name: "${m.label ?? ''}"`;
    if (!(LOKI_MATCHER_OPS as readonly string[]).includes(m.op)) return `Invalid matcher operator: "${m.op}"`;
    if (typeof m.value !== 'string' || m.value.length > 500) return `Invalid value for label "${m.label}"`;
    if (m.op === '=~' || m.op === '!~') {
      try {
        new RegExp(m.value);
      } catch {
        return `The regex for label "${m.label}" is not valid`;
      }
    }
  }
  const positive = matchers.some((m) =>
    (m.op === '=' && m.value !== '') || (m.op === '=~' && !regexMatchesEmpty(m.value)));
  if (!positive) {
    return 'At least one matcher must select something: use = with a value, or =~ with a pattern that does not match the empty string';
  }
  return null;
}

/** `{app="shop", namespace=~"perf-.*"}`. Values are always escaped string literals. */
export function buildStreamSelector(matchers: LokiMatcher[]): string {
  return `{${matchers.map((m) => `${m.label}${m.op}${lokiQuote(m.value)}`).join(', ')}}`;
}

/** Human-readable form of a mapping, for series suffixes and the card. */
export function describeMatchers(matchers: LokiMatcher[]): string {
  return matchers.map((m) => `${m.label}${m.op}${JSON.stringify(m.value)}`).join(', ');
}

/** The mappings a query's `$entities` / `$entities[tag]` reference selects. */
export function selectMappings<T extends LokiStreamMappingLike>(logql: string, mappings: T[]): T[] {
  const tag = /^\s*\$entities(?:\[([^\]]+)\])?/.exec(logql)?.[1];
  return tag ? mappings.filter((m) => m.labels?.includes(tag)) : mappings;
}

// ---------------------------------------------------------------------------
// The user's pipeline
// ---------------------------------------------------------------------------

/**
 * Validate a panel's LogQL. It must be `$entities` (or `$entities[tag]`) followed only by pipeline
 * stages: line filters, parsers, label filters, formatters. Returns an error message, or null.
 *
 * The boundary is the stream selector, which Perfana writes: outside a string the query may not
 * contain `{`, `}`, `[` or `]`, so it can neither name another stream nor set its own range. The
 * aggregation, `unwrap` and the range are Perfana's (like Splunk's `| timechart`), so `unwrap`,
 * `offset` and a second `$` placeholder are refused too, and parentheses must balance so the
 * pipeline cannot close the function Perfana wraps around it. Quote-aware: anything is literal
 * inside "..." and `...` (raw strings, the usual way to write a regex in LogQL).
 */
export function validateLogqlPipeline(logql: string): string | null {
  if (typeof logql !== 'string' || !logql.trim()) return 'The query is empty';
  if (logql.length > 4000) return 'The query is longer than 4000 characters';
  const head = /^\s*\$entities(?:\[([^\]\s"'`{}$\\|]+)\])?/.exec(logql);
  if (!head) return 'A Loki query must start with $entities (or $entities[tag]): Perfana puts the mapped streams there';
  const rest = logql.slice(head[0].length);
  if (rest.trim() && !/^\s*[|!]/.test(rest)) {
    return 'After $entities only pipeline stages may follow, each starting with | (or a != / !~ line filter)';
  }
  let depth = 0;
  let unquoted = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === '"') {
      let closed = false;
      for (i++; i < rest.length; i++) {
        const c = rest[i]!;
        if (c === '\\') { i++; continue; }
        if (c === '$' && /^\$(entities|testRunId)\b/.test(rest.slice(i))) {
          return 'Use $entities and $testRunId outside a quoted string';
        }
        if (c === '"') { closed = true; break; }
      }
      if (!closed) return 'Unbalanced double quote';
      unquoted += ' ';
      continue;
    }
    if (ch === '`') {
      const end = rest.indexOf('`', i + 1);
      if (end < 0) return 'Unbalanced backtick';
      i = end;
      unquoted += ' ';
      continue;
    }
    if (ch === '{' || ch === '}') return 'Stream selectors ({...}) are not allowed: $entities is the selector';
    if (ch === '[' || ch === ']') return 'Leave out the range ([...]): Perfana sets it from the bucket size';
    if (ch === '#') return 'Comments (#) are not allowed';
    if (ch === '$') {
      if (/^\$testRunId\b/.test(rest.slice(i))) { i += '$testRunId'.length - 1; unquoted += ' '; continue; }
      return 'Only $entities (at the start) and $testRunId are placeholders';
    }
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return 'Unbalanced parentheses';
    unquoted += ch;
  }
  if (depth !== 0) return 'Unbalanced parentheses';
  const keyword = /(?<![\w.])(unwrap|offset|by|without|on|ignoring|group_left|group_right|bool)(?![\w.])/i.exec(unquoted);
  if (keyword) {
    const k = keyword[1]!.toLowerCase();
    return k === 'unwrap'
      ? 'Leave out "| unwrap": choose an aggregation such as avg(<field>) and Perfana unwraps it'
      : `"${k}" is not allowed in a Loki panel query: Perfana adds the aggregation and grouping`;
  }
  const fn = /(?<![\w.])(count_over_time|rate|bytes_over_time|bytes_rate|sum_over_time|avg_over_time|max_over_time|min_over_time|quantile_over_time|first_over_time|last_over_time|absent_over_time|stddev_over_time|stdvar_over_time|rate_counter|sum|avg|max|min|count|topk|bottomk|sort|sort_desc|vector|label_replace)\s*\(/i.exec(unquoted);
  if (fn) return `Leave out "${fn[1]}(": choose the aggregation in the panel settings`;
  return null;
}

// ---------------------------------------------------------------------------
// Metric queries
// ---------------------------------------------------------------------------

/** count | bytes | sum(f) | avg(f) | max(f) | min(f) | p50..p99(f) */
const AGGREGATION_RE = /^(count|bytes|(sum|avg|max|min|p\d{1,2})\(([a-zA-Z_][a-zA-Z0-9_]*)\))$/;

export interface ParsedAggregation {
  kind: 'count' | 'bytes' | 'sum' | 'avg' | 'max' | 'min' | 'quantile';
  field?: string;
  quantile?: number;
  /** How the same series from two mappings combine; null = they cannot, keep them apart. */
  combine: 'sum' | 'max' | 'min' | null;
}

export function parseAggregation(raw: string | null | undefined): ParsedAggregation {
  const agg = raw?.trim() || 'count';
  const m = AGGREGATION_RE.exec(agg);
  if (!m) throw new LokiError(`Unsupported aggregation: ${agg}. Use count, bytes, sum(field), avg(field), max(field), min(field) or p95(field)`);
  if (m[1] === 'count') return { kind: 'count', combine: 'sum' };
  if (m[1] === 'bytes') return { kind: 'bytes', combine: 'sum' };
  const fn = m[2]!;
  const field = m[3]!;
  if (fn.startsWith('p')) {
    const q = Number(fn.slice(1));
    if (!(q >= 1 && q <= 99)) throw new LokiError(`Unsupported percentile: ${fn}`);
    return { kind: 'quantile', field, quantile: q / 100, combine: null };
  }
  const kind = fn as 'sum' | 'avg' | 'max' | 'min';
  return { kind, field, combine: kind === 'sum' ? 'sum' : kind === 'max' ? 'max' : kind === 'min' ? 'min' : null };
}

/** Substitute `$testRunId` (always as a string literal) in the pipeline part. */
function expandPipeline(logql: string, testRunId?: string): string {
  const pipeline = logql.replace(/^\s*\$entities(?:\[[^\]]+\])?/, '');
  return testRunId === undefined ? pipeline : pipeline.replace(/\$testRunId\b/g, lokiQuote(testRunId));
}

export interface MetricQuerySpec {
  logql: string;
  aggregation?: string | null;
  splitBy?: string | null;
  bucketSeconds: number;
  testRunId?: string;
}

/**
 * The LogQL Perfana sends for one mapping: the mapping's selector, the user's pipeline, and
 * Perfana's own aggregation over `[bucket]`. Validates what it builds, so no caller can skip it.
 */
export function buildMetricExpr(mapping: LokiStreamMappingLike, spec: MetricQuerySpec): string {
  const problem = validateLogqlPipeline(spec.logql);
  if (problem) throw new LokiError(`Refusing to run the query: ${problem}`);
  const matcherProblem = validateMatchers(mapping.matchers);
  if (matcherProblem) throw new LokiError(`Refusing to run the query: ${matcherProblem}`);
  if (spec.splitBy && !LABEL_NAME_RE.test(spec.splitBy)) throw new LokiError(`Invalid split-by label: ${spec.splitBy}`);
  const agg = parseAggregation(spec.aggregation);
  const range = `[${Math.max(1, Math.round(spec.bucketSeconds))}s]`;
  const inner = `${buildStreamSelector(mapping.matchers)}${expandPipeline(spec.logql, spec.testRunId)}`.trim();
  // `by ()` on a range aggregation collapses every stream into one series (LogQL grammar allows the
  // empty grouping); without it an unwrapped aggregation keeps one series per stream.
  const by = `by (${spec.splitBy ?? ''})`;
  if (agg.kind === 'count' || agg.kind === 'bytes') {
    const fn = agg.kind === 'count' ? 'count_over_time' : 'bytes_over_time';
    return spec.splitBy ? `sum ${by} (${fn}(${inner} ${range}))` : `sum(${fn}(${inner} ${range}))`;
  }
  const unwrapped = `${inner} | unwrap ${agg.field} | __error__="" ${range}`;
  if (agg.kind === 'quantile') return `quantile_over_time(${agg.quantile}, ${unwrapped}) ${by}`;
  return `${agg.kind}_over_time(${unwrapped}) ${by}`;
}

/** A log (not metric) query for one mapping, e.g. for sample lines. */
export function buildLogExpr(mapping: LokiStreamMappingLike, pipeline = ''): string {
  return `${buildStreamSelector(mapping.matchers)}${pipeline ? ` ${pipeline}` : ''}`;
}

export interface LokiSeries {
  labels: Record<string, string>;
  points: Array<{ time: Date; value: number }>;
}

export interface LokiPoint {
  time: Date;
  series: string;
  value: number;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface LokiRequestOptions {
  timeoutMs?: number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** undici dispatcher from the org's proxy resolver, when the Grafana instance has use_proxy. */
  dispatcher?: unknown;
  /** Called after each metric/log query with the exact expression sent, for debug logs. */
  onQuery?: (expr: string, info: { frames: number; ms: number; from: Date; to: Date }) => void;
}

function baseUrl(conn: LokiConnection): string {
  return conn.baseUrl.replace(/\/+$/, '');
}

function requireAuth(conn: LokiConnection): string {
  const header = lokiAuthHeader(conn);
  if (!header) {
    throw new LokiError(`Grafana instance ${conn.label ?? hostForLog(conn.baseUrl)} has no credentials configured: set an API key, or a username and password`);
  }
  return header;
}

const RETRYABLE_RE = /too many outstanding requests|rate limit|max concurrent|concurrency limit|try again|temporarily unavailable/i;

async function request(conn: LokiConnection, path: string, init: RequestInit, opts: LokiRequestOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const authorization = requireAuth(conn);
  const headers: Record<string, string> = { Authorization: authorization, Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) };
  if (conn.grafanaOrgId && /^\d+$/.test(String(conn.grafanaOrgId))) headers['X-Grafana-Org-Id'] = String(conn.grafanaOrgId);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl(conn)}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      // Never follow a redirect: the Authorization header must only ever reach the configured host.
      redirect: 'error',
      ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
    } as RequestInit);
  } catch (err) {
    throw new LokiError(`Could not reach Grafana at ${hostForLog(conn.baseUrl)}: ${describeFetchError(err)}`, undefined, false, causeChain(err));
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = extractMessage(body) ?? (text && text.length < 300 ? text.trim() : null);
    if (res.status === 401) throw new LokiError('Grafana rejected the credentials (401)', 401);
    if (res.status === 403) throw new LokiError(`The Grafana service account may not query this datasource (403)${message ? `: ${message}` : ''}`, 403);
    if (res.status === 404 && /datasource|data source/i.test(message ?? '')) {
      throw new LokiError(`Grafana has no Loki datasource with uid "${conn.datasourceUid}" (404)`, 404);
    }
    throw new LokiError(message ? `Grafana/Loki: ${message}` : `Grafana answered HTTP ${res.status}`, res.status,
      res.status === 429 || res.status === 503 || RETRYABLE_RE.test(message ?? ''));
  }
  if (body === null) throw new LokiError('Grafana answered with something that is not JSON', res.status);
  return body;
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string' && b.message) return b.message;
  if (typeof b.error === 'string' && b.error) return b.error;
  const results = b.results as Record<string, { error?: string }> | undefined;
  if (results) {
    for (const r of Object.values(results)) if (r?.error) return r.error;
  }
  return null;
}

interface DsQueryFrame {
  schema?: { name?: string; fields?: Array<{ name?: string; type?: string; labels?: Record<string, string>; config?: Record<string, unknown> }> };
  data?: { values?: unknown[][] };
}

async function dsQuery(
  conn: LokiConnection,
  query: Record<string, unknown>,
  from: Date,
  to: Date,
  opts: LokiRequestOptions,
): Promise<DsQueryFrame[]> {
  const started = Date.now();
  const body = (await request(conn, '/api/ds/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queries: [{ refId: 'A', datasource: { type: 'loki', uid: conn.datasourceUid }, ...query }],
      from: String(from.getTime()),
      to: String(to.getTime()),
    }),
  }, opts)) as { results?: Record<string, { error?: string; status?: number; frames?: DsQueryFrame[] }> };
  const result = body.results?.A;
  if (!result) throw new LokiError('Grafana answered without a result for the query');
  if (result.error) {
    throw new LokiError(`Loki: ${result.error}`, result.status, result.status === 429 || result.status === 503 || RETRYABLE_RE.test(result.error));
  }
  const frames = result.frames ?? [];
  opts.onQuery?.(String(query.expr ?? ''), { frames: frames.length, ms: Date.now() - started, from, to });
  return frames;
}

/** Loki's resolution ceiling is 11,000 points per series; stay under it per request. */
const MAX_POINTS_PER_REQUEST = 10_000;

/**
 * Run a metric expression over [from, to] at `stepSeconds`, splitting the window so no request
 * asks for more than MAX_POINTS_PER_REQUEST points per series. `from`/`to` are the evaluation
 * timestamps (each sample covers the `stepSeconds` before it).
 */
export async function lokiRangeQuery(
  conn: LokiConnection,
  expr: string,
  from: Date,
  to: Date,
  stepSeconds: number,
  opts: LokiRequestOptions = {},
): Promise<LokiSeries[]> {
  const step = Math.max(1, Math.round(stepSeconds));
  const chunkMs = MAX_POINTS_PER_REQUEST * step * 1000;
  const byKey = new Map<string, LokiSeries>();
  for (let start = from.getTime(); start <= to.getTime(); start += chunkMs + step * 1000) {
    const end = Math.min(to.getTime(), start + chunkMs);
    const frames = await dsQuery(conn, {
      expr,
      queryType: 'range',
      step: `${step}s`,
      intervalMs: step * 1000,
      maxDataPoints: MAX_POINTS_PER_REQUEST + 1,
      legendFormat: '',
    }, new Date(start), new Date(end), opts);
    for (const s of framesToSeries(frames)) {
      const key = JSON.stringify(Object.entries(s.labels).sort());
      const existing = byKey.get(key);
      if (existing) existing.points.push(...s.points);
      else byKey.set(key, s);
    }
  }
  return [...byKey.values()];
}

/**
 * Data frames → series. Grafana 11 returns one dataplane frame per Loki series (a time field and
 * one number field carrying the labels); older versions can put several number fields in one
 * frame. Both shapes are read: every number field next to a time field is a series.
 */
export function framesToSeries(frames: DsQueryFrame[]): LokiSeries[] {
  const out: LokiSeries[] = [];
  for (const frame of frames ?? []) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const timeIdx = fields.findIndex((f) => f.type === 'time');
    if (timeIdx < 0) continue;
    const times = values[timeIdx] ?? [];
    fields.forEach((f, idx) => {
      if (idx === timeIdx || f.type !== 'number') return;
      const vals = values[idx] ?? [];
      const points: LokiSeries['points'] = [];
      for (let i = 0; i < times.length; i++) {
        const t = Number(times[i]);
        const v = vals[i] === null || vals[i] === undefined ? NaN : Number(vals[i]);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        points.push({ time: new Date(t), value: v });
      }
      out.push({ labels: { ...(f.labels ?? {}) }, points });
    });
  }
  return out;
}

export interface PanelQuery {
  logql: string;
  aggregation?: string | null;
  splitBy?: string | null;
  maxSeries?: number | null;
  /** Series name when the panel is not split. */
  panelTitle: string;
}

export interface PanelResult {
  points: LokiPoint[];
  /** Per-mapping expressions actually sent, for logs and the preview. */
  exprs: string[];
  /** Series the split produced before the top-N cap. */
  seriesBeforeCap: number;
}

/**
 * Everything one panel collects for a window: one metric query per mapping its `$entities`
 * selects, the same series from different mappings combined (summed for count/bytes/sum, max/min
 * for those, kept apart with a ` [mapping]` suffix for avg and percentiles, which cannot be
 * combined), capped at `maxSeries` (the rest summed into OTHER where that is meaningful), and each
 * sample moved to the START of its bucket so it lands on the same grid as every other source.
 *
 * Points sit on epoch-aligned buckets: ticks re-query overlapping windows and the ds_metrics write
 * upserts on `time`, so the grid must not move with the window.
 */
export async function lokiPanelPoints(
  conn: LokiConnection,
  panel: PanelQuery,
  mappings: LokiStreamMappingLike[],
  from: Date,
  to: Date,
  bucketSeconds: number,
  testRunId: string | undefined,
  opts: LokiRequestOptions = {},
): Promise<PanelResult> {
  const selected = selectMappings(panel.logql, mappings);
  const agg = parseAggregation(panel.aggregation);
  const bucket = Math.max(1, Math.round(bucketSeconds));
  const bucketMs = bucket * 1000;
  const firstEval = Math.floor(from.getTime() / bucketMs) * bucketMs + bucketMs;
  const lastEval = Math.ceil(to.getTime() / bucketMs) * bucketMs;
  const exprs: string[] = [];
  // series name → bucket start ms → value
  const combined = new Map<string, Map<number, number>>();
  for (const mapping of selected) {
    const expr = buildMetricExpr(mapping, { logql: panel.logql, aggregation: panel.aggregation, splitBy: panel.splitBy, bucketSeconds: bucket, testRunId });
    exprs.push(expr);
    const series = await lokiRangeQuery(conn, expr, new Date(firstEval), new Date(lastEval), bucket, opts);
    const suffix = agg.combine === null && selected.length > 1 ? ` [${describeMatchers(mapping.matchers)}]` : '';
    for (const s of series) {
      const base = panel.splitBy ? (s.labels[panel.splitBy] ?? '(none)') : panel.panelTitle;
      const name = `${base}${suffix}`;
      let byTime = combined.get(name);
      if (!byTime) combined.set(name, (byTime = new Map()));
      for (const p of s.points) {
        const t = p.time.getTime() - bucketMs;
        const prev = byTime.get(t);
        if (prev === undefined) byTime.set(t, p.value);
        else if (agg.combine === 'max') byTime.set(t, Math.max(prev, p.value));
        else if (agg.combine === 'min') byTime.set(t, Math.min(prev, p.value));
        else byTime.set(t, prev + p.value);
      }
    }
  }

  const limit = Math.max(1, Math.min(100, panel.maxSeries ?? 20));
  const ranked = [...combined.entries()]
    .map(([name, byTime]) => ({ name, byTime, total: [...byTime.values()].reduce((a, b) => a + Math.abs(b), 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const kept = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  if (rest.length > 0 && agg.combine === 'sum') {
    const other = new Map<number, number>();
    for (const r of rest) for (const [t, v] of r.byTime) other.set(t, (other.get(t) ?? 0) + v);
    const existing = kept.find((k) => k.name === 'OTHER');
    if (existing) for (const [t, v] of other) existing.byTime.set(t, (existing.byTime.get(t) ?? 0) + v);
    else kept.push({ name: 'OTHER', byTime: other, total: 0 });
  }

  // Count and bytes are zero where Loki has no sample: "zero errors" is the value an SLO wants,
  // and without it a bucket with no errors reads as missing and the mean is over error buckets only.
  const zeroFill = agg.kind === 'count' || agg.kind === 'bytes';
  const points: LokiPoint[] = [];
  for (const { name, byTime } of kept) {
    if (zeroFill) {
      for (let t = firstEval - bucketMs; t <= lastEval - bucketMs; t += bucketMs) {
        if (t + bucketMs <= from.getTime()) continue;
        points.push({ time: new Date(t), series: name, value: byTime.get(t) ?? 0 });
      }
    } else {
      for (const [t, v] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) points.push({ time: new Date(t), series: name, value: v });
    }
  }
  return { points, exprs, seriesBeforeCap: ranked.length };
}

// ---------------------------------------------------------------------------
// Log lines
// ---------------------------------------------------------------------------

export interface LokiLogLine {
  time: Date;
  line: string;
  labels: Record<string, string>;
}

/** Log frames → lines. Grafana 10+ names the fields labels/Time/Line; older ones ts/line/__labels. */
export function framesToLogLines(frames: DsQueryFrame[]): LokiLogLine[] {
  const out: LokiLogLine[] = [];
  for (const frame of frames ?? []) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const find = (...names: string[]) => fields.findIndex((f) => names.includes((f.name ?? '').toLowerCase()));
    const lineIdx = find('line', 'body', 'message');
    let timeIdx = find('time', 'ts', 'timestamp');
    if (timeIdx < 0) timeIdx = fields.findIndex((f) => f.type === 'time');
    const labelsIdx = find('labels', '__labels');
    if (lineIdx < 0 || timeIdx < 0) continue;
    const lines = values[lineIdx] ?? [];
    for (let i = 0; i < lines.length; i++) {
      const t = Number(values[timeIdx]?.[i]);
      const time = Number.isFinite(t) ? new Date(t) : new Date(String(values[timeIdx]?.[i]));
      if (Number.isNaN(time.getTime())) continue;
      let labels: Record<string, string> = {};
      const raw = labelsIdx >= 0 ? values[labelsIdx]?.[i] : fields[lineIdx]?.labels;
      if (raw && typeof raw === 'object') labels = raw as Record<string, string>;
      else if (typeof raw === 'string') {
        try { labels = JSON.parse(raw) as Record<string, string>; } catch { labels = {}; }
      }
      out.push({ time, line: String(lines[i] ?? ''), labels });
    }
  }
  return out.sort((a, b) => b.time.getTime() - a.time.getTime());
}

/** Newest log lines for a log expression in the window (Loki's `direction=backward`). */
export async function lokiLogLines(
  conn: LokiConnection,
  expr: string,
  from: Date,
  to: Date,
  limit: number,
  opts: LokiRequestOptions = {},
): Promise<LokiLogLine[]> {
  const frames = await dsQuery(conn, {
    expr,
    queryType: 'range',
    maxLines: Math.max(1, Math.min(5000, limit)),
    direction: 'backward',
    legendFormat: '',
  }, from, to, opts);
  return framesToLogLines(frames).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Resource calls: labels, values, patterns
// ---------------------------------------------------------------------------

// String arithmetic, not BigInt: apps/web imports this module and targets ES2015.
const nanos = (d: Date) => `${Math.floor(d.getTime())}000000`;

async function resource(conn: LokiConnection, path: string, params: Record<string, string>, opts: LokiRequestOptions): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  return request(
    conn,
    `/api/datasources/uid/${encodeURIComponent(conn.datasourceUid)}/resources/${path}${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
    { timeoutMs: 30_000, ...opts },
  );
}

/** Label names Loki has seen in the window (default: last hour). */
export async function lokiLabels(conn: LokiConnection, from: Date, to: Date, opts: LokiRequestOptions = {}): Promise<string[]> {
  const body = (await resource(conn, 'labels', { start: nanos(from), end: nanos(to) }, opts)) as { data?: unknown };
  return Array.isArray(body?.data) ? (body.data as unknown[]).map(String).filter((l) => !l.startsWith('__')).sort() : [];
}

/** Values of one label, optionally narrowed by a selector. */
export async function lokiLabelValues(
  conn: LokiConnection,
  label: string,
  from: Date,
  to: Date,
  selector?: string,
  opts: LokiRequestOptions = {},
): Promise<string[]> {
  if (!LABEL_NAME_RE.test(label)) throw new LokiError(`Invalid Loki label name: ${label}`);
  const params: Record<string, string> = { start: nanos(from), end: nanos(to) };
  if (selector) params.query = selector;
  const body = (await resource(conn, `label/${encodeURIComponent(label)}/values`, params, opts)) as { data?: unknown };
  return Array.isArray(body?.data) ? (body.data as unknown[]).map(String).sort() : [];
}

export interface LokiPattern {
  pattern: string;
  level: string | null;
  count: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

/**
 * Loki's detected log patterns for a selector (`/loki/api/v1/patterns`, Loki 3.0+ with the pattern
 * ingester enabled, proxied by Grafana 11+). Throws LokiError with status 404/400 when that is not
 * available; callers fall back to clustering sampled lines (`clusterLogLines`).
 * The pattern ingester keeps only recent hours, which is why patterns are snapshotted at analysis.
 */
export async function lokiPatterns(
  conn: LokiConnection,
  selector: string,
  from: Date,
  to: Date,
  stepSeconds: number,
  opts: LokiRequestOptions = {},
): Promise<LokiPattern[]> {
  const body = (await resource(conn, 'patterns', {
    query: selector,
    start: nanos(from),
    end: nanos(to),
    step: `${Math.max(1, Math.round(stepSeconds))}s`,
  }, { timeoutMs: 60_000, ...opts })) as { data?: Array<{ pattern?: string; level?: string; samples?: Array<[number | string, number | string]> }> };
  const rows = Array.isArray(body?.data) ? body.data : [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return rows
    .filter((r) => typeof r.pattern === 'string' && r.pattern)
    .map((r) => {
      let count = 0;
      let first: number | null = null;
      let last: number | null = null;
      for (const [ts, c] of r.samples ?? []) {
        const n = Number(c);
        // Samples are [epoch seconds, count]; the API can return buckets just outside the window.
        const ms = Number(ts) * 1000;
        if (!Number.isFinite(n) || !Number.isFinite(ms) || ms < fromMs - stepSeconds * 1000 || ms > toMs) continue;
        count += n;
        if (n > 0) {
          first = first === null ? ms : Math.min(first, ms);
          last = last === null ? ms : Math.max(last, ms);
        }
      }
      return {
        pattern: r.pattern!,
        level: r.level && r.level !== 'unknown' ? r.level.toLowerCase() : levelOfLine(r.pattern!),
        count,
        firstSeen: first === null ? null : new Date(first),
        lastSeen: last === null ? null : new Date(last),
      };
    })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Pattern fallback and levels
// ---------------------------------------------------------------------------

const ERROR_LEVELS = new Set(['error', 'err', 'fatal', 'critical', 'crit', 'panic', 'emerg', 'emergency', 'alert', 'severe']);
const WARN_LEVELS = new Set(['warn', 'warning']);

/** Normalised level of a level-label value: error | warn | info | debug | trace | the value itself. */
export function normalizeLevel(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  if (!v || v === 'unknown') return null;
  if (ERROR_LEVELS.has(v)) return 'error';
  if (WARN_LEVELS.has(v)) return 'warn';
  if (v === 'information' || v === 'notice') return 'info';
  return v;
}

export function isErrorLevel(raw: string | null | undefined): boolean {
  return normalizeLevel(raw) === 'error';
}

/** A level guessed from a line's text, for lines whose stream carries no level label. */
export function levelOfLine(line: string): string | null {
  const m = /\b(?:level|lvl|severity)["']?\s*[=:]\s*["']?([a-zA-Z]+)/i.exec(line)
    ?? /(?:^|[\s[|])(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE|CRITICAL|SEVERE)(?:[\s\]|:]|$)/.exec(line);
  return normalizeLevel(m?.[1]);
}

/** Collapse the variable parts of a log line, Drain-style, so repeats of one message group together. */
export function lineShape(line: string): string {
  return line
    .slice(0, 1000)
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<_>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<_>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<_>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<_>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<_>')
    .replace(/"(?:[^"\\]|\\.){24,}"/g, '"<_>"')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|m|h|b|kb|mb|gb)?\b/gi, '<_>')
    .replace(/(?:<_>[\s,.:/-]*){2,}/g, '<_> ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fallback when the patterns API is unavailable: group sampled lines by shape. Counts are over the sample. */
export function clusterLogLines(lines: LokiLogLine[], levelLabel?: string | null): LokiPattern[] {
  const groups = new Map<string, LokiPattern>();
  for (const l of lines) {
    const shape = lineShape(l.line);
    if (!shape) continue;
    const t = l.time.getTime();
    const g = groups.get(shape);
    if (g) {
      g.count++;
      if (!g.firstSeen || t < g.firstSeen.getTime()) g.firstSeen = l.time;
      if (!g.lastSeen || t > g.lastSeen.getTime()) g.lastSeen = l.time;
    } else {
      const level = normalizeLevel(levelLabel ? l.labels[levelLabel] : null) ?? normalizeLevel(l.labels.detected_level) ?? levelOfLine(l.line);
      groups.set(shape, { pattern: shape, level, count: 1, firstSeen: l.time, lastSeen: l.time });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Pattern text with whitespace and placeholder spellings unified, for matching across runs. */
export function patternKey(pattern: string): string {
  return pattern.replace(/<[^>]*>/g, '<_>').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Connection test, deep links, errors
// ---------------------------------------------------------------------------

export interface GrafanaLokiDatasource {
  uid: string;
  name: string;
  isDefault: boolean;
}

/**
 * The Loki datasources on a Grafana instance. `/api/frontend/settings` lists the datasources the
 * caller may query and answers for a Viewer; `/api/datasources` needs `datasources:read` (Admin)
 * and is only the fallback. When both refuse, the UI lets the uid be typed in.
 */
export async function grafanaLokiDatasources(
  conn: Omit<LokiConnection, 'datasourceUid'>,
  opts: LokiRequestOptions = {},
): Promise<GrafanaLokiDatasource[]> {
  const c: LokiConnection = { ...conn, datasourceUid: '' };
  try {
    const settings = (await request(c, '/api/frontend/settings', { method: 'GET' }, { timeoutMs: 15_000, ...opts })) as {
      datasources?: Record<string, { uid?: string; name?: string; type?: string; isDefault?: boolean }>;
    };
    const list = Object.entries(settings?.datasources ?? {})
      .filter(([, d]) => d?.type === 'loki' && d.uid)
      .map(([name, d]) => ({ uid: String(d.uid), name: d.name ?? name, isDefault: !!d.isDefault }));
    if (list.length > 0) return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (err instanceof LokiError && err.status === undefined) throw err; // unreachable: no point trying again
  }
  const all = (await request(c, '/api/datasources', { method: 'GET' }, { timeoutMs: 15_000, ...opts })) as Array<{ uid?: string; name?: string; type?: string; isDefault?: boolean }>;
  return (Array.isArray(all) ? all : [])
    .filter((d) => d?.type === 'loki' && d.uid)
    .map((d) => ({ uid: String(d.uid), name: String(d.name ?? d.uid), isDefault: !!d.isDefault }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Connection test: list labels over the last hour through the datasource. */
export async function lokiTestConnection(conn: LokiConnection, opts: LokiRequestOptions = {}): Promise<{ labels: string[] }> {
  const to = new Date();
  const from = new Date(to.getTime() - 3600_000);
  return { labels: await lokiLabels(conn, from, to, { timeoutMs: 15_000, ...opts }) };
}

/** Grafana Explore on the datasource, with the expression and window. `clientUrl` is browser-facing. */
export function lokiExploreUrl(
  clientUrl: string,
  grafanaOrgId: string | null | undefined,
  datasourceUid: string,
  expr: string,
  from: Date,
  to: Date,
): string {
  const panes = {
    a: {
      datasource: datasourceUid,
      queries: [{ refId: 'A', expr, queryType: 'range', datasource: { type: 'loki', uid: datasourceUid } }],
      range: { from: String(from.getTime()), to: String(to.getTime()) },
    },
  };
  const params = new URLSearchParams({ schemaVersion: '1', panes: JSON.stringify(panes) });
  if (grafanaOrgId && /^\d+$/.test(String(grafanaOrgId))) params.set('orgId', String(grafanaOrgId));
  return `${clientUrl.replace(/\/+$/, '')}/explore?${params.toString()}`;
}

/** A host for logs: scheme, hostname and port, never userinfo, path or query. */
export function hostForLog(host: string): string {
  try { const u = new URL(host); return `${u.protocol}//${u.host}`; } catch { return '[unparseable host]'; }
}

/** Code + fixed hint only; the raw cause carries the resolved IP:port (see the Splunk client). */
export function describeFetchError(err: unknown): string {
  const seen: Array<{ code?: string; name?: string }> = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const e = cur as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
    seen.push(e);
    cur = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  if (seen.length === 0) return 'Unknown error';
  if (seen[0]!.name === 'TimeoutError') return 'no answer within the time limit (timeout)';
  const code = seen.map((e) => e.code).find((c) => typeof c === 'string' && /^[A-Z0-9_]{2,64}$/.test(c));
  if (!code) return 'fetch failed';
  const hints: Record<string, string> = {
    ENOTFOUND: 'The Grafana hostname does not resolve from the Perfana server; set the instance\'s server URL to an address the API and worker can reach',
    ECONNREFUSED: 'Nothing listens on that Grafana port',
    ETIMEDOUT: 'No answer: a firewall is likely dropping the traffic, or the Grafana instance needs "Use proxy"',
    UND_ERR_CONNECT_TIMEOUT: 'No answer: a firewall is likely dropping the traffic, or the Grafana instance needs "Use proxy"',
  };
  const hint = hints[code] ?? (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? 'The Grafana TLS certificate is not trusted; add its CA through NODE_EXTRA_CA_CERTS on the API and worker' : undefined);
  return `${code}${hint ? `. ${hint}` : ''}`;
}

function causeChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const e = cur as { name?: string; code?: string; syscall?: string; hostname?: string; address?: string; port?: number; cause?: unknown; errors?: unknown[] };
    const fields = [e.name, e.code, e.syscall, e.hostname, e.address && `${e.address}${e.port ? `:${e.port}` : ''}`]
      .filter((f): f is string => typeof f === 'string' && /^[\w.:\-[\]]{1,255}$/.test(f));
    parts.push(fields.join(' ') || '?');
    cur = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  return parts.join(' <- ');
}
