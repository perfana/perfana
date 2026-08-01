/**
 * Perfana Report — shared style system.
 *
 * Single source of truth for how ALL report sections render status, deltas,
 * numbers, headers, group headers, tables, empty states and comments, so the
 * report reads as one document. Rules 01–07 of the report style guide live
 * here; renderers must not hand-roll their own variants.
 *
 * Reference implementation: ComparisonsRenderer.renderBaselineRun.
 */

// type-only: comparison-bands runtime-imports REPORT_COLORS from this module
import { renderMarkdown } from '@perfana/shared';
import type { DiffThresholds } from './comparison-bands';
import { formatValueWithUnit } from './unit-format';

// ---------------------------------------------------------------------------
// Palette (rule: one palette for the whole report)
// ---------------------------------------------------------------------------

export const REPORT_COLORS = {
  primary: '#1976d2',
  headingInk: '#2b3138',
  coverInk: '#16324f',
  ink: '#1f2933',
  mutedInk: '#6b7280',
  faintInk: '#8a929c',
  rowBorder: '#f0f2f5',
  cardBg: '#f8f9fa',
  cardBorder: '#e9ecef',
  emptyBg: '#f5f5f5',
  emptyInk: '#999999',
  dot: { good: '#43a047', warn: '#f59e0b', bad: '#e04944', neutral: '#bdbdbd' },
} as const;

/**
 * Section accent color. Reports support custom branding via
 * styling.primaryColor → the compiled CSS exposes it as --primary-color;
 * fall back to the default palette primary.
 */
export const ACCENT = `var(--primary-color, ${REPORT_COLORS.primary})`;

export type PillKind = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const PILL_FILLS: Record<PillKind, { bg: string; fg: string }> = {
  good: { bg: '#e7f4ea', fg: '#2e7d32' },
  warn: { bg: '#fdf0dd', fg: '#9a5b00' },
  bad: { bg: '#fbe6e4', fg: '#c1362f' },
  info: { bg: '#eaf1fb', fg: '#2b64b3' },
  neutral: { bg: '#f1f1f3', fg: '#7a828b' },
};

export const escapeHtml = (text: string): string => {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
};

/**
 * Coerce a value that SHOULD be a number but may arrive as a string —
 * pg NUMERIC columns come back as strings from node-postgres despite
 * TypeScript typings. Returns null for anything non-finite.
 */
const toFiniteNumber = (value: number | string | null | undefined): number | null => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Rule 01 · One status scale
// ---------------------------------------------------------------------------

export type ReportStatus = 'ok' | 'warning' | 'regression' | 'improvement' | 'na';

const STATUS_LABEL: Record<ReportStatus, string> = {
  ok: 'OK',
  warning: 'WARNING',
  regression: 'REGRESSION',
  improvement: 'IMPROVEMENT',
  na: 'N/A',
};

const STATUS_PILL_KIND: Record<ReportStatus, PillKind> = {
  ok: 'good',
  warning: 'warn',
  regression: 'bad',
  improvement: 'info',
  na: 'neutral',
};

export const DEFAULT_THRESHOLDS: DiffThresholds = { good: 10, warning: 50 };

/**
 * Collapse a percentage delta into the five-state status scale.
 * Boundary semantics per the style guide: within threshold = "≤ good% drift"
 * (inclusive), warning band is (good, warning], regression is > warning.
 * comparison-bands.bandColor uses the same inclusive boundaries.
 *
 * `higherIsWorse` controls which direction counts as a regression (response
 * times: higher is worse; throughput: lower is worse).
 */
export function statusFor(
  diffPercent: number | string | null | undefined,
  thresholds: DiffThresholds = DEFAULT_THRESHOLDS,
  higherIsWorse = true,
): ReportStatus {
  const pct = toFiniteNumber(diffPercent);
  if (pct == null) return 'na';
  const worse = higherIsWorse ? pct > 0 : pct < 0;
  const abs = Math.abs(pct);
  if (abs <= thresholds.good) return 'ok';
  if (!worse) return 'improvement';
  if (abs <= thresholds.warning) return 'warning';
  return 'regression';
}

// ---------------------------------------------------------------------------
// Rule 06 · Pills: UPPERCASE + letter-spacing on colored severity pills
// ---------------------------------------------------------------------------

/** Generic colored pill. Label is uppercased with letter-spacing per rule 06. */
export function pill(label: string, kind: PillKind): string {
  const { bg, fg } = PILL_FILLS[kind];
  return `<span style="display:inline-block; padding:4px 11px; border-radius:999px; background:${bg}; color:${fg}; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">${escapeHtml(label)}</span>`;
}

/** Status pill for the five-state scale (rule 01 + 06). */
export function statusPill(status: ReportStatus): string {
  return pill(STATUS_LABEL[status], STATUS_PILL_KIND[status]);
}

