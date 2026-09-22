'use client';

/**
 * "Open in Graphs / Compare / Trends" for any row that names a series, and the in-page
 * "View in Performance Analysis" drill-down.
 *
 * The new-tab links carry the series in the URL (`?card=graphs&dashboard=…&panel=…&metric=…`);
 * the page reads `card` to open the Reporting tab and expand that card, and the shared
 * MetricSeriesCascade reads the other three to preselect its dropdowns.
 */

import React, { createContext, useContext } from 'react';
import { useParams } from 'next/navigation';
import { ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import {
  CompareArrows as CompareArrowsIcon,
  OpenInNew as OpenInNewIcon,
  QueryStats as QueryStatsIcon,
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { isAllAggregatedDashboard } from '@/lib/aggregated-perf-series';
import { DrillDownFilters } from '../../types';
import { isPerformanceTestMetricsDashboard, parseRequestInfoFromMetric } from '../anomaly-detection/components/utils';

export type LinkableCard = 'graphs' | 'compare' | 'trends';

/** What identifies one stored series across every card: the cascade matches on exactly these. */
export interface MetricSeriesRef {
  dashboardLabel: string;
  panelId: number;
  metricName: string;
}

export function buildCardLink(testRunId: string, card: LinkableCard, ref: MetricSeriesRef): string {
  const q = new URLSearchParams({
    card,
    dashboard: ref.dashboardLabel,
    panel: String(ref.panelId),
    metric: ref.metricName,
  });
  return `/test-runs/${encodeURIComponent(testRunId)}?${q.toString()}`;
}

/** The three URL params the cascade preselects from, or null when the link is for another card. */
export function readCardLinkPreselect(
  params: { get(name: string): string | null },
  card: LinkableCard,
): MetricSeriesRef | null {
  if (params.get('card') !== card) return null;
  const dashboardLabel = params.get('dashboard');
  const rawPanel = params.get('panel');
  const metricName = params.get('metric');
  // Number(null) and Number('') are 0, which would pass isInteger.
  if (!dashboardLabel || !metricName || !rawPanel) return null;
  const panelId = Number(rawPanel);
  if (!Number.isInteger(panelId)) return null;
  return { dashboardLabel, panelId, metricName };
}

/**
 * The scenario/transaction a stored perf-test series row drills down to, or null when the
 * row is not one: a Grafana/Dynatrace row, or the run-wide "all aggregated" dashboard,
 * whose pseudo-scenario exists on no overview.
 */
export function perfDrillDownFilters(row: { dashboard_label?: string | null; panel_title?: string; metric_name?: string }): DrillDownFilters | null {
  const label = row.dashboard_label ?? undefined;
  if (!isPerformanceTestMetricsDashboard({ dashboard_label: label }) || isAllAggregatedDashboard(label)) return null;
  return parseRequestInfoFromMetric({ ...row, dashboard_label: label });
}

// Mirrors the worker: dashboard label from generateScenarioDashboardLabel (NULL scenario is
// 'default'), request series name from samplerMetricNameSql. Panel 101 / 201 are the RT Avg
// panels — the Compare card collapses the percentile twins onto them anyway.
export function perfTestSeriesRef(f: DrillDownFilters): MetricSeriesRef {
  const dashboardLabel = `Performance test metrics ${f.scenario || 'default'}`;
  if (f.sampler) {
    const t = f.transaction;
    const bare = !t || t === 'overall' || t === f.sampler;
    return { dashboardLabel, panelId: 201, metricName: bare ? f.sampler : `${t}.${f.sampler}` };
  }
  return { dashboardLabel, panelId: 101, metricName: f.transaction ?? '' };
}

// QueryStats rather than ShowChart: the perf-analysis menus already use ShowChart for
// "View Time-Series Graph" two rows up.
const CARD_ITEMS: { card: LinkableCard; label: string; icon: React.ReactNode }[] = [
  { card: 'graphs', label: 'Open in Graphs', icon: <QueryStatsIcon fontSize="small" /> },
  { card: 'compare', label: 'Open in Compare', icon: <CompareArrowsIcon fontSize="small" /> },
  { card: 'trends', label: 'Open in Trends', icon: <TimelineIcon fontSize="small" /> },
];
export const LINKABLE_CARDS: readonly LinkableCard[] = CARD_ITEMS.map((c) => c.card);

/**
 * Three menu items, each a real link to a new tab. Reads the run id from the route so no
 * caller has to thread it down; only rendered under /test-runs/[id].
 */
export function OpenInCardMenuItems({ series, onClose }: { series: MetricSeriesRef | null; onClose: () => void }) {
  const params = useParams();
  const testRunId = typeof params?.id === 'string' ? params.id : '';
  if (!series || !testRunId || !series.metricName) return null;
  return (
    <>
      {CARD_ITEMS.map(({ card, label, icon }) => (
        <MenuItem
          key={card}
          component="a"
          href={buildCardLink(testRunId, card, series)}
          target="_blank"
          rel="noopener"
          onClick={onClose}
        >
          <ListItemIcon>{icon}</ListItemIcon>
          <ListItemText>{label}</ListItemText>
          <OpenInNewIcon sx={{ fontSize: 14, ml: 1.5, color: 'text.secondary' }} />
        </MenuItem>
      ))}
    </>
  );
}

/**
 * Same-tab jump to Performance Analysis → Overview with the scenario and transaction filters
 * set. Provided once by the page; six prop hops otherwise, per card.
 */
export const PerformanceAnalysisDrillDownContext =
  createContext<((filters: DrillDownFilters) => void) | undefined>(undefined);

export function ViewInPerformanceAnalysisMenuItem({ filters, onClose }: { filters: DrillDownFilters | null; onClose: () => void }) {
  const drillDown = useContext(PerformanceAnalysisDrillDownContext);
  if (!drillDown || !filters?.transaction) return null;
  return (
    <MenuItem onClick={() => { drillDown(filters); onClose(); }}>
      <ListItemIcon><SpeedIcon fontSize="small" /></ListItemIcon>
      <ListItemText>View in Performance Analysis</ListItemText>
    </MenuItem>
  );
}
