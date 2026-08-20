import { BaselineComparisonSelection } from '../services/report-data-fetcher.service';

/**
 * Flatten a section config's dashboard/panel/series pickers into the scopes a fetcher
 * filters on. Shared by the comparisons and trends sections, which offer the same cascade.
 *
 * Each level is all-or-explicit: leave the Panels picker empty and every panel of every
 * selected dashboard is in scope, but pick one panel and ONLY the picked panels count —
 * a dashboard you picked no panel on contributes nothing. Same for series against panels.
 * The per-dashboard reading it replaces ("this dashboard has no panels of its own, so take
 * all of it") silently put panels and series in the report that nobody selected.
 *
 * Configs saved before multi-select carried a single `dashboardLabel` and panels with no
 * dashboard of their own; those still read correctly here, which is the only reason the
 * legacy keys are still looked at.
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

  const scoped = labels.flatMap((label): BaselineComparisonSelection[] => {
    const own = panels.filter((p) => panelDashboard(p) === label);
    // Panels picked, none of them here: the user scoped the section past this dashboard.
    if (own.length === 0) return panels.length > 0 ? [] : [{ dashboardLabel: label }];
    return own.flatMap((p): BaselineComparisonSelection[] => {
      const names = series
        .filter((sr) => (sr.dashboardLabel ?? labels[0]) === label && sr.panelId === p.id)
        .map((sr) => sr.metricName);
      if (names.length > 0) return [{ dashboardLabel: label, panelId: p.id, metricNames: names }];
      return series.length > 0 ? [] : [{ dashboardLabel: label, panelId: p.id }];
    });
  });

  // Everything dropped out while dashboards ARE picked — only reachable from a config whose
  // panels/series carry a dashboard the label list no longer has. An empty list means "every
  // metric this run recorded" to the fetcher (report-data-fetcher.service.ts), so returning it
  // here would widen the section to the whole run: the failure this function exists to prevent.
  // Fall back to the one level that is still intact, the picked dashboards.
  if (scoped.length === 0) return labels.map((label) => ({ dashboardLabel: label }));
  return scoped;
}
