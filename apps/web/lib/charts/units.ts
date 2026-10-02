/**
 * Units → axes for the Analyst chart standard.
 *
 * The one rule this file exists to enforce: **one unit family means one axis**. The old
 * `assignSeriesToAxes` stacked every unit after the first onto `y2` (so three units were
 * drawn against a label naming one of them) and split a SINGLE unit across both axes
 * whenever its magnitudes differed by 100× — which put two `ms` series on two different
 * scales under two different labels. Both are gone.
 *
 * `family` and `factor` live in `lib/units.ts`, the units table that already backs every
 * label in the app; this module only groups and scales.
 */

import { unitFactor, unitFamily, unitLabel } from '@/lib/units';
import { EMPTY } from './format';

/**
 * Re-exported so a caller never has to know whether a unit fact lives in `lib/units`
 * (the table) or here (the axis logic) — `@/lib/charts` is the one import.
 */
export { unitFactor, unitFamily };

/** The unit a group is actually drawn in: its label, and what raw base values divide by. */
export interface DisplayUnit {
  label: string;
  divisor: number;
}

/**
 * The minimum a series has to be for an axis to be resolved for it. Each card maps its
 * own series shape onto this (`yAxisFormat` / `yAxesFormat` → `unit`).
 */
export interface AxisSeries {
  id: string;
  unit?: string;
  /** Shown in a lane's axis caption, which names the series sharing that lane. */
  name?: string;
  /** Largest raw value of this series, used to pick the display unit. */
  max?: number;
  /** Smallest raw value. A family with a negative value cannot be pinned to zero. */
  min?: number;
}

export interface AxisGroup<T extends AxisSeries = AxisSeries> {
  /** The unit family — also the group's identity. */
  key: string;
  series: T[];
  display: DisplayUnit;
  /** `L`/`R` in overlay mode; the 1-based lane number in lanes mode. */
  side: 'L' | 'R' | number;
  /** Plotly's axis key for this group: `y`, `y2`, `y3`… */
  axis: string;
}

export type AxisMode = 'overlay' | 'lanes';

/** The codes that carry no unit at all, as opposed to a unit this table has not heard of. */
const UNITLESS = new Set(['', 'short', 'none']);

/** The display label for a code: '' when unitless, the raw code when unknown. */
export function unitText(unitId?: string | null): string {
  if (!unitId || UNITLESS.has(unitId)) return '';
  return unitLabel(unitId) || unitId;
}

/** A group drawn in one of its own members' units — no rescaling. */
const asIs = (unitId?: string): DisplayUnit => ({
  label: unitText(unitId),
  divisor: unitFactor(unitId),
});

const pick = (
  maxBase: number,
  steps: Array<[threshold: number, label: string, divisor: number]>,
  fallback: DisplayUnit,
): DisplayUnit => {
  for (const [threshold, label, divisor] of steps) {
    if (maxBase >= threshold) return { label, divisor };
  }
  return fallback;
};

const KiB = 1024;

/**
 * The unit a family is drawn in, chosen from how large its values actually are: a chart
 * of sub-millisecond latencies labelled `s` is a chart of zeroes.
 *
 * `maxBase` is the family's largest value in base units (seconds, bytes, 0-100).
 */
export function displayUnit(family: string, maxBase: number, firstUnitId?: string): DisplayUnit {
  // All-zero or missing data says nothing about scale; keep the series' own unit rather
  // than inventing the smallest one in the family.
  if (!(maxBase > 0) || !Number.isFinite(maxBase)) return asIs(firstUnitId);

  switch (family) {
    case 'time':
      return maxBase < 1e-3
        ? { label: 'µs', divisor: 1e-6 }
        : maxBase < 1
          ? { label: 'ms', divisor: 1e-3 }
          : { label: 's', divisor: 1 };
    case 'pct':
      return { label: '%', divisor: 1 };
    case 'data':
      return pick(
        maxBase,
        [
          [KiB ** 3, 'GiB', KiB ** 3],
          [KiB ** 2, 'MiB', KiB ** 2],
          [KiB, 'KiB', KiB],
        ],
        { label: 'B', divisor: 1 },
      );
    case 'data-si':
      return pick(
        maxBase,
        [
          [1e9, 'GB', 1e9],
          [1e6, 'MB', 1e6],
          [1e3, 'KB', 1e3],
        ],
        { label: 'B', divisor: 1 },
      );
    case 'short':
      return pick(
        maxBase,
        [
          [1e6, '×1M', 1e6],
          [1e3, '×1K', 1e3],
        ],
        { label: '', divisor: 1 },
      );
    default:
      // Every rate (`reqps`, `ops`, …) and `none`: no auto-scale, the code is the label.
      return asIs(firstUnitId);
  }
}

/** Raw stored value → the number that gets plotted. */
export const toDisplay = (raw: number, unitId: string | undefined, display: DisplayUnit): number =>
  (raw * unitFactor(unitId)) / display.divisor;

/** Largest value of a group, expressed in the family's base unit. */
function maxInBase(series: AxisSeries[]): number {
  let max = 0;
  for (const s of series) {
    if (typeof s.max === 'number' && Number.isFinite(s.max)) {
      max = Math.max(max, Math.abs(s.max) * unitFactor(s.unit));
    }
  }
  return max;
}

