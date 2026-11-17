/**
 * Splunk Platform REST client, shared by apps/api (connection test, discovery, preview) and
 * apps/worker (collection). Native fetch only: this module must not pull a dependency into an
 * app that does not declare it. Spec: docs/reference/Features/Splunk Log Metrics (spec).md.
 */

export interface SplunkCredentials {
  apiToken?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface SplunkConnection extends SplunkCredentials {
  /** Management URL, e.g. https://splunk.example.com:8089 — never Splunk Web's :8000. */
  host: string;
  splunkApp?: string | null;
  label?: string | null;
}

/** Same contract as grafanaAuthHeader: a token wins, else username + password, else null. */
export function splunkAuthHeader(creds: SplunkCredentials): string | null {
  const token = creds?.apiToken?.trim();
  if (token) return `Bearer ${token}`;
  const username = creds?.username?.trim();
  const password = creds?.password; // not trimmed: whitespace can be part of a password
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  return null;
}

export class SplunkError extends Error {
  constructor(
    message: string,
    /** HTTP status, or undefined for a connection-level failure. */
    readonly status?: number,
    /** True when Splunk refused the search for its concurrency quota; retry, do not fail the range. */
    readonly retryable = false,
    /** Raw cause chain, for server-side logs only: it can carry the resolved IP:port. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'SplunkError';
  }
}

/** Splunk string literal: double-quoted, with backslash and quote escaped. */
export function splQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface SplunkEntityMappingLike {
  indexName: string;
  sourcetype?: string | null;
  hostPattern?: string | null;
  labels?: string[] | null;
}

/**
 * The `$entities` expansion: one parenthesised clause per mapping, OR-ed. `label` keeps only
 * mappings carrying it (`$entities[backend]`). Returns null when nothing is in scope — the caller
 * must then not run the query at all.
 */
export function buildEntitiesClause(mappings: SplunkEntityMappingLike[], label?: string): string | null {
  const selected = label ? mappings.filter((m) => m.labels?.includes(label)) : mappings;
  if (selected.length === 0) return null;
  const clauses = selected.map((m) => {
    const parts = [`index=${splQuote(m.indexName)}`];
    if (m.sourcetype) parts.push(`sourcetype=${splQuote(m.sourcetype)}`);
    // A quoted value keeps Splunk's * wildcard, so host_pattern "app-*" still matches app-01.
    if (m.hostPattern) parts.push(`host=${splQuote(m.hostPattern)}`);
    return `(${parts.join(' ')})`;
  });
  return clauses.length === 1 ? clauses[0]! : `(${clauses.join(' OR ')})`;
}

/** Replace `$entities` / `$entities[label]` and `$testRunId`. Returns null if an `$entities` reference resolves to nothing. */
export function expandSplTemplate(
  spl: string,
  mappings: SplunkEntityMappingLike[],
  testRunId?: string,
): string | null {
  let empty = false;
  let out = spl.replace(/\$entities(?:\[([^\]]+)\])?/g, (_m, label?: string) => {
    const clause = buildEntitiesClause(mappings, label);
    if (clause === null) {
      empty = true;
      return '';
    }
    return clause;
  });
  if (testRunId !== undefined) out = out.replace(/\$testRunId/g, splQuote(testRunId));
  return empty ? null : out;
}

/**
 * The search a user filter actually runs as: the mapped sources FIRST, as their own search, and the
 * user's filter piped after it as `| search <filter>`. A later search can only narrow an earlier
 * one, so nothing a user writes — `$entities OR index=_audit` included — can read outside the
 * mapped sources. The outer clause is the union of the mappings every `$entities[...]` reference in
 * the filter names (all mappings for a bare `$entities`). Returns null when that is empty.
 */
export function scopeSplFilter(
  spl: string,
  mappings: SplunkEntityMappingLike[],
  testRunId?: string,
): string | null {
  // undefined = a bare $entities (every mapping); a string = $entities[label].
  const labels: Array<string | undefined> = [...spl.matchAll(/\$entities(?:\[([^\]]+)\])?/g)].map((m) => m[1]);
  if (labels.length === 0) return null;
  const scoped = labels.includes(undefined)
    ? mappings
    : mappings.filter((m) => labels.some((l) => l && m.labels?.includes(l)));
  const outer = buildEntitiesClause(scoped);
  const user = expandSplTemplate(spl, mappings, testRunId);
  if (outer === null || user === null) return null;
  return `${outer} | search ${user}`;
}

/**
 * Commands a Perfana filter may pipe through. An allowlist, because a denylist of "dangerous"
 * commands is always one command short. Everything here is a streaming, read-only transform;
 * Perfana appends `| timechart` itself. The Splunk role behind the token is still the real
 * boundary (read-only, limited indexes) — this check keeps an org member from using the org's
 * token for more than shaping a time series.
 */
export const ALLOWED_SPL_COMMANDS = ['search', 'where', 'rex', 'eval', 'fields', 'rename', 'regex', 'spath', 'fillnull'] as const;

/**
 * Validate a user filter. Returns an error message, or null when it is acceptable.
 * Quote-aware: `|`, `[` and backticks inside a double-quoted string (a rex pattern) are literal.
 */
export function validateSplFilter(spl: string): string | null {
  const segments: string[] = [];
  let current = '';
  let inQuote = false;
  let inSingle = false;
  for (let i = 0; i < spl.length; i++) {
    const ch = spl[i]!;
    if (inSingle) {
      // eval/where read '...' as a field name. A double quote, pipe, bracket or backtick inside
      // one would desynchronise this tokenizer from Splunk's (`'"' | outputlookup x | '"'` looks
      // like one double-quoted string here), so none of them is allowed in a single-quoted name.
      if (ch === '"' || ch === '|' || ch === '[' || ch === '`' || ch === '$' || ch === '\\') {
        return 'A single-quoted field name may not contain quotes, pipes, brackets, backticks, $ or backslashes';
      }
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inQuote) {
      // A placeholder expands to quoted text, which would close this string and turn the rest of
      // it into SPL. Placeholders belong outside strings.
      if (ch === '$' && /^\$(entities|testRunId)\b/.test(spl.slice(i))) {
        return 'Use $entities and $testRunId outside a quoted string';
      }
      current += ch;
      if (ch === '\\' && i + 1 < spl.length) {
        current += spl[++i];
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '\\') {
      // Outside a string Splunk reads \" as an escaped quote, not the start of one; treating it
      // as an opening quote here would hide a following pipe from the allowlist. Refuse instead.
      return 'A backslash is only allowed inside a double-quoted string';
    } else if (ch === '"') {
      inQuote = true;
      current += ch;
    } else if (ch === "'") {
      inSingle = true;
      current += ch;
    } else if (ch === '$' && /^\$entities\[[^\]\s"'|`[$\\]+\]/.test(spl.slice(i))) {
      // A labelled reference is expanded by Perfana before the search runs; its brackets are not a subsearch.
      const token = /^\$entities\[[^\]\s"'|`[$\\]+\]/.exec(spl.slice(i))![0];
      current += token;
      i += token.length - 1;
    } else if (ch === '`') {
      return 'Search macros (backticks) are not allowed';
    } else if (ch === '[') {
      return 'Subsearches ([ ... ]) are not allowed';
    } else if (ch === '|') {
      segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (inQuote) return 'Unbalanced double quote';
  if (inSingle) return 'Unbalanced single quote';
  segments.push(current);
  if (!segments[0]!.trim()) return 'The filter must start with search terms, not a pipe';
  for (const seg of segments.slice(1)) {
    const cmd = seg.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!(ALLOWED_SPL_COMMANDS as readonly string[]).includes(cmd)) {
      return `The SPL command "${cmd || '(empty)'}" is not allowed. Allowed after a pipe: ${ALLOWED_SPL_COMMANDS.join(', ')}`;
    }
  }
  return null;
}

export interface TimechartQuery {
  /** Expanded filter (no time bounds, no timechart). */
  filter: string;
  from: Date;
  to: Date;
  bucketSeconds: number;
  /** count | dc(field) | avg(field) | p95(field) ... */
  aggregation?: string | null;
  splitBy?: string | null;
  maxSeries?: number | null;
}

const AGGREGATION_RE = /^(count|(dc|avg|sum|min|max|median|p\d{1,2}|perc\d{1,2})\([A-Za-z_][\w.]*\))$/;
const FIELD_RE = /^[A-Za-z_][\w.]*$/;

/** Perfana owns the time bounds and bucketing; the user only ever writes `filter`. */
export function buildTimechartSearch(q: TimechartQuery): string {
  const aggregation = q.aggregation?.trim() || 'count';
  if (!AGGREGATION_RE.test(aggregation)) throw new SplunkError(`Unsupported aggregation: ${aggregation}`);
  if (q.splitBy && !FIELD_RE.test(q.splitBy)) throw new SplunkError(`Invalid split-by field: ${q.splitBy}`);
  const span = Math.max(1, Math.round(q.bucketSeconds));
  const limit = Math.max(1, Math.min(100, q.maxSeries ?? 20));
  const earliest = Math.floor(q.from.getTime() / 1000);
  const latest = Math.ceil(q.to.getTime() / 1000);
  const by = q.splitBy ? ` by ${q.splitBy} limit=${limit} useother=t` : '';
  const filter = q.filter.trim().replace(/^search\s+/i, '');
  // Validate what is actually sent, after expansion — not only what was saved.
  const problem = validateSplFilter(filter);
  if (problem) throw new SplunkError(`Refusing to run the search: ${problem}`);
  // The bounds go FIRST: after a filter that pipes (| rex ...) they would be read as the last
  // command's arguments instead of bounding the search.
  return `search earliest=${earliest} latest=${latest} ${filter} | timechart span=${span}s ${aggregation}${by}`;
}

export interface TimechartPoint {
  time: Date;
  series: string;
  value: number;
}

/**
 * Parse an export stream body (output_mode=json: one JSON object per line). Throws SplunkError on
 * a FATAL/ERROR message line — a failed search must never read as "collected, 0 points".
 */
export function parseExportLines(body: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // A truncated last line means the stream was cut — that is a failure, not a short result.
      throw new SplunkError('Splunk export stream ended mid-record');
    }
    const messages = obj.messages as Array<{ type?: string; text?: string }> | undefined;
    const fatal = messages?.find((m) => m.type === 'FATAL' || m.type === 'ERROR');
    if (fatal) throw toSearchError(fatal.text ?? 'Splunk search failed');
    // A transforming search can stream interim preview result sets before the final one; only the
    // final rows count, or totals double up.
    if (obj.preview === true) continue;
    if (obj.result && typeof obj.result === 'object') rows.push(obj.result as Record<string, unknown>);
  }
  return rows;
}

/** Timechart rows → points. Every non-underscore key is a series; empty/NaN cells are skipped, 0 is kept. */
export function timechartRowsToPoints(rows: Array<Record<string, unknown>>): TimechartPoint[] {
  const points: TimechartPoint[] = [];
  for (const row of rows) {
    const time = new Date(String(row._time));
    if (Number.isNaN(time.getTime())) continue;
    for (const [key, raw] of Object.entries(row)) {
      if (key.startsWith('_')) continue;
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      points.push({ time, series: key, value });
    }
  }
  return points;
}

function toSearchError(text: string, status?: number): SplunkError {
  const retryable = /concurrent|quota|maximum number of/i.test(text) || status === 503;
  return new SplunkError(text, status, retryable);
}

export interface SplunkRequestOptions {
  timeoutMs?: number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** undici dispatcher from the org's proxy resolver, when the config has use_proxy. */
  dispatcher?: unknown;
}

function baseUrl(conn: SplunkConnection): string {
  return conn.host.replace(/\/+$/, '');
}

function requireAuth(conn: SplunkConnection): string {
  const header = splunkAuthHeader(conn);
  if (!header) {
    throw new SplunkError(`Splunk connection ${conn.label ?? conn.host} has neither a token nor a username and password`);
  }
  return header;
}

async function request(
  conn: SplunkConnection,
  path: string,
  init: RequestInit,
  opts: SplunkRequestOptions,
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  // Outside the try: missing credentials are a configuration error, not "could not reach".
  const authorization = requireAuth(conn);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl(conn)}${path}`, {
      ...init,
      headers: { Authorization: authorization, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      // Never follow a redirect: the Authorization header must only ever reach the configured host.
      redirect: 'error',
      ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
    } as RequestInit);
  } catch (err) {
    throw new SplunkError(`Could not reach Splunk at ${hostForLog(conn.host)}: ${describeFetchError(err)}`, undefined, false, causeChain(err));
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new SplunkError('Splunk rejected the credentials (401)', 401);
    if (res.status === 403) throw new SplunkError('The Splunk token lacks permission for this call (403)', 403);
    throw toSearchError(extractMessage(text) ?? `Splunk answered HTTP ${res.status}`, res.status);
  }
  return text;
}

/**
 * undici reports every network failure as "fetch failed" and keeps the reason in `cause`
 * (sometimes nested once more, or as an AggregateError for a dual-stack connect). Surface the code
 * and a hint for it, because "fetch failed" alone sends the operator looking in the wrong place.
 */
export function describeFetchError(err: unknown): string {
  const seen: Array<{ code?: string; message?: string }> = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown; errors?: unknown[] };
    seen.push(e);
    cur = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  if (seen.length === 0) return 'Unknown error';
  if ((seen[0] as Error).name === 'TimeoutError') return 'no answer within the time limit (timeout)';
  // ponytail: code + fixed hint only. The raw cause message carries the resolved IP:port, which
  // would make this an internal-network oracle for anyone allowed to test a connection.
  const code = seen.map((e) => e.code).find((c) => typeof c === 'string' && /^[A-Z0-9_]{2,64}$/.test(c));
  if (!code) return 'fetch failed';
  const hint = FETCH_ERROR_HINTS[code] ?? (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? FETCH_ERROR_HINTS.CERT : undefined);
  return `${code}${hint ? `. ${hint}` : ''}`;
}

/** A host for logs: scheme, hostname and port, never userinfo, path or query. */
export function hostForLog(host: string): string {
  try { const u = new URL(host); return `${u.protocol}//${u.host}`; } catch { return '[unparseable host]'; }
}

function causeChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    // Structured fields only, never message text: a message is free-form and could echo a header.
    const e = cur as { name?: string; code?: string; syscall?: string; hostname?: string; address?: string; port?: number; cause?: unknown; errors?: unknown[] };
    const fields = [e.name, e.code, e.syscall, e.hostname, e.address && `${e.address}${e.port ? `:${e.port}` : ''}`]
      .filter((f): f is string => typeof f === 'string' && /^[\w.:\-[\]]{1,255}$/.test(f));
    parts.push(fields.join(' ') || '?');
    cur = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  return parts.join(' <- ');
}

const FETCH_ERROR_HINTS: Record<string, string> = {
  ENOTFOUND: 'The hostname does not resolve from the Perfana server; check the name, or the DNS the API and worker containers use',
  EAI_AGAIN: 'DNS lookup failed temporarily; check the DNS the API and worker containers use',
  ECONNREFUSED: 'The host answered but nothing listens on that port; the management port is usually 8089',
  ECONNRESET: 'The connection was cut; often a firewall or proxy in between, or http:// against an https port',
  ETIMEDOUT: 'No answer: a firewall or IP allow list is likely dropping the traffic, or a proxy is needed (enable "Use proxy")',
  UND_ERR_CONNECT_TIMEOUT: 'No answer: a firewall or IP allow list is likely dropping the traffic, or a proxy is needed (enable "Use proxy")',
  EHOSTUNREACH: 'No route to the host from the Perfana server; a proxy may be needed (enable "Use proxy")',
  ENETUNREACH: 'No route to the host from the Perfana server; a proxy may be needed (enable "Use proxy")',
  CERT: 'The TLS certificate is not trusted by the Perfana server. Splunk ships a self-signed certificate on 8089; add the issuing CA through NODE_EXTRA_CA_CERTS on the API and worker',
  ERR_SSL_WRONG_VERSION_NUMBER: 'The port does not speak TLS; try http:// or check the port',
};

function extractMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ text?: string }> };
    return parsed.messages?.[0]?.text ?? null;
  } catch {
    const m = /<msg[^>]*>([^<]+)<\/msg>/.exec(body);
    return m?.[1] ?? null;
  }
}

