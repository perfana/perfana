/**
 * One name for a set of picked series, shared by the Compare and Graphs cards.
 *
 * Both used to name a selection by its SIZE — "3 Series", "Multi-metric Analysis
 * (5 series)" — which told a reader nothing and made every preset on a system collide on
 * the same handful of names. A name says what the selection holds instead:
 * `dashboard · panel · metric`, with each level collapsed to a count once it holds more
 * than two values.
 *
 * It is a suggestion, not a label: every caller puts it in an editable field.
 */

/** The three levels the cascade picks, as every card's series type already carries them. */
export interface SeriesNameParts {
  dashboardLabel?: string;
  panelTitle?: string;
  metricName?: string;
}

/**
 * One level: the value when there is one, both when there are two, a count past that.
 * Two is the useful limit — `CPU + Memory` still reads, `CPU + Memory + IO` already loses
 * to `3 panels` at the width these are listed at.
 */
function nameLevel(values: string[], noun: string): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} + ${values[1]}`;
  return `${values.length} ${noun}s`;
}

const uniq = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v))));

/**
 * `dashboard · panel · metric` for a set of series:
 *
 *   JVM · Heap · used                        (one dashboard, one panel, one metric)
 *   JVM · Heap + Non-heap · used             (two panels)
 *   4 dashboards · 4 panels · 4 metrics      (a wide selection)
 *
 * Counts are DISTINCT values, not series: four series across two panels that both carry a
 * series called `Usage` is `2 panels · Usage`.
 *
 * A level is dropped when it would repeat the one before it. The perf-test panels name
 * their series after the transaction and the panel after the measurement, but a Grafana
 * panel with a single series routinely names both the same thing, and `CPU · CPU` reads
 * as a bug.
 *
 * Returns `''` for an empty selection, so each caller keeps its own fallback — both
 * modals can be opened with nothing picked.
 */
export function composeSeriesName(series: SeriesNameParts[]): string {
  const levels = [
    nameLevel(uniq(series.map((s) => s.dashboardLabel)), 'dashboard'),
    nameLevel(uniq(series.map((s) => s.panelTitle)), 'panel'),
    nameLevel(uniq(series.map((s) => s.metricName)), 'metric'),
  ];
  const kept: string[] = [];
  for (const level of levels) {
    if (!level || level === kept[kept.length - 1]) continue;
    kept.push(level);
  }
  return kept.join(' · ');
}
