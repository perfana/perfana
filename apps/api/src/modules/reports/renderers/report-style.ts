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
  /** Text of a control at rest (the filter pills), and the baseline name in a caption. */
  secondaryInk: '#4b5563',
  /** Outline and fill of a control at rest. */
  controlBorder: '#e2e5ea',
  controlBg: '#ffffff',
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

/**
 * `<details>` disclosure, used by the comparisons section for its per-row graphs and for
 * each dashboard / scenario group (`.report-group`).
 *
 * Collapsed is the on-screen default — twenty expanded charts would bury the table they
 * belong to, and a section of many groups is read by its headings first. Paper has no
 * disclosure triangle to click, so print forces every one open, and the rule that does it
 * is `::details-content`: Chrome hides a closed `details`' content with
 * `content-visibility` on that internal slot, so styling the CHILDREN — all this block did
 * before v0.2.97.40 — printed an empty disclosure. Verified by PDF text extraction against
 * Chromium 149, the PDF service's: the per-row graphs were missing from every PDF.
 *
 * The print rules that drop a toggle and keep a block on one page name the row graphs: a
 * group's summary IS its heading, so it must survive print, and a group can run for pages,
 * so `break-inside: avoid` would strand whole pages blank. Firefox before 143 has no
 * `::details-content`, so printing from it shows a closed group's heading and nothing else;
 * the PDF service (Chromium) and current Chrome, Safari and Firefox print every row.
 *
 * Deliberately NOT in `report-interactivity.ts`: that file's CSS only ever matters when its
 * script ran, and this needs no script at all — which is the reason both use `<details>`
 * rather than a JS expander in the first place. Both compiler entry points emit it.
 */
export const REPORT_DETAILS_CSS = `
    details > summary {
      list-style: revert;
    }

    details > summary:hover {
      background: #f8fafc;
    }

    /* The chevron replaces the marker: a marker sits above a flex row, never beside it. */
    .report-group > summary {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      list-style: none;
      cursor: pointer;
      border-radius: 6px;
    }

    .report-group > summary::-webkit-details-marker {
      display: none;
    }

    .report-group > summary::before {
      content: '';
      flex: none;
      width: 6px;
      height: 6px;
      margin-left: 4px;
      border-right: 2px solid ${REPORT_COLORS.mutedInk};
      border-bottom: 2px solid ${REPORT_COLORS.mutedInk};
      transform: rotate(-45deg);
      transition: transform 0.15s ease;
    }

    .report-group[open] > summary::before {
      transform: rotate(45deg);
    }

    .report-group > summary:focus-visible {
      outline: 2px solid ${ACCENT};
      outline-offset: 2px;
    }

    @media print {
      .report-row-graph > summary {
        display: none;
      }

      details::details-content {
        display: block !important;
        content-visibility: visible !important;
      }

      .report-row-graph {
        break-inside: avoid;
      }

      .report-group > summary::before {
        display: none;
      }
    }
`;

/** Pressed-state palette per group filter option: a row's `data-band` values, plus `all`. */
const GROUP_FILTER_TONES = [
  ['all', REPORT_COLORS.primary, PILL_FILLS.info],
  ['regression', REPORT_COLORS.dot.bad, PILL_FILLS.bad],
  ['warning', REPORT_COLORS.dot.warn, PILL_FILLS.warn],
  ['ok', REPORT_COLORS.dot.good, PILL_FILLS.good],
] as const;

const BANDS = ['regression', 'warning', 'ok'] as const satisfies readonly ReportBand[];