/** Run a search through the v2 export endpoint and return its result rows. */
export async function splunkExport(
  conn: SplunkConnection,
  search: string,
  opts: SplunkRequestOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const app = encodeURIComponent(conn.splunkApp?.trim() || 'search');
  const body = new URLSearchParams({ search, output_mode: 'json' });
  const text = await request(
    conn,
    `/servicesNS/-/${app}/search/v2/jobs/export`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    opts,
  );
  return parseExportLines(text);
}

export async function splunkTimechart(
  conn: SplunkConnection,
  q: TimechartQuery,
  opts: SplunkRequestOptions = {},
): Promise<TimechartPoint[]> {
  return timechartRowsToPoints(await splunkExport(conn, buildTimechartSearch(q), opts));
}

export interface SplunkServerInfo {
  serverName?: string;
  version?: string;
}

/** Connection test: GET /services/server/info. */
export async function splunkServerInfo(conn: SplunkConnection, opts: SplunkRequestOptions = {}): Promise<SplunkServerInfo> {
  const text = await request(conn, '/services/server/info?output_mode=json', { method: 'GET' }, { timeoutMs: 10_000, ...opts });
  const content = (JSON.parse(text) as { entry?: Array<{ content?: Record<string, unknown> }> }).entry?.[0]?.content ?? {};
  return { serverName: content.serverName as string | undefined, version: content.version as string | undefined };
}

