import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { LokiService } from '../../loki/loki.service';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  emptyState,
  escapeHtml,
  formatInt,
  formatNum,
  pill,
  sectionHeader,
  sectionText,
  statCard,
  warningState,
  type PillKind,
} from './report-style';

type Summary = Awaited<ReturnType<LokiService['reportSummary']>>;
type Configured = Extract<Summary, { configured: true }>;
type ErrorRate = NonNullable<Configured['errorRate']>;

/** Section config, all optional: an empty config is the recommended default. */
export interface LokiLogsSectionConfig {
  includeApplications?: boolean;
  includePatterns?: boolean;
  /** Only patterns absent from every baseline run. */
  onlyNewPatterns?: boolean;
  /** Which pattern levels to list. */
  patternLevels?: 'error' | 'warn' | 'all';
  includeSamples?: boolean;
  includePanels?: boolean;
  /** Rows per table. */
  maxRows?: number;
  /** Narrow the whole section to these values of the connection's application label. */
  services?: string[];
}

export const LOKI_DEFAULT_MAX_ROWS = 10;
const MAX_ROWS_CAP = 50;
const SAMPLE_LINE_CHARS = 500;
const PATTERN_CHARS = 300;
// Same rule as the Loki card's errorRateTrend, so the report and the card agree on "rose".
const WORSE_RATIO = 1.5;
const MIN_PCT_POINTS = 0.1;

const TD = `padding:8px 12px; border-bottom:1px solid ${REPORT_COLORS.rowBorder}; vertical-align:top;`;
const TD_NUM = `${TD} text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap;`;
const CODE = `font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px; white-space:pre-wrap; word-break:break-word;`;

/** Untrusted section config → the settings the renderer uses. */
export function lokiSettings(raw: Record<string, unknown> | undefined) {
  const c = (raw ?? {}) as LokiLogsSectionConfig;
  const n = Number(c.maxRows);
  return {
    applications: c.includeApplications !== false,
    patterns: c.includePatterns !== false,
    onlyNew: c.onlyNewPatterns === true,
    levels: c.patternLevels === 'error' || c.patternLevels === 'all' ? c.patternLevels : 'warn',
    samples: c.includeSamples === true,
    panels: c.includePanels === true,
    maxRows: Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_ROWS_CAP) : LOKI_DEFAULT_MAX_ROWS,
    services: Array.isArray(c.services) ? c.services.filter((s): s is string => typeof s === 'string' && s !== '') : [],
  };
}

/** 'worse' | 'better' | 'same' | null — the Loki card's rule. */
export function errorRateTrend(now: number, was: number | null | undefined): 'worse' | 'better' | 'same' | null {
  if (was === null || was === undefined) return null;
  if (Math.abs(now - was) < MIN_PCT_POINTS) return 'same';
  if (was === 0) return now > 0 ? 'worse' : 'same';
  const ratio = now / was;
  return ratio >= WORSE_RATIO ? 'worse' : ratio <= 1 / WORSE_RATIO ? 'better' : 'same';
}