/**
 * The comparisons section's two filters, with no script: the "Show only" radios over
 * whole groups, and each group's band chips over its own rows.
 *
 * Inputs plus `:has()`, not the interactivity script, because the in-app viewer and the
 * public share page load the report into an iframe with no `allow-scripts` — a script-built
 * control would work only in a downloaded HTML file, never where reports are read. The
 * renderer stamps each group `data-has-<band>` and emits the radios (`groupFilter` in
 * `comparisons-renderer.ts`) and, at the top of each group's content, the chip checkboxes
 * (`bandFilterChip`); rows carry `data-band`, and a row's chart follows it as an unbanded
 * row. The chips are not in the `<summary>`: there a fast double-click on a closed group
 * opened it AND filtered it. The heading keeps the same counts as plain chips.
 *
 * The "Show only" rules start from the filter bar and reach the groups with `~`, so the bar
 * must stay a preceding SIBLING of the groups (`groupFilter()` before `bodyHtml`). Anchored
 * on the section instead, every recalculation walked every row of every group.
 *
 * Every hiding rule is `@media screen` only, so a filter left on still prints whole.
 * Both compiler entry points emit this block.
 */
export const REPORT_GROUP_FILTER_CSS = `
    .report-group-filter {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid ${REPORT_COLORS.rowBorder};
    }

    .report-group-filter-label {
      margin-right: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${REPORT_COLORS.mutedInk};
    }

    .report-group-filter label {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 14px;
      border-radius: 999px;
      border: 1px solid ${REPORT_COLORS.controlBorder};
      background: ${REPORT_COLORS.controlBg};
      color: ${REPORT_COLORS.secondaryInk};
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .report-group-filter label::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tone-dot);
    }

    /* Visually hidden, still focusable: arrow keys move between the radios, Space ticks a chip. */
    .report-group-filter input,
    [data-band-filter] > input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      opacity: 0;
    }

    .report-group-filter label:has(input:checked) {
      background: var(--tone-bg);
      color: var(--tone-fg);
      border-color: var(--tone-fg);
    }

    .report-group-filter label:has(input:disabled) {
      opacity: 0.45;
      cursor: default;
    }

    .report-group-filter label:has(input:focus-visible),
    [data-band-filter]:has(> input:focus-visible) {
      outline: 2px solid ${ACCENT};
      outline-offset: 2px;
    }
${GROUP_FILTER_TONES.map(([band, dot, fill]) => `
    .report-group-filter [data-band-pick="${band}"] {
      --tone-dot: ${dot};
      --tone-bg: ${fill.bg};
      --tone-fg: ${fill.fg};
    }`).join('')}

    /* A group's own band chips (bandFilterChip): checkboxes, and none ticked means every band. */
    .report-band-filter {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    [data-band-filter] {
      position: relative;
      cursor: pointer;
    }

    [data-band-filter]:hover {
      box-shadow: 0 0 0 1px currentColor;
    }

    @media screen {
${BANDS.map((band) => `
      .report-group-filter:has(input[value="${band}"]:checked) ~ .report-group:not([data-has-${band}]) {
        display: none;
      }`).join('')}

      .report-band-filter:has(input:checked) [data-band-filter]:not(:has(> input:checked)) {
        opacity: 0.35;
      }
${BANDS.map((band) => {
  // Every band left unticked while another is ticked; a row's chart sits in the next row.
  // Anchored on the group, not on the chip bar with `~`: that is cheaper per recalc, but
  // jsdom's selector engine misses `~ div tr` on this markup, which would leave the
  // contract spec in comparisons-renderer.spec.ts unable to check these rules.
  const scope = `[data-band-scope]:has(.report-band-filter input:checked):not(:has(.report-band-filter input[value="${band}"]:checked))`;
  return `
      ${scope} tr[data-band="${band}"],
      ${scope} tr[data-band="${band}"] + tr:not([data-band]) {
        display: none;
      }`;
}).join('')}
    }

    @media print {
      .report-group-filter,
      .report-band-filter {
        display: none;
      }
    }
`;

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
  return `<span style="display:inline-block; padding:4px 11px; border-radius:999px; overflow-wrap:normal; background:${bg}; color:${fg}; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">${escapeHtml(label)}</span>`;
}

/** Status pill for the five-state scale (rule 01 + 06). */
export function statusPill(status: ReportStatus): string {
  return pill(STATUS_LABEL[status], STATUS_PILL_KIND[status]);
}

