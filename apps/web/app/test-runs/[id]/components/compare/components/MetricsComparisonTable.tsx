'use client';

import React from 'react';
import { Box, Typography, Chip, Collapse, CircularProgress, IconButton } from '@mui/material';
import { ExpandMore, ExpandLess, BarChart } from '@mui/icons-material';
import {
  MetricComparison,
  RelatedTestRun,
  Panel,
  ApplicationDashboard,
  GraphData,
  CompareSeries,
} from '../types/compare.types';
import {
  DisplayConfig,
  toDiffThresholds,
  getMetricColumns,
  METRIC_COLUMN_LABELS,
  graphKeyOf,
  formatCompareNumber,
} from '../utils/compare-utils';
import {
  bandOf,
  worstBand,
  gatedDiffPercent,
  BAND_COLORS,
  Band,
  DiffThresholds,
} from '../utils/compare-bands';
import ComparisonPlot from './ComparisonPlot';
import { TestRun } from '@/types/test-runs';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

interface MetricRow {
  metricName: string;
  dashboardId: string;
  panelId: number;
  yAxesFormat?: string;
  isAggregated: boolean;
  byColumn: Record<string, MetricComparison>;
}

interface MetricsComparisonTableProps {
  metricComparisons: MetricComparison[];
  selectedTestRun: RelatedTestRun;
  testRunId: string;
  displayConfig: DisplayConfig;
  seriesSearchText: string;
  selectedMetric: Panel | null;
  selectedDashboard: ApplicationDashboard | null;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (row: { dashboardId: string; panelId: number; metricName: string }) => void;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
  addedSeries: CompareSeries[];
}

const fmt = (v: number | null | undefined, unit?: string): string =>
  v == null ? '—' : formatCompareNumber(v, unit);

function DeltaChip({ diff, thresholds }: { diff: number | null; thresholds: DiffThresholds }) {
  if (diff == null || diff === 0) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25,
        borderRadius: '999px', bgcolor: 'rgba(0,0,0,0.06)', color: 'text.secondary',
        fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>—</Box>
    );
  }
  const band = bandOf(diff, thresholds);
  const color = BAND_COLORS[band];
  const arrow = diff > 0 ? '▲' : '▼';
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25,
      borderRadius: '999px', bgcolor: `${color}22`, color, fontSize: '0.72rem', fontWeight: 700,
      fontVariantNumeric: 'tabular-nums' }}>
      {arrow} {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
    </Box>
  );
}

function MagnitudeBar({ diff, band }: { diff: number | null; band: Band }) {
  let left = 50, width = 0;
  if (diff != null) {
    const mag = Math.min(Math.abs(diff), 100) / 2; // 100% fills half the track
    if (diff >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
  }
  return (
    <Box sx={{ position: 'relative', width: 110, height: 4, borderRadius: 2, bgcolor: '#edf0f3' }}>
      <Box sx={{ position: 'absolute', left: '50%', top: -2, width: '1px', height: 8, bgcolor: '#ccd0d6' }} />
      <Box sx={{ position: 'absolute', top: 0, height: '100%', borderRadius: 2,
        left: `${left}%`, width: `${width}%`, bgcolor: BAND_COLORS[band] }} />
    </Box>
  );
}

function Cell({ c, thresholds }: { c: MetricComparison | undefined; thresholds: DiffThresholds }) {
  if (!c) return <Box sx={{ px: 2, py: 1.5, textAlign: 'right', color: 'text.secondary' }}>—</Box>;
  const d = gatedDiffPercent(c.current_value, c.selected_value, c.percentage_difference, thresholds.minAbsolute);
  const band = bandOf(d, thresholds);
  return (
    <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(c.current_value, c.yAxesFormat)}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          vs {fmt(c.selected_value, c.yAxesFormat)}
        </Typography>
      </Box>
      <DeltaChip diff={d} thresholds={thresholds} />
      <MagnitudeBar diff={d} band={band} />
    </Box>
  );
}

