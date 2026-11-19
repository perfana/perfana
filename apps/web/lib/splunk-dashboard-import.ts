// Turns an exported Splunk Dashboard Studio definition (the JSON behind "Edit > Source") into
// Perfana Splunk panels. Runs in the browser and creates nothing: the system config page's Splunk
// tab shows the result for review and then creates each panel through POST /splunk/queries, which
// validates the filter again (allowed commands, no time modifiers, $entities required).
//
// A Perfana panel is a FILTER plus one aggregation and an optional split-by field; Perfana itself
// adds the run window and `| timechart span=<bucket>`. So each dashboard search is split into:
//   - its leading search terms, with `index=` replaced by `$entities` (the mapped sources),
//   - the streaming commands Perfana allows after them (eval, where, rex, ...),
//   - one terminal reporting command (timechart / stats / top / chart over _time), which becomes
//     the aggregation and split-by.
// A search that does more than that (stats by an id followed by more computation, a generating
// command, a subsearch, a macro) has no Perfana equivalent and is reported as skipped, with why.

import { ALLOWED_SPL_COMMANDS, validateSplFilter } from '@perfana/shared/services/splunk/client';

/** Commands Perfana accepts after the leading terms: the API's own allowlist. */
const IMPORT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set(ALLOWED_SPL_COMMANDS);
/** Commands after the reporting command that only shape the table Splunk displays. */
const PRESENTATIONAL = new Set(['fields', 'table', 'rename', 'sort', 'head', 'tail', 'fillnull']);
const FIELD_RE = /^[A-Za-z_][\w.]*$/;
const AGG_FUNCS = new Set(['dc', 'avg', 'sum', 'min', 'max', 'median']);
const SPLUNK_TOKEN_RE = /\$[\w.:|-]+\$/;

export interface ImportedSplunkPanel {
  /** Stable key: the visualization id. */
  key: string;
  panelTitle: string;
  /** Splunk visualization type, e.g. splunk.line. */
  vizType: string;
  /** The search as it appears in the dashboard (chained searches joined). */
  sourceQuery: string;
  spl: string;
  aggregation: string;
  splitBy: string | null;
  maxSeries?: number;
  /** Indexes the original search named; they have to be mapped as sources for $entities to read them. */
  indexes: string[];
  /** Things changed or dropped on the way, worth a reader's attention. */
  notes: string[];
}

export interface SkippedSplunkPanel {
  key: string;
  panelTitle: string;
  sourceQuery: string | null;
  reason: string;
}

export interface SplunkDashboardImport {
  title: string;
  panels: ImportedSplunkPanel[];
  skipped: SkippedSplunkPanel[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse the text of an exported dashboard. Throws an Error with a readable message on bad input. */
export function parseSplunkDashboardJson(text: string): SplunkDashboardImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not valid JSON. Paste the dashboard definition from Splunk (Edit > Source).');
  }
  return convertSplunkDashboard(raw);
}