const TREND_PILL: Record<'worse' | 'better' | 'same', [string, PillKind]> = {
  worse: ['Higher', 'bad'],
  better: ['Lower', 'good'],
  same: ['In line', 'neutral'],
};
const LEVEL_KIND: Record<string, PillKind> = { error: 'bad', warn: 'warn', info: 'info' };
// A level is free text from the logs: 'constructor' must not resolve to an inherited member.
const levelKind = (level: string): PillKind => (Object.hasOwn(LEVEL_KIND, level) ? LEVEL_KIND[level]! : 'neutral');

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0.01 && v > 0 ? '<0.01' : v.toFixed(2)}%`);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const link = (href: string | null | undefined, label: string) =>
  href && /^https?:\/\//i.test(href) ? `<a href="${escapeHtml(href)}" style="color:${REPORT_COLORS.primary};">${escapeHtml(label)}</a>` : '';

/**
 * The report's Loki Logs section: the Loki Logs card's findings for the run (error rate against its
 * baseline, applications, top log patterns marked NEW, latest error lines, panel totals). Read from
 * the analysis snapshot through LokiService, never from Loki, so a stored report does not depend on
 * Loki's retention. Plain tables, tiles, pills and https links only, which the Confluence converter
 * (`modules/confluence/storage-format.ts`) turns into tables, status lozenges and links.
 */
@Injectable()
export class LokiLogsRenderer {
  private readonly logger = new Logger(LokiLogsRenderer.name);

  constructor(private readonly loki: LokiService) {}

  async renderLokiLogsSection(section: ReportSectionConfig, testRun: TestRun | null, userId = '', roles: string[] = []): Promise<string> {
    const title = section.title || 'Loki Logs';
    const text = getSectionText(section);
    const s = lokiSettings(section.config);
    if (!testRun) return this.wrap(title, text, [], emptyState('No test run data available for the Loki logs.'));

    let summary: Summary;
    try {
      summary = await this.loki.reportSummary(testRun.testRunId, userId, roles);
    } catch (error) {
      this.logger.warn(`Loki logs section failed for ${testRun.testRunId}`, error);
      return this.wrap(title, text, [], warningState('Loki log data could not be loaded.'));
    }
    if (!summary.configured) {
      return this.wrap(title, text, [], emptyState('No Loki panels are configured for this workload.'));
    }
    return this.wrap(title, text, this.baselineChips(summary), renderBody(summary, s));
  }

  private baselineChips(summary: Configured): string[] {
    const n = summary.baseline.testRunIds.length;
    const label =
      summary.baseline.kind === 'control-group' ? `vs control group (${n} run${n === 1 ? '' : 's'})`
        : summary.baseline.kind === 'previous-runs' ? `vs ${n} previous run${n === 1 ? '' : 's'}`
          : summary.baseline.kind === 'run' ? 'vs 1 baseline run'
            : 'no baseline';
    return [chip(label, 'neutral')];
  }

  private wrap(title: string, text: string | undefined, chips: string[], body: string): string {
    return `
      <section class="loki-logs-section">
        ${sectionHeader(title, { chipsHtml: chips })}
        ${sectionText(text)}
        ${body}
      </section>
    `;
  }
}

/** Exported for the spec: the section body for one summary. */
export function renderBody(summary: Configured, s: ReturnType<typeof lokiSettings>): string {
  const only = s.services.length > 0 ? new Set(s.services) : null;
  const services = summary.services.filter((x) => !only || only.has(x.service));
  const parts: string[] = [];

  // Headline: the whole run, or the chosen applications pooled.
  let rate: { pct: number; lines: number; errors: number; baseline: { errorRatePct: number; runs: number } | null } | null = null;
  if (only) {
    const lines = services.reduce((a, x) => a + x.totalLines, 0);
    const errors = services.reduce((a, x) => a + x.errorLines, 0);
    // No level label means no error lines to count: show no rate rather than a 0% that reads as clean,
    // as LokiService does for the whole run.
    rate = lines > 0 && !summary.levelLabelMissing ? { pct: (errors / lines) * 100, lines, errors, baseline: null } : null;
  } else if (summary.errorRate) {
    const r: ErrorRate = summary.errorRate;
    rate = { pct: r.errorRatePct, lines: r.totalLines, errors: r.errorLines, baseline: r.baseline };
  }

  if (summary.levelLabelMissing) {
    parts.push(warningState(`No log line of this run carries the level label "${summary.connection?.levelLabel ?? ''}", so there is no error rate. Set the Loki connection's level parser and re-analyse the run.`));
  }

  const trend = rate ? errorRateTrend(rate.pct, rate.baseline?.errorRatePct) : null;
  const newPatterns = only
    ? sumNullable(services.map((x) => x.newPatterns))
    : summary.newPatterns;
  const tiles = [
    statCard('Error rate', pct(rate?.pct), trend ? `${pill(TREND_PILL[trend][0], TREND_PILL[trend][1])} <span style="color:${REPORT_COLORS.mutedInk}; font-size:12px;">baseline ${pct(rate?.baseline?.errorRatePct)}</span>` : ''),
    statCard('Log lines', formatInt(rate?.lines ?? (services.length ? services.reduce((a, x) => a + x.totalLines, 0) : null))),
    statCard('Error lines', formatInt(rate?.errors ?? null)),
    statCard('New patterns', newPatterns === null ? '—' : formatInt(newPatterns)),
  ];
  parts.push(`<div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; margin:8px 0 20px;">${tiles.join('')}</div>`);

  if (s.applications && services.length > 0) parts.push(applicationsTable(services.slice(0, s.maxRows), services.length, summary.connection?.serviceLabel ?? 'service_name', summary.levelLabelMissing));
  if (s.patterns) parts.push(patternsTable(summary, s, only));
  if (s.samples) parts.push(samplesTable(summary, s, only));
  if (s.panels) parts.push(panelsTable(summary, s.maxRows));
  if (summary.exploreUrl) parts.push(`<p style="margin-top:12px; font-size:12px;">${link(summary.exploreUrl, 'Open all streams of this run in Grafana Explore')}</p>`);
  return parts.join('');
}