/**
 * Group the visible series onto axes.
 *
 * 1 family → one left axis. 2 families → left and right. More than two, or `split`
 * → lanes: one stacked subplot per family, sharing the x axis and the crosshair.
 */
export function resolveAxes<T extends AxisSeries>(
  visible: T[],
  opts: { split?: boolean } = {},
): { mode: AxisMode; groups: AxisGroup<T>[] } {
  const byFamily = new Map<string, T[]>();
  // First appearance wins the order, so adding a series never reshuffles the axes.
  for (const series of visible) {
    const key = unitFamily(series.unit);
    const bucket = byFamily.get(key);
    if (bucket) bucket.push(series);
    else byFamily.set(key, [series]);
  }

  const entries = Array.from(byFamily.entries());
  const mode: AxisMode = opts.split === true || entries.length > 2 ? 'lanes' : 'overlay';

  const groups = entries.map(([key, series], index) => ({
    key,
    series,
    display: displayUnit(key, maxInBase(series), series[0]?.unit),
    side: (mode === 'lanes' ? index + 1 : index === 0 ? 'L' : 'R') as 'L' | 'R' | number,
    axis: index === 0 ? 'y' : `y${index + 1}`,
  }));

  return { mode, groups };
}

/**
 * What the unit picker offers, grouped the way a reader thinks about units rather than
 * as one 16-entry alphabetical dropdown.
 *
 * These are exactly the ids the two `GRAFANA_UNITS` arrays carried (one per card,
 * identical, both now deleted). `chip` is what fits a 22px chip; `title` is the long
 * label, kept as the chip's tooltip so `0–1` is still explained.
 */
export const UNIT_GROUPS: ReadonlyArray<{
  label: string;
  units: ReadonlyArray<{ id: string; chip: string; title: string }>;
}> = [
  {
    label: 'time',
    units: [
      { id: 'ns', chip: 'ns', title: 'Nanoseconds (ns)' },
      { id: 'µs', chip: 'µs', title: 'Microseconds (µs)' },
      { id: 'ms', chip: 'ms', title: 'Milliseconds (ms)' },
      { id: 's', chip: 's', title: 'Seconds (s)' },
    ],
  },
  {
    label: 'percent',
    units: [
      { id: 'percent', chip: '%', title: 'Percent (0-100)' },
      { id: 'percentunit', chip: '0–1', title: 'Percent (0.0-1.0)' },
    ],
  },
  {
    label: 'data',
    units: [
      { id: 'bytes', chip: 'B', title: 'Bytes' },
      { id: 'kbytes', chip: 'KiB', title: 'Kilobytes' },
      { id: 'mbytes', chip: 'MiB', title: 'Megabytes' },
      { id: 'gbytes', chip: 'GiB', title: 'Gigabytes' },
    ],
  },
  {
    label: 'rate',
    units: [
      { id: 'reqps', chip: 'req/s', title: 'Requests per second' },
      { id: 'ops', chip: 'ops/s', title: 'Operations per second' },
      { id: 'rps', chip: 'rd/s', title: 'Reads per second' },
      { id: 'wps', chip: 'wr/s', title: 'Writes per second' },
    ],
  },
  {
    label: 'other',
    units: [
      { id: 'short', chip: 'short', title: 'Short (auto-scaled)' },
      { id: 'none', chip: 'none', title: 'None' },
    ],
  },
];

export interface SeriesStats {
  min: number;
  mean: number;
  max: number;
}

/**
 * min / mean / max of a series, in the unit the axis is drawn in.
 *
 * The caller passes only the values INSIDE the analysis window — `analysis_start_offset`
 * and `analysis_end_offset` trim the ramp-up and the tail-off, and a mean that includes
 * them is not the number ADAPT compared.
 */
export function windowStats(
  values: number[],
  unitId: string | undefined,
  display: DisplayUnit,
): SeriesStats | null {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const raw of values) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const value = toDisplay(raw, unitId, display);
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    n += 1;
  }
  return n === 0 ? null : { min, mean: sum / n, max };
}

/** `ms, req/s, %` — the families in a lanes note, in axis order. */
export const groupLabels = (groups: AxisGroup[]): string[] =>
  groups.map((g) => g.display.label || unitText(g.key) || 'no unit');

/** Where a series ended up, for the series table's axis column. */
/**
 * The sentence under a lanes chart, or nothing when the chart is not in lanes.
 *
 * Shared by Graphs and Trends: it was the same string in both, and it carries a rule
 * (`> 2`, not `>= 2` — two families are a left and a right axis, not two lanes) that the
 * two would eventually disagree on.
 */
export const lanesNote = (groups: AxisGroup[], axisLayoutMode: AxisMode): string | undefined =>
  axisLayoutMode === 'lanes' && groups.length > 2
    ? `${groups.length} unit families (${groupLabels(groups).join(', ')}): more than two axes, so the chart is split into lanes`
    : undefined;

export function axisBadge(groups: AxisGroup[], seriesId: string): string {
  for (const group of groups) {
    if (group.series.some((s) => s.id === seriesId)) return String(group.side);
  }
  return EMPTY;
}