export function convertSplunkDashboard(raw: unknown): SplunkDashboardImport {
  let def: unknown = raw;
  // The REST API wraps a Studio definition: {"definition": "<json string>"} or an object.
  if (isObj(def) && def.definition !== undefined && def.visualizations === undefined) {
    def = typeof def.definition === 'string' ? safeParse(def.definition) : def.definition;
  }
  if (!isObj(def) || !isObj(def.visualizations) || !isObj(def.dataSources)) {
    throw new Error('No "visualizations" and "dataSources" found. Only Dashboard Studio (JSON) definitions can be imported, not Classic Simple XML.');
  }
  const dataSources = def.dataSources as Record<string, unknown>;
  const title = typeof def.title === 'string' && def.title.trim() ? def.title.trim() : 'Splunk dashboard';

  const panels: ImportedSplunkPanel[] = [];
  const skipped: SkippedSplunkPanel[] = [];
  const bySignature = new Map<string, ImportedSplunkPanel>();
  const titleCount = new Map<string, number>();

  for (const [key, vizRaw] of Object.entries(def.visualizations as Record<string, unknown>)) {
    if (!isObj(vizRaw)) continue;
    const primary = isObj(vizRaw.dataSources) ? vizRaw.dataSources.primary : undefined;
    // Rectangles, markdown, images: decoration with no search behind it.
    if (typeof primary !== 'string') continue;
    const vizType = typeof vizRaw.type === 'string' ? vizRaw.type : 'unknown';
    const ds = dataSources[primary];
    const dsName = isObj(ds) && typeof ds.name === 'string' ? ds.name : primary;
    const vizTitle = typeof vizRaw.title === 'string' && vizRaw.title.trim() ? vizRaw.title.trim() : dsName;

    const resolved = resolveQuery(primary, dataSources);
    if ('error' in resolved) {
      skipped.push({ key, panelTitle: vizTitle, sourceQuery: null, reason: resolved.error });
      continue;
    }
    const converted = convertSearch(resolved.query);
    if ('error' in converted) {
      skipped.push({ key, panelTitle: vizTitle, sourceQuery: resolved.query, reason: converted.error });
      continue;
    }

    const signature = `${converted.spl}\u0000${converted.aggregation}\u0000${converted.splitBy ?? ''}`;
    const twin = bySignature.get(signature);
    if (twin) {
      skipped.push({ key, panelTitle: vizTitle, sourceQuery: resolved.query, reason: `Same search as “${twin.panelTitle}”` });
      continue;
    }

    // Two different searches under one title would collide in Perfana's panel list.
    const seen = (titleCount.get(vizTitle) ?? 0) + 1;
    titleCount.set(vizTitle, seen);
    const panelTitle = seen > 1 ? `${vizTitle} (${seen})` : vizTitle;

    const panel: ImportedSplunkPanel = { key, panelTitle, vizType, sourceQuery: resolved.query, ...converted };
    bySignature.set(signature, panel);
    panels.push(panel);
  }
  return { title, panels, skipped };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The full search for a data source, following ds.chain `extend` links to the base search. */
function resolveQuery(id: string, dataSources: Record<string, unknown>): { query: string } | { error: string } {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = id;
  while (current) {
    if (visited.has(current)) return { error: 'The chained search refers back to itself' };
    visited.add(current);
    const ds: unknown = dataSources[current];
    if (!isObj(ds)) return { error: `Data source ${current} is missing from the dashboard` };
    const options = isObj(ds.options) ? ds.options : {};
    if (ds.type === 'ds.savedSearch' || ds.type === 'ds.search.saved') {
      return { error: 'A saved search (report) is referenced by name; its SPL is not in the dashboard' };
    }
    if (ds.type !== 'ds.search' && ds.type !== 'ds.chain') {
      return { error: `Data source type ${String(ds.type)} is not a search` };
    }
    const q = typeof options.query === 'string' ? options.query : '';
    if (q.trim()) parts.unshift(q.trim());
    current = ds.type === 'ds.chain' && typeof options.extend === 'string' ? options.extend : undefined;
  }
  // A chain's own query starts with a pipe; joining with a space keeps that pipe.
  const query = parts.join(' ').replace(/\s+/g, ' ').trim();
  return query ? { query } : { error: 'The data source has no query' };
}

/** Split on top-level pipes, respecting double quotes. Returns null on a subsearch or macro. */
function splitPipeline(query: string): string[] | { error: string } {
  const segments: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]!;
    if (inQuote) {
      current += ch;
      if (ch === '\\' && i + 1 < query.length) current += query[++i];
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '[') return { error: 'Subsearches ([ ... ]) cannot be imported' };
    else if (ch === '`') return { error: 'Search macros (backticks) cannot be imported; expand the macro in Splunk first' };
    if (ch === '|') {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current.trim());
  return segments;
}

/** Whitespace-separated terms, keeping double-quoted strings (and key="a b" pairs) whole. */
function splitTerms(segment: string): string[] {
  const terms: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (inQuote) {
      current += ch;
      if (ch === '\\' && i + 1 < segment.length) current += segment[++i];
      else if (ch === '"') inQuote = false;
    } else if (ch === '"') {
      inQuote = true;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current) terms.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) terms.push(current);
  return terms;
}

const commandOf = (segment: string) => segment.split(/\s+/)[0]?.toLowerCase() ?? '';

