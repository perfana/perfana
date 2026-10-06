/**
 * `ds_compare_config.config_data.source` markers that are written by a machine and
 * must be readable as such.
 *
 * `DYNATRACE_HOST_COMPARE_SOURCE` is stamped by
 * `DynatraceRepository.createDsCompareConfigForMetric` when a HOST is mapped, and read by
 * `TestRunsMetricsService.applyGoldenPathClassifications` to tell that boilerplate row apart
 * from a user's edit — the row carries no `created_by`/`updated_by`, so the marker is the only
 * signal. Both ends have to agree on the literal: change it in one place only and the golden-path
 * template silently stops merging, with nothing logged and `absoluteThreshold` quietly left NULL.
 * That is the exact failure this constant exists to make impossible, so keep both sides importing
 * it rather than re-typing the string.
 *
 * The UI's save path deliberately overwrites `source` with `'metric'` / `'panel'`
 * (`apps/web/.../useAnomalyDetection.ts`), which is what makes a user edit distinguishable.
 */
export const DYNATRACE_HOST_COMPARE_SOURCE = 'dynatrace-host';