function chipHtml(label: string, kind: PillKind, attrs: string, tag = 'span', lead = ''): string {
  const { bg, fg } = PILL_FILLS[kind];
  return `<${tag}${attrs} style="display:inline-block; padding:4px 11px; border-radius:999px; overflow-wrap:normal; background:${bg}; color:${fg}; font-size:12px; font-weight:700;">${lead}${escapeHtml(label)}</${tag}>`;
}

/** Summary chip (counts in section/group headers). Not uppercased. */
export function chip(label: string, kind: PillKind): string {
  return chipHtml(label, kind, '');
}

/**
 * The three-state band a compared row falls in. Stamped on each row as
 * `data-band` and on each group as `data-has-<band>`, which the group's band chips
 * and the section's Show only radios match in `REPORT_GROUP_FILTER_CSS`.
 */
export type ReportBand = 'regression' | 'warning' | 'ok';

/** rank 0/1/2 as produced by the comparisons renderer's worstRank. */
export const BAND_FOR_RANK: readonly ReportBand[] = ['ok', 'warning', 'regression'];

/**
 * A count chip that is also its group's filter over that band's rows: a `<label>` around a
 * visually hidden checkbox, driven by `REPORT_GROUP_FILTER_CSS`. A checkbox rather than the
 * interactivity script, because the viewer's iframe runs no scripts — a script-wired chip
 * there did nothing. It sits in the group's content, not its `<summary>` (see that CSS).
 */
export function bandFilterChip(label: string, kind: PillKind, band: ReportBand): string {
  return chipHtml(label, kind, ` data-band-filter="${band}"`, 'label', `<input type="checkbox" value="${band}">`);
}

/** Compact in-table marker chip (e.g. a CURRENT run marker) sized for table rows. */
export function markerChip(label: string, kind: PillKind): string {
  const { bg, fg } = PILL_FILLS[kind];
  return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; overflow-wrap:normal; background:${bg}; color:${fg}; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">${escapeHtml(label)}</span>`;
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
    `<span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; overflow-wrap:normal; font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; background:${bg}; color:${fg};">${content}</span>`;
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

/** A group heading's title. An `<h3>` alone, so it can also sit directly in a `<summary>`. */
export function groupTitle(label: string): string {
  return `<h3 style="margin:0; font-size:17px; font-weight:700; color:${REPORT_COLORS.headingInk}; padding-left:14px; border-left:4px solid ${ACCENT};">${escapeHtml(label)}</h3>`;
}

/**
 * Group header inside a section (h3): source label + chips (host, metric count),
 * right-aligned summary chips.
 */
export function groupHeader(label: string, chipsLeftHtml: string[] = [], chipsRightHtml: string[] = []): string {
  const left = chipsLeftHtml.filter(Boolean).join('');
  const right = chipsRightHtml.filter(Boolean).join('');
  return `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
    <div style="display:flex; align-items:center; gap:10px;">
      ${groupTitle(label)}
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

/**
 * A section that could not be produced, as opposed to one with nothing to show.
 * Deliberately not the neutral grey of {@link emptyState}: a stored report is read
 * long after the failure, and "we could not load this" must never look like "this
 * was fine".
 */
export function warningState(message: string): string {
  const { bg, fg } = PILL_FILLS.warn;
  return `<div style="padding:20px; background:${bg}; border:1px solid ${fg}33; border-left:4px solid ${fg}; border-radius:4px; color:${fg}; font-size:13px;"><strong>Section incomplete.</strong> ${escapeHtml(message)}</div>`;
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
// Rule 07 · Optional accompanying section text
// ---------------------------------------------------------------------------

/**
 * Accompanying text, rendered directly under the section header as plain
 * prose — the same markdown subset and typography a text block body gets, so
 * the two read identically. Empty/whitespace text → '' (omit entirely — no
 * empty box, no placeholder).
 *
 * renderMarkdown escapes the source before emitting any tag, so this is not an
 * HTML hole even though the output is served unauthenticated via share links.
 */
export function sectionText(text: string | null | undefined): string {
  const value = (text ?? '').trim();
  if (!value) return '';
  return `<div class="section-text" style="margin:0 0 20px;">${renderMarkdown(value)}</div>`;
}