interface Converted {
  spl: string;
  aggregation: string;
  splitBy: string | null;
  maxSeries?: number;
  indexes: string[];
  notes: string[];
}

export function convertSearch(query: string): Converted | { error: string } {
  const split = splitPipeline(query);
  if (!Array.isArray(split)) return split;
  const segments = split;
  if (!segments[0]) {
    return { error: `Starts with a generating command (| ${commandOf(segments[1] ?? '')}), which Perfana cannot run` };
  }

  const notes: string[] = [];
  const indexes: string[] = [];
  const terms: string[] = [];
  const first = segments[0].replace(/^search\s+/i, '');
  for (const term of splitTerms(first)) {
    const index = /^index\s*=\s*"?([^"]+?)"?$/i.exec(term);
    if (index) {
      indexes.push(index[1]!);
      continue;
    }
    if (/^(_?index_)?(earliest|latest)\s*=/i.test(term)) {
      notes.push(`Dropped ${term}: Perfana sets the time range from the test run`);
      continue;
    }
    if (SPLUNK_TOKEN_RE.test(term)) {
      notes.push(`Dropped ${term}: dashboard tokens have no value outside Splunk`);
      continue;
    }
    terms.push(term);
  }
  if (indexes.length === 0) notes.push('The search names no index; $entities limits it to the mapped sources');

  const kept: string[] = [];
  let i = 1;
  for (; i < segments.length; i++) {
    const cmd = commandOf(segments[i]!);
    if (!IMPORT_ALLOWED_COMMANDS.has(cmd)) break;
    if (SPLUNK_TOKEN_RE.test(segments[i]!)) {
      return { error: `| ${segments[i]} uses a dashboard token, which has no value outside Splunk` };
    }
    kept.push(segments[i]!);
  }

  let aggregation = 'count';
  let splitBy: string | null = null;
  let maxSeries: number | undefined;
  if (i < segments.length) {
    const terminal = segments[i]!;
    const unknown = unsupportedReporting(commandOf(terminal));
    if (unknown) return { error: unknown };
    const rest = segments.slice(i + 1);
    // Checked before the terminal itself: "computes on its results" is the real reason such a
    // search cannot come across, whatever its stats functions are.
    const computing = rest.find((s) => !PRESENTATIONAL.has(commandOf(s)));
    if (computing !== undefined) {
      return { error: `| ${commandOf(terminal)} is followed by | ${commandOf(computing)}, which computes on its results; Perfana keeps one aggregation per time bucket` };
    }
    const parsed = parseReporting(terminal);
    if ('error' in parsed) return parsed;
    ({ aggregation, splitBy, maxSeries } = parsed);
    notes.push(...parsed.notes);
    if (rest.length > 0) notes.push(`Dropped ${rest.map((s) => `| ${commandOf(s)}`).join(' ')} (display only)`);
  }

  const spl = ['$entities', ...terms].join(' ') + kept.map((s) => ` | ${s}`).join('');
  // The same check the API runs on save, so a row that would be refused is reported here instead.
  const problem = validateSplFilter(spl, { timeModifiers: true });
  if (problem) return { error: `The converted filter would be refused: ${problem}` };
  return { spl, aggregation, splitBy, ...(maxSeries ? { maxSeries } : {}), indexes, notes };
}

interface Reporting {
  aggregation: string;
  splitBy: string | null;
  maxSeries?: number;
  notes: string[];
}

const REPORTING = new Set(['timechart', 'stats', 'chart', 'top', 'rare']);

function unsupportedReporting(cmd: string): string | null {
  if (REPORTING.has(cmd)) return null;
  return `| ${cmd} has no Perfana equivalent (allowed before the aggregation: ${[...IMPORT_ALLOWED_COMMANDS].join(', ')})`;
}

