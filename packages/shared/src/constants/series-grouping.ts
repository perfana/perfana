/**
 * `ds_compare_config.config_data.source` marker for the rows `StatisticsPipeline` writes for a
 * series group's DERIVED series — `<group> (sum)`, `<group> (max)`, `<group> (pod count)`.
 *
 * Written by the **worker** (`apps/worker/src/pipelines/helpers/series-grouping-plan.ts`,
 * `DERIVED_SERIES_CONFIG_DATA`). It is provenance: it is how a human reading the table, or the
 * orphan sweep filed in TODOS.md, tells these machine-written rows from a configuration somebody
 * chose. `apps/api/src/constants/ds-compare-config.constants.ts` holds the Dynatrace twin; it sits
 * in `@perfana/shared` rather than beside it because the value space of `config_data.source` spans
 * both apps (`'metric'` and `'panel'` come from the web app, `'dynatrace-host'` from the API).
 *
 * **Do not build an authorization or gating decision on it. It is not durable.** The anomaly
 * card's save rebuilds `config_data` from scratch — `source: scope === 'metric' ? 'metric' :
 * 'panel'` in `apps/web/.../useAnomalyDetection.ts` — and `updateDsCompareConfig` replaces the
 * column wholesale rather than merging, so one ordinary edit of a derived row erases this marker
 * and the row becomes indistinguishable from any other per-series config.
 *
 * That is exactly how it was first used, and it was wrong.
 * `applyGoldenPathClassifications` counted every existing `ds_compare_config` row — at any level —
 * as evidence the panel was configured, and skipped a panel-level golden-path template whose panel
 * was in that set. Series grouping made metric-level rows routine (one per derived series per
 * grouped analysis, where the dev database had one in 420), so the first grouped analysis of a
 * workload disabled that panel's template permanently. Excluding rows carrying this marker fixed
 * the symptom and left it one user edit from returning, silently. The gate is keyed on
 * `metric_name IS NOT NULL` instead — the row's LEVEL, which no save can rewrite — because a
 * per-series override is not a panel default in the first place.
 */
export const SERIES_GROUPING_DERIVED_SOURCE = 'series-grouping-derived';
