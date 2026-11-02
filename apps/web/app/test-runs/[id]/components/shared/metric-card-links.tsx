'use client';

/**
 * "Open in Graphs / Compare / Trends" for any row that names a series, and the in-page
 * "View in Performance Analysis" drill-down.
 *
 * Each item is a real link whose URL carries the series (`?card=graphs&dashboard=…&panel=…&metric=…`):
 * a new tab (the trailing icon, a modified or middle click, Copy link) lands on it, the page reads
 * `card` to open the Reporting tab and expand that card, and the shared MetricSeriesCascade reads
 * the other three to preselect its dropdowns. A plain click never navigates: it hands the series
 * to the card on this page (CardLinkRequestContext), so nothing reloads and every click adds.
 */

import React, { createContext, useContext, useId } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { IconButton, ListItemIcon, ListItemText, MenuItem, Tooltip } from '@mui/material';
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

/**
 * What identifies one stored series across every card: the cascade matches on exactly these.
 * Omitting `panelId`/`metricName` means "the whole dashboard" — the cascade then picks every
 * panel and every series it has. That is the only useful unit for a Dynatrace host, whose
 * panel ids are minted per query and so cannot be named by a caller.
 */
export interface MetricSeriesRef {
  dashboardLabel: string;
  panelId?: number;
  metricName?: string;
}

/** The page's own params, which useTestRunData scopes the run by: a new tab needs them too. */
const KEEP_PARAMS = ['system', 'environment', 'workload', 'organizationId'];

export function buildCardLink(testRunId: string, card: LinkableCard, ref: MetricSeriesRef, keep?: URLSearchParams): string {
  const q = new URLSearchParams({ card, dashboard: ref.dashboardLabel });
  if (ref.panelId !== undefined) q.set('panel', String(ref.panelId));
  if (ref.metricName !== undefined) q.set('metric', ref.metricName);
  for (const key of KEEP_PARAMS) {
    const value = keep?.get(key);
    if (value) q.set(key, value);
  }
  return `/test-runs/${encodeURIComponent(testRunId)}?${q.toString()}`;
}

/** The URL params the cascade preselects from, or null when the link is for another card. */
export function readCardLinkPreselect(
  params: { get(name: string): string | null },
  card: LinkableCard,
): MetricSeriesRef | null {
  if (params.get('card') !== card) return null;
  const dashboardLabel = params.get('dashboard');
  if (!dashboardLabel) return null;
  const rawPanel = params.get('panel');
  const rawMetric = params.get('metric');
  // Absent is "all"; present-but-empty or malformed is a broken link, not a wildcard.
  if (rawPanel === null) return rawMetric === null ? { dashboardLabel } : null;
  const panelId = Number(rawPanel);
  // Number('') is 0, which would pass isInteger.
  if (!rawPanel || !Number.isInteger(panelId)) return null;
  if (rawMetric === null) return { dashboardLabel, panelId };
  if (!rawMetric) return null;
  return { dashboardLabel, panelId, metricName: rawMetric };
}

/** The dashboard a Dynatrace host's metrics hang off — mirrors hostDashboardLabel in the API. */
export function dynatraceHostSeriesRef(hostDisplayName: string): MetricSeriesRef {
  return { dashboardLabel: `Dynatrace host metrics ${hostDisplayName}` };
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
 * One explicit "Open in …" click on this page. `id` is unique within the page instance, so each
 * click is a new walk (the same series again after a removal, A→B→A) while a card that merely
 * remounts — a collapse and re-expand — sees an id it already walked.
 */
export interface CardLinkRequest {
  card: LinkableCard;
  ref: MetricSeriesRef;
  id: number;
}

/**
 * The page's latest in-page link request, and the link keys its cascades already walked. The
 * set lives with the page, so a fresh page (reload, Back, prev/next) walks a URL link again.
 * The default serves a cascade rendered outside the page: its set is module-wide and never
 * cleared, shared by every such cascade (the cascade tests rely on unique link keys for it).
 */
export const CardLinkRequestContext = createContext<{ request: CardLinkRequest | null; consumed: Set<string> }>({
  request: null,
  consumed: new Set(),
});

/** Hands a series to its card on this page: switches tab, expands the card, records the request. */
export const OpenCardLinkContext = createContext<((card: LinkableCard, ref: MetricSeriesRef) => void) | undefined>(undefined);

const isApplePlatform = () => {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
};

/**
 * The clicks the browser itself turns into a new tab or window: the platform's new-tab modifier
 * (Cmd on Apple, Ctrl elsewhere) or Shift. Anything else stays on this page: Alt-click would
 * download the link, and Ctrl-click on a Mac is a plain same-tab follow that would reload the
 * page and drop every kept-mounted tab's state.
 */
const opensElsewhere = (e: React.MouseEvent) => (isApplePlatform() ? e.metaKey : e.ctrlKey) || e.shiftKey;

/**
 * Three menu items, each a real link that a plain click keeps on this page, and that a modified
 * or middle click, the trailing icon, or Copy link opens elsewhere. Reads the run id from the
 * route so no caller has to thread it down; only rendered under /test-runs/[id].
 */
export function OpenInCardMenuItems({ series, onClose }: { series: MetricSeriesRef | null; onClose: () => void }) {
  const params = useParams();
  const searchParams = useSearchParams();
  const openCardLink = useContext(OpenCardLinkContext);
  const hintId = useId();
  const testRunId = typeof params?.id === 'string' ? params.id : '';
  // An absent metric name means "every series on the dashboard"; an EMPTY one means the row
  // has no target to link (the SLO table renders those as "Series N").
  if (!series || !testRunId || !series.dashboardLabel || series.metricName === '') return null;
  // Name the platform's own new-tab modifier: Ctrl+Enter on a Mac is a plain same-tab follow.
  const newTabKey = isApplePlatform() ? 'Cmd' : 'Ctrl';
  return (
    <>
      {CARD_ITEMS.map(({ card, label, icon }) => {
        const href = buildCardLink(testRunId, card, series, searchParams);
        return (
          <MenuItem
            key={card}
            component="a"
            href={href}
            // The visible label, so the mouse-only icon's own label stays out of the row's name.
            aria-label={label}
            aria-describedby={`${hintId}-${card}`}
            onClick={(e: React.MouseEvent) => {
              // The browser's own new tab/window: let it follow the href.
              if (openCardLink && !opensElsewhere(e)) {
                e.preventDefault();
                openCardLink(card, series);
              }
              onClose();
            }}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {/* Keyboard path to a new tab: the browser's own modified Enter on the link. */}
            <span id={`${hintId}-${card}`} hidden>{`${newTabKey}+Enter opens it in a new tab`}</span>
            <Tooltip title="Open in new tab">
              <IconButton
                component="span"
                role="button"
                tabIndex={-1}
                aria-label={`${label} in a new tab`}
                size="small"
                edge="end"
                sx={{ ml: 1 }}
                onClick={(e: React.MouseEvent) => {
                  // Inside the row's <a>: stop both the native follow and the row's hand-off.
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(href, '_blank', 'noopener');
                  onClose();
                }}
              >
                <OpenInNewIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              </IconButton>
            </Tooltip>
          </MenuItem>
        );
      })}
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