function sumNullable(xs: Array<number | null>): number | null {
  return xs.length === 0 || xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0);
}

function table(head: string, rows: string[], caption: string): string {
  return `
    <h3 style="margin:24px 0 8px; font-size:14px; color:${REPORT_COLORS.ink};">${escapeHtml(caption)}</h3>
    <div class="table-scroll">
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr style="${THEAD_ROW}">${head}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

function applicationsTable(rows: Configured['services'], total: number, label: string, noLevel: boolean): string {
  const head = `<th style="${TH_TEXT}">Application (${escapeHtml(label)})</th><th style="${TH_NUM}">Lines</th><th style="${TH_NUM}">Errors</th><th style="${TH_NUM}">Warnings</th><th style="${TH_NUM}">Error rate</th><th style="${TH_NUM}">Baseline</th><th style="${TH_TEXT}">Status</th>`;
  const body = rows.map((x) => {
    const t = noLevel ? null : errorRateTrend(x.errorRatePct, x.baseline?.errorRatePct);
    const status = [
      x.isNew ? pill('New', 'warn') : '',
      t === 'worse' ? pill('Higher', 'bad') : t === 'better' ? pill('Lower', 'good') : '',
      x.newPatterns ? chip(`${formatInt(x.newPatterns)} new pattern${x.newPatterns === 1 ? '' : 's'}`, 'warn') : '',
    ].filter(Boolean).join(' ');
    return `<tr>
      <td style="${TD} font-weight:600;">${link(x.exploreUrl, x.service) || escapeHtml(x.service)}</td>
      <td style="${TD_NUM}">${formatInt(x.totalLines)}</td>
      <td style="${TD_NUM}">${formatInt(x.errorLines)}</td>
      <td style="${TD_NUM}">${formatInt(x.warnLines)}</td>
      <td style="${TD_NUM}">${noLevel ? '—' : pct(x.errorRatePct)}</td>
      <td style="${TD_NUM}">${pct(x.baseline?.errorRatePct)}</td>
      <td style="${TD}">${status}</td>
    </tr>`;
  });
  const caption = total > rows.length ? `Applications (top ${rows.length} of ${total} by errors)` : 'Applications';
  return table(head, body, caption);
}

function patternsTable(summary: Configured, s: ReturnType<typeof lokiSettings>, only: Set<string> | null): string {
  const wanted = (level: string | null) =>
    s.levels === 'all' || level === 'error' || (s.levels === 'warn' && level === 'warn');
  const all = summary.patterns
    // The all-streams scope, or the chosen applications' own scopes.
    .filter((p) => (only ? p.service !== null && only.has(p.service) : p.service === null))
    .filter((p) => wanted(p.level))
    .filter((p) => !s.onlyNew || p.isNew === true)
    .sort((a, b) => b.count - a.count);
  const caption = `${s.onlyNew ? 'New log patterns' : 'Top log patterns'}${s.levels === 'all' ? '' : s.levels === 'error' ? ' (errors)' : ' (errors and warnings)'}`;
  if (all.length === 0) {
    const why = summary.patterns.length === 0 ? 'No pattern snapshot for this run.' : 'No pattern matches these settings.';
    return `<h3 style="margin:24px 0 8px; font-size:14px; color:${REPORT_COLORS.ink};">${escapeHtml(caption)}</h3>${emptyState(why)}`;
  }
  const rows = all.slice(0, s.maxRows);
  const head = `<th style="${TH_TEXT}">Pattern</th><th style="${TH_TEXT}">Level</th>${only ? `<th style="${TH_TEXT}">Application</th>` : ''}<th style="${TH_NUM}">Count</th><th style="${TH_TEXT}">vs baseline</th><th style="${TH_TEXT}"></th>`;
  const body = rows.map((p) => `<tr>
      <td style="${TD}"><code style="${CODE}">${escapeHtml(clip(p.pattern, PATTERN_CHARS))}</code></td>
      <td style="${TD}">${p.level ? pill(p.level, levelKind(p.level)) : '—'}</td>
      ${only ? `<td style="${TD}">${escapeHtml(p.service ?? '')}</td>` : ''}
      <td style="${TD_NUM}">${formatInt(p.count)}</td>
      <td style="${TD}">${p.isNew === true ? pill('New', 'warn') : p.isNew === false ? 'seen before' : '—'}</td>
      <td style="${TD}">${link(p.exploreUrl, 'Explore')}</td>
    </tr>`);
  return table(head, body, all.length > rows.length ? `${caption}, top ${rows.length} of ${all.length}` : caption);
}

function samplesTable(summary: Configured, s: ReturnType<typeof lokiSettings>, only: Set<string> | null): string {
  const lines = summary.samples
    // The worker samples each line twice: once for all streams (service null) and once for its application.
    // Same scoping as the patterns table, so an unfiltered table lists each line once.
    .filter((l) => (only ? l.service !== null && only.has(l.service) : l.service === null))
    .filter((l) => l.level === 'error' || (s.levels !== 'error' && l.level === 'warn') || s.levels === 'all')
    .slice(0, s.maxRows);
  const caption = s.levels === 'error' ? 'Latest error lines' : s.levels === 'warn' ? 'Latest error and warning lines' : 'Latest sampled lines';
  if (lines.length === 0) {
    const why = summary.samples.length === 0 ? 'No log lines were sampled for this run.' : 'No sampled line matches these settings.';
    return `<h3 style="margin:24px 0 8px; font-size:14px; color:${REPORT_COLORS.ink};">${caption}</h3>${emptyState(why)}`;
  }
  const head = `<th style="${TH_TEXT}">Time (UTC)</th><th style="${TH_TEXT}">Level</th><th style="${TH_TEXT}">Application</th><th style="${TH_TEXT}">Line</th>`;
  const body = lines.map((l) => `<tr>
      <td style="${TD} white-space:nowrap;">${escapeHtml(l.time.replace('T', ' ').replace(/\.\d+Z$|Z$/, ''))}</td>
      <td style="${TD}">${l.level ? pill(l.level, levelKind(l.level)) : '—'}</td>
      <td style="${TD}">${escapeHtml(l.service ?? '—')}</td>
      <td style="${TD}"><code style="${CODE}">${escapeHtml(clip(l.line, SAMPLE_LINE_CHARS))}</code></td>
    </tr>`);
  return table(head, body, caption);
}

const SERIES_PER_PANEL = 5;

function panelsTable(summary: Configured, maxRows: number): string {
  const rows: string[] = [];
  for (const p of summary.panels.slice(0, maxRows)) {
    const series = p.series.slice(0, SERIES_PER_PANEL);
    if (series.length === 0) {
      rows.push(`<tr><td style="${TD} font-weight:600;">${link(p.link, p.title) || escapeHtml(p.title)}</td><td style="${TD}" colspan="4">no data</td></tr>`);
      continue;
    }
    series.forEach((x, i) => rows.push(`<tr>
      <td style="${TD} font-weight:600;">${i === 0 ? link(p.link, p.title) || escapeHtml(p.title) : ''}</td>
      <td style="${TD}">${escapeHtml(x.name)}</td>
      <td style="${TD_NUM}">${x.total === null ? '—' : formatInt(x.total)}</td>
      <td style="${TD_NUM}">${formatNum(x.mean)}</td>
      <td style="${TD_NUM}">${formatNum(x.peak)}</td>
    </tr>`));
  }
  if (rows.length === 0) return '';
  const head = `<th style="${TH_TEXT}">Panel</th><th style="${TH_TEXT}">Series</th><th style="${TH_NUM}">Total</th><th style="${TH_NUM}">Mean</th><th style="${TH_NUM}">Peak</th>`;
  return table(head, rows, `Loki panels (whole run, top ${SERIES_PER_PANEL} series each)`);
}