function parseReporting(segment: string): Reporting | { error: string } {
  const cmd = commandOf(segment);
  const args = splitTerms(segment).slice(1);
  if (cmd === 'top' || cmd === 'rare') {
    const options = args.filter((a) => /^\w+=/.test(a));
    const fields = args.filter((a) => !/^\w+=/.test(a) && a.toLowerCase() !== 'by');
    const limit = options.map((o) => /^limit=(\d+)$/i.exec(o)).find(Boolean);
    if (fields.length !== 1 || !FIELD_RE.test(fields[0]!)) return { error: `| ${cmd} over more than one field cannot be imported` };
    return {
      aggregation: 'count',
      splitBy: fields[0]!,
      maxSeries: limit ? Math.min(100, Number(limit[1])) || undefined : 10,
      notes: [`| ${cmd} ${fields[0]} became count by ${fields[0]} per time bucket`],
    };
  }
  const unknown = unsupportedReporting(cmd);
  if (unknown) return { error: unknown };

  const notes: string[] = [];
  let maxSeries: number | undefined;
  const rest: string[] = [];
  for (const a of args) {
    const opt = /^(\w+)=(.*)$/.exec(a);
    if (opt && !/[()]/.test(a)) {
      const name = opt[1]!.toLowerCase();
      if (name === 'limit' && /^\d+$/.test(opt[2]!)) maxSeries = Math.min(100, Number(opt[2])) || undefined;
      else if (name === 'span' || name === 'bins') notes.push(`Dropped ${a}: Perfana picks the bucket size from the run length`);
      continue;
    }
    if (SPLUNK_TOKEN_RE.test(a)) {
      notes.push(`Dropped ${a}: dashboard tokens have no value outside Splunk`);
      continue;
    }
    rest.push(a);
  }

  // [agg (as name)?]+ (over _time)? (by field)?
  const lower = rest.map((r) => r.toLowerCase());
  const overAt = lower.indexOf('over');
  const byAt = lower.indexOf('by');
  if (cmd === 'chart') {
    if (overAt < 0 || lower[overAt + 1] !== '_time') return { error: '| chart without "over _time" is not a time series' };
  }
  const aggEnd = [overAt, byAt].filter((n) => n >= 0).reduce((a, b) => Math.min(a, b), rest.length);
  const aggTerms = rest.slice(0, aggEnd);
  const byFields = byAt >= 0 ? rest.slice(byAt + 1).map((f) => f.replace(/,$/, '')).filter(Boolean) : [];

  const aggs: string[] = [];
  for (let k = 0; k < aggTerms.length; k++) {
    const t = aggTerms[k]!;
    if (t.toLowerCase() === 'as') { k++; continue; }
    aggs.push(t.replace(/,$/, ''));
  }
  if (aggs.length === 0) return { error: `| ${cmd} has no aggregation` };
  const aggregation = normalizeAggregation(aggs[0]!);
  if (!aggregation) return { error: `The aggregation ${aggs[0]} is not supported (count, dc, avg, sum, min, max, median, pNN)` };
  if (aggs.length > 1) notes.push(`Kept only the first aggregation (${aggregation}); dropped ${aggs.slice(1).join(', ')}`);

  if (byFields.length > 1) return { error: `| ${cmd} splits by more than one field (${byFields.join(', ')})` };
  const splitBy = byFields[0] ?? null;
  if (splitBy && !FIELD_RE.test(splitBy)) return { error: `The split-by field ${splitBy} is not a plain field name` };
  if (cmd === 'stats') {
    notes.push(splitBy
      ? `| stats ${aggregation} by ${splitBy} became a time series per ${splitBy}`
      : `| stats ${aggregation} became a time series per bucket`);
  }
  return { aggregation, splitBy, ...(maxSeries ? { maxSeries } : {}), notes };
}

/** A Splunk stats function in the shape Perfana's timechart accepts, or null. */
function normalizeAggregation(expr: string): string | null {
  const e = expr.trim();
  if (/^(c|count)(\(\s*\))?$/i.test(e)) return 'count';
  const m = /^(\w+)\(\s*"?([A-Za-z_][\w.]*)"?\s*\)$/.exec(e);
  if (!m) return null;
  let fn = m[1]!.toLowerCase();
  const field = m[2]!;
  if (fn === 'c' || fn === 'count') return 'count';
  if (fn === 'distinct_count') fn = 'dc';
  if (fn === 'mean') fn = 'avg';
  if (/^(p|perc)\d{1,2}$/.test(fn) || AGG_FUNCS.has(fn)) return `${fn}(${field})`;
  return null;
}
