import { BaselineComparisonSelection } from '../services/report-data-fetcher.service';

/**
 * Flatten a section config's dashboard/panel/series pickers into the scopes a fetcher
 * filters on. Shared by the comparisons and trends sections, which offer the same cascade.
 *
 * The three lists cascade: a dashboard with no panels selected means every panel on it, a
 * panel with no series selected means every series in it. Configs saved before multi-select
 * carried a single `dashboardLabel` and panels with no dashboard of their own; those still
 * read correctly here, which is the only reason the legacy keys are still looked at.
 */
export function buildSelections(config: Record<string, unknown>): BaselineComparisonSelection[] {
  const labels = Array.isArray(config.dashboardLabels)
    ? (config.dashboardLabels as unknown[]).filter((l): l is string => typeof l === 'string')
    : typeof config.dashboardLabel === 'string' && config.dashboardLabel
      ? [config.dashboardLabel]
      : [];
  if (labels.length === 0) return [];

  const panels = Array.isArray(config.panels)
    ? (config.panels as { id: number; title?: string; dashboardLabel?: string }[])
    : [];
  const series = Array.isArray(config.series)
    ? (config.series as { dashboardLabel?: string; panelId: number; metricName: string }[])
    : [];

  // A legacy panel has no dashboard of its own — it belonged to the single selected one.
  const panelDashboard = (p: { dashboardLabel?: string }) => p.dashboardLabel ?? labels[0]!;

  return labels.flatMap((label) => {
    const own = panels.filter((p) => panelDashboard(p) === label);
    if (own.length === 0) return [{ dashboardLabel: label }];
    return own.map((p) => {
      const names = series
        .filter((sr) => (sr.dashboardLabel ?? labels[0]) === label && sr.panelId === p.id)
        .map((sr) => sr.metricName);
      return names.length > 0
        ? { dashboardLabel: label, panelId: p.id, metricNames: names }
        : { dashboardLabel: label, panelId: p.id };
    });
  });
}