export interface SplunkDiscoveredSource {
  index: string;
  sourcetype: string;
  host: string;
  count: number;
}

/** One tstats search: index-time metadata only, so it is fast and limited to the role's indexes. */
export async function splunkDiscoverSources(
  conn: SplunkConnection,
  lookbackHours = 24,
  opts: SplunkRequestOptions = {},
): Promise<SplunkDiscoveredSource[]> {
  const hours = Math.max(1, Math.min(24 * 30, Math.round(lookbackHours)));
  const rows = await splunkExport(
    conn,
    `| tstats count where index=* earliest=-${hours}h by index, sourcetype, host | sort 0 - count | head 5000`,
    opts,
  );
  return rows.map((r) => ({
    index: String(r.index ?? ''),
    sourcetype: String(r.sourcetype ?? ''),
    host: String(r.host ?? ''),
    count: Number(r.count ?? 0),
  }));
}

/** Candidate fields for split_by, from a sample of the filter's events. */
export async function splunkFieldSummary(
  conn: SplunkConnection,
  filter: string,
  opts: SplunkRequestOptions = {},
): Promise<Array<{ field: string; distinctCount: number; values: string[] }>> {
  const problem = validateSplFilter(filter);
  if (problem) throw new SplunkError(`Refusing to run the search: ${problem}`);
  const rows = await splunkExport(
    conn,
    `search earliest=-1h ${filter} | head 2000 | fieldsummary maxvals=10 | where distinct_count <= 50 | table field distinct_count values`,
    opts,
  );
  return rows
    .filter((r) => typeof r.field === 'string' && !String(r.field).startsWith('_'))
    .map((r) => {
      let values: string[] = [];
      try {
        values = (JSON.parse(String(r.values ?? '[]')) as Array<{ value: string }>).map((v) => v.value);
      } catch {
        values = [];
      }
      return { field: String(r.field), distinctCount: Number(r.distinct_count ?? 0), values };
    });
}