/** Summary chip (counts in section/group headers). Not uppercased. */
export function chip(label: string, kind: PillKind): string {
  const { bg, fg } = PILL_FILLS[kind];
  return `<span style="display:inline-block; padding:4px 11px; border-radius:999px; background:${bg}; color:${fg}; font-size:12px; font-weight:700;">${escapeHtml(label)}</span>`;
}

/** Compact in-table marker chip (e.g. a CURRENT run marker) sized for table rows. */
export function markerChip(label: string, kind: PillKind): string {
  const { bg, fg } = PILL_FILLS[kind];
  return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; background:${bg}; color:${fg}; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">${escapeHtml(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Rule 02 · Delta arrows track the value
// ---------------------------------------------------------------------------

/** Arrow glyph bound to the number's direction. '' for null/non-finite. */
export function deltaArrow(diffPercent: number | string | null | undefined): string {
  const pct = toFiniteNumber(diffPercent);
  if (pct == null) return '';
  if (pct === 0) return '–';
  return pct > 0 ? '▲' : '▼';
}

/**
 * Textual delta: arrow + signed percentage (rule 02/03). A true zero or a
 * missing value renders as a bare em-dash.
 */
export function deltaText(diffPercent: number | string | null | undefined): string {
  const pct = toFiniteNumber(diffPercent);
  if (pct == null || pct === 0) return '—';
  return `${deltaArrow(pct)} ${pct > 0 ? '+' : ''}${formatPercent(pct)}`;
}

/**
 * Delta chip: arrow + signed percentage, colored by what the movement MEANS
 * (status), not by its raw direction. Zero/missing → neutral em-dash chip.
 */
export function deltaChip(
  diffPercent: number | string | null | undefined,
  thresholds: DiffThresholds = DEFAULT_THRESHOLDS,
  higherIsWorse = true,
): string {
  const pct = toFiniteNumber(diffPercent);
  const chipStyle = (bg: string, fg: string, content: string): string =>
    `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; background:${bg}; color:${fg};">${content}</span>`;
  if (pct == null || pct === 0) {
    return chipStyle(PILL_FILLS.neutral.bg, PILL_FILLS.neutral.fg, '—');
  }
  const status = statusFor(pct, thresholds, higherIsWorse);
  const { bg, fg } = PILL_FILLS[STATUS_PILL_KIND[status]];
  return chipStyle(bg, fg, `${deltaArrow(pct)} ${pct > 0 ? '+' : ''}${formatPercent(pct)}`);
}

// ---------------------------------------------------------------------------
// Rule 03 · Numbers & units — one formatter for the whole report
// ---------------------------------------------------------------------------

const INT_FORMAT = new Intl.NumberFormat('en-US');
const NUM_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const SMALL_NUM_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 });

/** Integers: thousands grouping (4937045 → 4,937,045). */
export function formatInt(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  return INT_FORMAT.format(Math.round(n));
}

/**
 * General numbers: thousands grouping, capped to 2 decimals. Non-zero values
 * that would collapse to "0" keep up to 5 decimals (0.0042 must not read as 0).
 */
export function formatNum(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  if (n !== 0 && Math.abs(n) < 0.01) return SMALL_NUM_FORMAT.format(n);
  return NUM_FORMAT.format(n);
}

/** Diff values: a true zero renders as em-dash (rule 03). */
export function formatDiff(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n == null || n === 0) return '—';
  return formatNum(n);
}