export default function MetricsComparisonTable({
  metricComparisons,
  selectedTestRun,
  displayConfig,
  seriesSearchText,
  selectedMetric,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  testRun,
  relatedTestRuns,
  showToast,
}: MetricsComparisonTableProps) {
  const thresholds = toDiffThresholds(displayConfig);
  const columns = getMetricColumns(displayConfig);
  const gridTemplateColumns = `minmax(180px, 2fr) ${columns.map(() => 'minmax(150px, 1fr)').join(' ')} 44px`;

  // Build rows, grouped dashboard -> panel -> metric.
  const search = seriesSearchText.trim().toLowerCase();
  const dashboards = new Map<string, Map<string, MetricRow[]>>();
  const rowsByMetric = new Map<string, MetricRow>();

  for (const c of metricComparisons) {
    if (search && !c.metric_name.toLowerCase().includes(search)) continue;
    const dashboardId = c.dashboardId ?? 'unknown';
    const panelId = c.panelId ?? 0;
    const rowKey = graphKeyOf(dashboardId, panelId, c.metric_name);
    let row = rowsByMetric.get(rowKey);
    if (!row) {
      row = {
        metricName: c.metric_name,
        dashboardId,
        panelId,
        yAxesFormat: c.yAxesFormat,
        isAggregated: c.metric_name.startsWith(`${ALL_AGGREGATED_OPTION} — `),
        byColumn: {},
      };
      rowsByMetric.set(rowKey, row);
      const dashLabel = c.dashboard_label ?? 'Metrics';
      const panelLabel = c.panel_title ?? '';
      if (!dashboards.has(dashLabel)) dashboards.set(dashLabel, new Map());
      const panels = dashboards.get(dashLabel)!;
      if (!panels.has(panelLabel)) panels.set(panelLabel, []);
      panels.get(panelLabel)!.push(row);
    }
    row.byColumn[c.evaluate_type] = c;
  }

  const rowDiffs = (row: MetricRow): (number | null)[] =>
    columns.map((col) => {
      const c = row.byColumn[col];
      return c ? gatedDiffPercent(c.current_value, c.selected_value, c.percentage_difference, thresholds.minAbsolute) : null;
    });

  const legendDot = (color: string, label: string) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} /> {label}
    </Box>
  );

  return (
    <Box>
      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2.5, mb: 3,
        color: 'text.secondary', fontSize: '0.78rem' }}>
        <span>Each cell: <strong>current</strong> · vs baseline · Δ%. Bar shows regression magnitude.</span>
        {legendDot(BAND_COLORS.good, `≤ ${displayConfig.warningThreshold}%`)}
        {legendDot(BAND_COLORS.warn, `${displayConfig.warningThreshold}–${displayConfig.regressionThreshold}%`)}
        {legendDot(BAND_COLORS.bad, `> ${displayConfig.regressionThreshold}%`)}
        {displayConfig.minAbsolute > 0 && <span>changes &lt; {displayConfig.minAbsolute} treated as none</span>}
        <Box component="span" sx={{ ml: 'auto', color: 'text.disabled' }}>
          baseline: {selectedTestRun.test_run_id}
        </Box>
      </Box>

      {Array.from(dashboards.entries()).map(([dashLabel, panels]) => (
        <Box key={dashLabel} sx={{ mb: 4 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, pl: 1.5,
            borderLeft: '4px solid', borderColor: 'primary.main' }}>
            {dashLabel}
          </Typography>

          {Array.from(panels.entries()).map(([panelLabel, rows]) => {
            let reg = 0, warn = 0, ok = 0;
            rows.forEach((row) => {
              const b = worstBand(rowDiffs(row), thresholds);
              if (b === 'bad') reg++; else if (b === 'warn') warn++; else ok++;
            });
            return (
              <Box key={panelLabel} sx={{ mb: 2.5, border: '1px solid', borderColor: 'divider',
                borderRadius: 1, overflow: 'hidden' }}>
                {/* Panel header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 1, px: 2, py: 1.25, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{panelLabel || 'Metrics'}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.75 }}>
                    {reg > 0 && <Chip size="small" label={`${reg} regressions`} sx={{ bgcolor: `${BAND_COLORS.bad}22`, color: BAND_COLORS.bad, fontWeight: 700 }} />}
                    {warn > 0 && <Chip size="small" label={`${warn} warnings`} sx={{ bgcolor: `${BAND_COLORS.warn}22`, color: BAND_COLORS.warn, fontWeight: 700 }} />}
                    {ok > 0 && <Chip size="small" label={`${ok} within range`} sx={{ bgcolor: `${BAND_COLORS.good}22`, color: BAND_COLORS.good, fontWeight: 700 }} />}
                  </Box>
                </Box>

                {/* Column header */}
                <Box sx={{ display: 'grid', gridTemplateColumns, alignItems: 'center',
                  borderBottom: '2px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                  <Box sx={{ px: 2, py: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>Metric</Typography>
                  </Box>
                  {columns.map((col) => (
                    <Box key={col} sx={{ px: 2, py: 1, textAlign: 'right' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                        {METRIC_COLUMN_LABELS[col] ?? col.toUpperCase()}
                      </Typography>
                    </Box>
                  ))}
                  <Box />
                </Box>

                {/* Metric rows */}
                {rows.map((row) => {
                  const band = worstBand(rowDiffs(row), thresholds);
                  const gKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
                  const open = !!showGraphs[gKey];
                  const loading = !!graphLoading[gKey];
                  return (
                    <Box key={gKey}>
                      <Box sx={{ display: 'grid', gridTemplateColumns, alignItems: 'stretch',
                        borderBottom: '1px solid', borderColor: 'divider',
                        borderLeft: '3px solid', borderLeftColor: BAND_COLORS[band] }}>
                        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            {row.metricName}
                          </Typography>
                        </Box>
                        {columns.map((col) => (
                          <Cell key={col} c={row.byColumn[col]} thresholds={thresholds} />
                        ))}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {!row.isAggregated && (
                            <IconButton size="small" onClick={() => onToggleGraph(row)} disabled={loading}
                              aria-label={open ? 'Hide graph' : 'Show graph'}>
                              {loading ? <CircularProgress size={16} /> : open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                            </IconButton>
                          )}
                        </Box>
                      </Box>
                      <Collapse in={open} unmountOnExit>
                        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'text.secondary' }}>
                            <BarChart fontSize="small" />
                            <Typography variant="caption">{row.metricName}</Typography>
                          </Box>
                          <ComparisonPlot
                            metricName={row.metricName}
                            graphData={graphData[gKey]}
                            graphLoading={loading}
                            selectedMetric={selectedMetric}
                            testRun={testRun}
                            relatedTestRuns={relatedTestRuns}
                            showToast={showToast}
                          />
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
