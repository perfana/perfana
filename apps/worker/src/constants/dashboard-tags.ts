/**
 * Grafana dashboard tags Perfana treats as control signals rather than labels.
 *
 * Lives in its own leaf module because two very different layers need it — the panel
 * builder (`pipelines/panels/helpers.ts`, which skips a tagged dashboard) and the
 * collection-source resolver (`services/collectable-sources.ts`, which must not register
 * a source for one) — and the resolver must not drag the panel builder's module-level
 * logger into every importer.
 *
 * Two copies of this literal is how a source gets scheduled every minute for dashboards
 * the panel builder then discards.
 */

/** Excludes a dashboard (by tag) or a panel (in its description) from anomaly detection. */
export const NO_ANOMALY_DETECTION_MARKER = 'no-anomaly-detection';