/** Percentages: always one decimal + %. */
export function formatPercent(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

/**
 * Metric value + unit — one path for every table cell that shows a measured
 * value. Grafana unit codes go through unit-format (percentunit ×100 etc.);
 * bytes get IEC scaling; unknown/absent units fall back to formatNum.
 */
export function formatMetricValue(
  value: number | string | null | undefined,
  unit?: string | null,
): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  if (unit === 'bytes' || unit === 'decbytes') return formatBytes(n);
  if (unit) return formatValueWithUnit(n, unit);
  return formatNum(n);
}

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${formatNum(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (Math.abs(v) >= 1024 && i < units.length - 1);
  return `${formatNum(v)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Shared table styles — one thead treatment for the whole report
// ---------------------------------------------------------------------------

export const TH_TEXT = `text-align:left; padding:4px 14px 12px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${REPORT_COLORS.faintInk}; white-space:nowrap;`;
export const TH_NUM = `text-align:right; padding:4px 16px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:${REPORT_COLORS.faintInk}; white-space:nowrap;`;
export const TH_CENTER = `text-align:center; padding:4px 16px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${REPORT_COLORS.faintInk}; white-space:nowrap;`;
/** Style for the <tr> wrapping a thead row. */
export const THEAD_ROW = `border-bottom:2px solid #e6e8ec;`;

// ---------------------------------------------------------------------------
// Rule 04 · Section headers — one pattern for every <h2>
// ---------------------------------------------------------------------------

export interface SectionHeaderOptions {
  /** Summary chips rendered right-aligned (already-rendered chip()/pill() html). */
  chipsHtml?: string[];
  /** Small uppercase kicker line under the title (pass natural case; CSS uppercases). */
  kicker?: string;
}

/**
 * Section header: title with a 4px accent (custom-brandable via
 * --primary-color), optional right-aligned summary chips. No emoji, no
 * per-section icons (rule 04).
 */
export function sectionHeader(title: string, opts: SectionHeaderOptions = {}): string {
  const chips = (opts.chipsHtml ?? []).filter(Boolean);
  const kicker = opts.kicker
    ? `<div style="font-size:10pt; color:${REPORT_COLORS.mutedInk}; text-transform:uppercase; letter-spacing:0.1em; margin-top:4px;">${escapeHtml(opts.kicker)}</div>`
    : '';
  return `<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px; border-left:4px solid ${ACCENT}; padding-left:16px;">
    <div style="flex:1; min-width:0;">
      <h2 style="margin:0; padding:0; border:none; font-size:18pt; font-weight:600; color:${REPORT_COLORS.headingInk};">${escapeHtml(title)}</h2>
      ${kicker}
    </div>
    ${chips.length ? `<div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">${chips.join('')}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Rule 05 · Group headers & metric names
// ---------------------------------------------------------------------------

/**
 * Group header inside a section (h3): source label + chips (host, metric count),
 * right-aligned summary chips.
 */
export function groupHeader(label: string, chipsLeftHtml: string[] = [], chipsRightHtml: string[] = []): string {
  const left = chipsLeftHtml.filter(Boolean).join('');
  const right = chipsRightHtml.filter(Boolean).join('');
  return `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
    <div style="display:flex; align-items:center; gap:10px;">
      <h3 style="margin:0; font-size:17px; font-weight:700; color:${REPORT_COLORS.headingInk}; padding-left:14px; border-left:4px solid ${ACCENT};">${escapeHtml(label)}</h3>
      ${left}
    </div>
    ${right ? `<div style="display:flex; gap:8px;">${right}</div>` : ''}
  </div>`;
}

/**
 * Strip the host-id prefix from a metric label (rule 05):
 * "HOST-123_afterburner-be_CPU Usage" → { host: "afterburner-be", metric: "CPU Usage" }
 */
export function splitHostLabel(label: string): { host: string; metric: string } {
  const parts = label.split('_');
  if (parts.length >= 3) return { host: parts[1]!, metric: parts.slice(2).join('_') };
  if (parts.length === 2) return { host: parts[0]!, metric: parts[1]! };
  return { host: '', metric: label };
}

// ---------------------------------------------------------------------------
// Shared building blocks — empty states & stat cards
// ---------------------------------------------------------------------------

/** The one empty-state treatment for every "no data" branch. */
export function emptyState(message: string): string {
  return `<div style="padding:20px; background:${REPORT_COLORS.emptyBg}; border-radius:4px; text-align:center; color:${REPORT_COLORS.emptyInk}; font-size:13px;">${escapeHtml(message)}</div>`;
}

/** Summary stat card (label + big value + optional sub-line). valueHtml is raw HTML. */
export function statCard(label: string, valueHtml: string, subHtml = ''): string {
  return `<div style="background:${REPORT_COLORS.cardBg}; border:1px solid ${REPORT_COLORS.cardBorder}; border-radius:8px; padding:20px;">
    <div style="font-size:9pt; color:${REPORT_COLORS.mutedInk}; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px; font-weight:600;">${escapeHtml(label)}</div>
    <div style="font-size:28pt; font-weight:700; font-variant-numeric:tabular-nums; color:${REPORT_COLORS.ink};">${valueHtml}</div>
    ${subHtml ? `<div style="margin-top:8px;">${subHtml}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Rule 07 · Optional section comment
// ---------------------------------------------------------------------------

/**
 * Author comment block: accent + monochrome speech-bubble icon, rendered
 * under the section header. Empty/whitespace comment → '' (omit entirely —
 * no empty box, no placeholder).
 */
export function commentBlock(comment: string | null | undefined): string {
  const text = (comment ?? '').trim();
  if (!text) return '';
  const bubble = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${REPORT_COLORS.primary}" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  // Comments render the same markdown subset as text block bodies — the editor
  // offers the same toolbar for both, so the output has to agree. renderMarkdown
  // escapes the source before emitting any tag, so this is not an HTML hole.
  return `<div class="section-comment" style="display:flex; gap:10px; align-items:flex-start; margin:0 0 20px; padding:12px 16px; background:#f5f9ff; border-left:4px solid ${ACCENT}; border-radius:0 6px 6px 0; font-size:13px; color:#374151; line-height:1.5;">
    ${bubble}
    <div style="min-width:0;">${renderMarkdown(text)}</div>
  </div>`;
}
