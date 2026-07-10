/**
 * Perfana Report — shared style system.
 *
 * Single source of truth for how ALL report sections render status, deltas,
 * numbers, headers, group headers, and comments, so the report reads as one
 * document. Rules 01–07 of the report style guide live here; renderers must
 * not hand-roll their own variants.
 *
 * Reference implementation: ComparisonsRenderer.renderBaselineRun.
 */

import { DiffThresholds } from './comparison-bands';

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
  dot: { good: '#43a047', warn: '#f59e0b', bad: '#e04944', neutral: '#bdbdbd' },
} as const;

export type PillKind = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const PILL_FILLS: Record<PillKind, { bg: string; fg: string }> = {
  good: { bg: '#e7f4ea', fg: '#2e7d32' },
  warn: { bg: '#fdf0dd', fg: '#9a5b00' },
  bad: { bg: '#fbe6e4', fg: '#c1362f' },
  info: { bg: '#eaf1fb', fg: '#2b64b3' },
  neutral: { bg: '#f1f1f3', fg: '#7a828b' },
};

const escapeHtml = (text: string): string => {
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

// ---------------------------------------------------------------------------
// Rule 01 · One status scale
// ---------------------------------------------------------------------------

export type ReportStatus = 'ok' | 'warning' | 'regression' | 'improvement' | 'na';

export const STATUS_LABEL: Record<ReportStatus, string> = {
  ok: 'OK',
  warning: 'WARNING',
  regression: 'REGRESSION',
  improvement: 'IMPROVEMENT',
  na: 'N/A',
};

export const STATUS_PILL_KIND: Record<ReportStatus, PillKind> = {
  ok: 'good',
  warning: 'warn',
  regression: 'bad',
  improvement: 'info',
  na: 'neutral',
};

export const DEFAULT_THRESHOLDS: DiffThresholds = { good: 10, warning: 50 };

/**
 * Collapse a percentage delta into the five-state status scale.
 *
 * `higherIsWorse` controls which direction counts as a regression (response
 * times: higher is worse; throughput: lower is worse).
 */
export function statusFor(
  diffPercent: number | null | undefined,
  thresholds: DiffThresholds = DEFAULT_THRESHOLDS,
  higherIsWorse = true,
): ReportStatus {
  if (diffPercent == null || !isFinite(diffPercent)) return 'na';
  const worse = higherIsWorse ? diffPercent > 0 : diffPercent < 0;
  const abs = Math.abs(diffPercent);
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

// ---------------------------------------------------------------------------
// Rule 02 · Delta arrows track the value
// ---------------------------------------------------------------------------

/** Arrow glyph bound to the number's direction. '' for null. */
export function deltaArrow(diffPercent: number | null | undefined): string {
  if (diffPercent == null || !isFinite(diffPercent) || diffPercent === 0) {
    return diffPercent === 0 ? '–' : '';
  }
  return diffPercent > 0 ? '▲' : '▼';
}

/**
 * Delta chip: arrow + signed percentage, colored by what the movement MEANS
 * (status), not by its raw direction.
 */
export function deltaChip(
  diffPercent: number | null | undefined,
  thresholds: DiffThresholds = DEFAULT_THRESHOLDS,
  higherIsWorse = true,
): string {
  if (diffPercent == null || !isFinite(diffPercent)) {
    return `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; background:${PILL_FILLS.neutral.bg}; color:${PILL_FILLS.neutral.fg};">—</span>`;
  }
  const status = statusFor(diffPercent, thresholds, higherIsWorse);
  const { bg, fg } = PILL_FILLS[STATUS_PILL_KIND[status]];
  const text = diffPercent === 0 ? '—' : `${diffPercent > 0 ? '+' : ''}${formatPercent(diffPercent)}`;
  return `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; background:${bg}; color:${fg};">${deltaArrow(diffPercent)} ${text}</span>`;
}

// ---------------------------------------------------------------------------
// Rule 03 · Numbers & units — one formatter for the whole report
// ---------------------------------------------------------------------------

/** Integers: thousands grouping (4937045 → 4,937,045). */
export function formatInt(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** General numbers: thousands grouping, capped to 2 decimals. */
export function formatNum(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Diff values: a true zero renders as em-dash (rule 03). */
export function formatDiff(value: number | null | undefined): string {
  if (value == null || !isFinite(value) || value === 0) return '—';
  return formatNum(value);
}

/** Percentages: always one decimal + %. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Rule 04 · Section headers — one pattern for every <h2>
// ---------------------------------------------------------------------------

export interface SectionHeaderOptions {
  /** Summary chips rendered right-aligned (already-rendered chip()/pill() html). */
  chipsHtml?: string[];
  /** Small uppercase kicker line under the title (e.g. "SERVICE LEVEL OBJECTIVES"). */
  kicker?: string;
}

/**
 * Section header: title with a 4px primary left accent, optional right-aligned
 * summary chips. No emoji, no per-section icons (rule 04).
 */
export function sectionHeader(title: string, opts: SectionHeaderOptions = {}): string {
  const chips = (opts.chipsHtml ?? []).filter(Boolean);
  const kicker = opts.kicker
    ? `<div style="font-size:10pt; color:#666; text-transform:uppercase; letter-spacing:0.1em; margin-top:4px;">${escapeHtml(opts.kicker)}</div>`
    : '';
  return `<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px; border-left:4px solid ${REPORT_COLORS.primary}; padding-left:16px;">
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
      <h3 style="margin:0; font-size:17px; font-weight:700; color:${REPORT_COLORS.headingInk}; padding-left:14px; border-left:4px solid ${REPORT_COLORS.primary};">${escapeHtml(label)}</h3>
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
// Rule 07 · Optional section comment
// ---------------------------------------------------------------------------

/**
 * Author comment block: blue left accent + monochrome speech-bubble icon,
 * rendered under the section header. Empty/whitespace comment → '' (omit
 * entirely — no empty box, no placeholder).
 */
export function commentBlock(comment: string | null | undefined): string {
  const text = (comment ?? '').trim();
  if (!text) return '';
  const bubble = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${REPORT_COLORS.primary}" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  return `<div class="section-comment" style="display:flex; gap:10px; align-items:flex-start; margin:0 0 20px; padding:12px 16px; background:#f5f9ff; border-left:4px solid ${REPORT_COLORS.primary}; border-radius:0 6px 6px 0; font-size:13px; color:#374151; line-height:1.5;">
    ${bubble}
    <div>${escapeHtml(text)}</div>
  </div>`;
}
