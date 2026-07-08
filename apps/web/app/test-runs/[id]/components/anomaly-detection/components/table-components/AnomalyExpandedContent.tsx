'use client';

import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  IconButton,
  Divider,
  Collapse,
} from '@mui/material';
import {
  Info,
  Close,
  Settings,
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
import dynamic from 'next/dynamic';
import { AnomalyData, MetricTrendData } from '../../types';
import { TestRun } from '@/types/test-runs';
import CurrentTestRunChart from '../../../compare/CurrentTestRunChart';
import type { AggregatedMetricSource } from '../../../compare/current-test-run-chart/types';
import MetricConfigForm from '../../../configuration-comparison/MetricConfigForm';
import { createTrendsPlot } from '../utils/trends-plot-utils';
import { StatisticalDrawerContent } from './StatisticalDrawerContent';

const VALID_STATS = new Set(['avg', 'p50', 'p90', 'p95', 'p99', 'max']);

function parseAggregatedMetricSource(metricName: string, sourceType?: string | null): AggregatedMetricSource | undefined {
  if (sourceType !== 'performance_test') return undefined;

  const parts = metricName.split('.');
  if (parts.length < 3) return undefined;

  const type = parts[0];
  const lastPart = parts[parts.length - 1];
  const hasAggregation = parts.length >= 4 && VALID_STATS.has(lastPart);
  const baseName = hasAggregation ? parts[parts.length - 2] : lastPart;
  const stat = hasAggregation ? lastPart : 'avg';

  if (baseName === 'error_rate') {
    return { metric: 'error_percentage', stat: 'avg' };
  }
  if (baseName !== 'response_time') return undefined;
  if (type === 'transactions') return { metric: 'transaction_response_time', stat };
  if (type === 'requests') return { metric: 'request_response_time', stat };
  return undefined;
}

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface AnomalyExpandedContentProps {
  row: AnomalyData;
  rowKey: string;
  isExpanded: boolean;
  isLast: boolean;
  testRunId: string;
  testRun?: TestRun | null;
  trendsData?: MetricTrendData[];
  trendsLoading: boolean;
  chartKey: number;
  drawerOpen: boolean;
  drawerData: unknown;
  drawerLoading: boolean;
  showConfigForm: boolean;
  showToast?: (message: string) => void;
  selectedTestRunIdForRow?: string;
  onDrawerToggle: () => void;
  onConfigFormToggle: () => void;
  onConfigSave: (rowKey: string, data: unknown, scope: 'metric' | 'panel') => Promise<void>;
  onSelectTestRun: (testRunId: string) => void;
  onResetSelectedTestRun: () => void;
}

export function AnomalyExpandedContent({
  row,
  rowKey,
  isExpanded,
  isLast,
  testRunId,
  testRun,
  trendsData,
  trendsLoading,
  chartKey,
  drawerOpen,
  drawerData,
  drawerLoading,
  showConfigForm,
  showToast,
  selectedTestRunIdForRow,
  onDrawerToggle,
  onConfigFormToggle,
  onConfigSave,
  onSelectTestRun,
  onResetSelectedTestRun,
}: AnomalyExpandedContentProps) {
  const theme = useTheme();

  const aggregatedMetricSource = useMemo(
    () => parseAggregatedMetricSource(row.metric_name, row.source_type),
    [row.metric_name, row.source_type]
  );

  // Generate trends plot data
  const getTrendsPlotData = (trendData: MetricTrendData[], unit?: string) => {
    return createTrendsPlot(trendData, rowKey, row.metric_name, theme, showToast, unit, selectedTestRunIdForRow, testRunId);
  };

  return (
    <Collapse
      in={isExpanded}
      timeout="auto"
      unmountOnExit
      // Plotly draws once when it mounts. Inside a Collapse it mounts mid-animation
      // at partial height and never re-measures (useResizeHandler only listens to
      // window resize, not container resize), so hover-label geometry stays stale
      // and the tooltip box detaches from its text. Kick a window resize when the
      // Collapse settles so the existing useResizeHandler relayouts at full height.
      onEntered={() => window.dispatchEvent(new Event('resize'))}
    >
      <Box sx={{
        backgroundColor: alpha(theme.palette.primary.main, 0.02),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
        borderTop: 'none',
        borderRadius: isLast ? '0 0 8px 8px' : '0',
        position: 'relative',
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Left side - Trends chart */}
        <Box sx={{
          width: drawerOpen ? 'calc(100% - 520px)' : '100%',
          p: 3,
          transition: 'width 0.3s ease',
          minWidth: 0,
          overflow: 'hidden'
        }}>
          {/* Info button to open drawer */}
          {!drawerOpen && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Info />}
                onClick={onDrawerToggle}
                sx={{
                  borderColor: 'primary.main',
                  color: 'primary.main',
                  '&:hover': {
                    backgroundColor: 'primary.main',
                    color: 'white'
                  }
                }}
              >
                Statistical Analysis
              </Button>
            </Box>
          )}

          {/* Trend Header */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
              Trend
            </Typography>
          </Box>

          {trendsLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" py={4}>
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                Loading control group trends...
              </Typography>
            </Box>
          ) : trendsData && trendsData.length > 0 ? (
            <Box sx={{
              width: '100%',
              height: '400px',
              backgroundColor: theme.palette.background.paper,
              borderRadius: 1,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: theme.shadows[1],
              overflow: 'hidden',
              '& .plotly .scatterlayer .trace .points path': {
                cursor: 'pointer !important'
              },
              '& .plotly .scatterlayer .trace .points': {
                cursor: 'pointer !important'
              }
            }}>
              {(() => {
                const trendUnit = trendsData.length > 0 && trendsData[0].unit ? trendsData[0].unit : row.unit;
                const { plotData, plotLayout, plotConfig } = getTrendsPlotData(trendsData, trendUnit ?? undefined);
                return (
                  <Plot
                    key={`${rowKey}-${chartKey || 0}-${drawerOpen ? 'open' : 'closed'}-${selectedTestRunIdForRow || 'none'}`}
                    data={plotData}
                    layout={plotLayout}
                    config={plotConfig}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler={true}
                    onInitialized={(_figure: unknown, rawGraphDiv: unknown) => {
                      const graphDiv = rawGraphDiv as { on: (event: string, handler: (data: { points?: Array<{ customdata?: { testRunId?: string } }> }) => void) => void; style?: CSSStyleDeclaration; querySelector: (sel: string) => { style?: CSSStyleDeclaration } | null };
                      graphDiv.on('plotly_click', (data: { points?: Array<{ customdata?: { testRunId?: string } }> }) => {
                        if (data.points && data.points.length > 0) {
                          const clickedPoint = data.points[0];
                          const clickedTestRunId = clickedPoint.customdata?.testRunId;
                          if (clickedTestRunId) {
                            onSelectTestRun(clickedTestRunId);
                            if (showToast) {
                              showToast(`Selected test run: ${clickedTestRunId}`);
                            }
                          }
                        }
                      });

                      graphDiv.on('plotly_hover', (data: { points?: Array<{ customdata?: { testRunId?: string } }> }) => {
                        if (data.points && data.points.length > 0) {
                          if (graphDiv.style) {
                            graphDiv.style.cursor = 'pointer';
                          }
                          const plotArea = graphDiv.querySelector('.nsewdrag');
                          if (plotArea && plotArea.style) {
                            plotArea.style.cursor = 'pointer';
                          }
                          const mainLayer = graphDiv.querySelector('.main-svg');
                          if (mainLayer && mainLayer.style) {
                            mainLayer.style.cursor = 'pointer';
                          }
                        }
                      });

                      graphDiv.on('plotly_unhover', () => {
                        if (graphDiv.style) {
                          graphDiv.style.cursor = 'default';
                        }
                        const plotArea = graphDiv.querySelector('.nsewdrag');
                        if (plotArea && plotArea.style) {
                          plotArea.style.cursor = 'default';
                        }
                        const mainLayer = graphDiv.querySelector('.main-svg');
                        if (mainLayer && mainLayer.style) {
                          mainLayer.style.cursor = 'default';
                        }
                      });
                    }}
                  />
                );
              })()}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
              No control group trend data available for this metric.
            </Typography>
          )}

          {/* Current Test Run Chart */}
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {selectedTestRunIdForRow && selectedTestRunIdForRow !== testRunId
                  ? `Selected Test Run: ${selectedTestRunIdForRow}`
                  : 'Current Test Run Details'}
              </Typography>
              {selectedTestRunIdForRow && selectedTestRunIdForRow !== testRunId && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onResetSelectedTestRun}
                  sx={{
                    fontSize: '0.75rem',
                    py: 0.5,
                    px: 1.5,
                    borderColor: 'primary.main',
                    color: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main'
                    }
                  }}
                >
                  Reset to Current
                </Button>
              )}
            </Box>
            {/*
              Render the Current Test Run chart for every row. Performance-test
              rows that resolve an aggregatedMetricSource (the whole-test aggregate
              SLO metrics, e.g. transactions.login.response_time.p95) use the
              aggregated-metric-timeseries endpoint; per-transaction ADAPT rows —
              whose metric_name is the plain transaction name and whose type/stat
              live in panel_title — pass aggregatedMetricSource={undefined} and
              fall back to the ds-metrics panel endpoint keyed by panel_id +
              metric_name (restores pre-#383 behaviour).
            */}
            <CurrentTestRunChart
              testRunId={selectedTestRunIdForRow || testRunId}
              applicationDashboardId={row.application_dashboard_id}
              panelId={row.panel_id}
              metricName={row.metric_name}
              testRun={(() => {
                // A different historical run selected via the trend graph: use its
                // start from trendsData, but reuse the current run's analysis-window
                // offsets (same SUT/env/workload config, not carried in trendsData)
                // so it renders the same markers as Current Test Run Details.
                // end_time falls back to the metrics data range in the chart.
                if (selectedTestRunIdForRow && selectedTestRunIdForRow !== testRunId && trendsData) {
                  const selectedTrendData = trendsData.find(t => t.test_run_id === selectedTestRunIdForRow);
                  if (selectedTrendData) {
                    return {
                      start_time: selectedTrendData.test_run_start,
                      end_time: undefined,
                      analysis_start_offset: testRun?.analysis_start_offset,
                      analysis_end_offset: testRun?.analysis_end_offset
                    };
                  }
                }
                return testRun ? {
                  start_time: testRun.start_time,
                  end_time: testRun.end_time || undefined,
                  // Draw the same analysis-window markers the SLO charts use.
                  analysis_start_offset: testRun.analysis_start_offset,
                  analysis_end_offset: testRun.analysis_end_offset
                } : undefined;
              })()}
              thresholds={trendsData && trendsData.length > 0 ? trendsData.find(t => t.test_run_id === (selectedTestRunIdForRow || testRunId))?.thresholds : undefined}
              unit={row.unit}
              isDrawerOpen={drawerOpen}
              showToast={showToast}
              aggregatedMetricSource={aggregatedMetricSource}
            />
          </Box>
        </Box>

        {/* Right side drawer for detailed stats */}
        <Box sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: drawerOpen ? '520px' : '0',
          backgroundColor: 'background.paper',
          borderLeft: drawerOpen ? '1px solid' : 'none',
          borderColor: 'divider',
          overflow: 'hidden',
          transition: 'width 0.3s ease',
          zIndex: 1
        }}>
          {drawerOpen && (
            <Box sx={{ p: 2, maxHeight: '100%', overflow: 'auto' }}>
              {/* Drawer header */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontSize: '0.95rem', fontWeight: 600 }}>
                  {showConfigForm ? 'Metric Configuration' : 'Statistical Analysis'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {!showConfigForm && (
                    <IconButton
                      size="small"
                      onClick={onConfigFormToggle}
                      sx={{
                        color: 'primary.main',
                        '&:hover': {
                          backgroundColor: 'primary.main',
                          color: 'white'
                        }
                      }}
                      title="Configure Metric"
                    >
                      <Settings fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (showConfigForm) {
                        onConfigFormToggle();
                      } else {
                        onDrawerToggle();
                      }
                    }}
                    sx={{ color: 'text.secondary' }}
                  >
                    <Close fontSize="small" />
                  </IconButton>
                </Box>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Drawer content */}
              {showConfigForm ? (
                <MetricConfigForm
                  configData={{
                    rowKey,
                    systemUnderTestId: testRun?.system_under_test_id || '',
                    testEnvironment: testRun?.test_environment || '',
                    workload: testRun?.workload || '',
                    applicationDashboardId: row.application_dashboard_id,
                    panelId: row.panel_id,
                    panelTitle: row.panel_title || 'Unknown Panel',
                    metricName: row.metric_name,
                    dashboardLabel: row.dashboard_label || 'Unknown Dashboard',
                    currentConfig: (() => {
                      const drawerRecord = drawerData as Record<string, unknown> | undefined;
                      type NestedConfig = Record<string, unknown>;
                      const existingConfig = (drawerRecord?.compare_config as NestedConfig) || {} as NestedConfig;
                      const mc = existingConfig.metricClassification as NestedConfig | undefined;
                      const th = existingConfig.thresholds as NestedConfig | undefined;
                      const pctThreshold = th?.percentageThreshold ?? existingConfig.percentageThreshold ?? existingConfig.percentage_threshold ?? existingConfig.threshold_percentage;
                      return {
                        ignore: existingConfig.ignore || false,
                        metricClassification: {
                          classification: mc?.classification ?? existingConfig.classification ?? row.classification ?? 'unclassified',
                          higherIsBetter: mc?.higherIsBetter ?? existingConfig.higherIsBetter ?? existingConfig.higher_is_better ?? false
                        },
                        thresholds: {
                          aggregation: th?.aggregation ?? existingConfig.aggregation ?? existingConfig.statistic ?? 'mean',
                          percentageThreshold: pctThreshold !== undefined && pctThreshold !== null ?
                            ((pctThreshold as number) < 1 ? (pctThreshold as number) * 100 : pctThreshold as number) : 15,
                          iqrThreshold: th?.iqrThreshold ?? existingConfig.iqrThreshold ?? existingConfig.iqr_threshold ?? existingConfig.threshold_iqr ?? 2,
                          absoluteThreshold: th?.absoluteThreshold ?? existingConfig.absoluteThreshold ?? existingConfig.absolute_threshold ?? existingConfig.threshold_absolute ?? null
                        },
                        defaultValueIfControlGroupMissing: existingConfig.defaultValueIfControlGroupMissing ?? existingConfig.default_value_if_control_group_missing ?? null,
                        configSource: existingConfig.source ?? 'global'
                      } as { ignore?: boolean; metricClassification?: { classification: string; higherIsBetter: boolean }; thresholds?: { aggregation: string; percentageThreshold: number; iqrThreshold: number; absoluteThreshold: number }; configSource?: string };
                    })()
                  }}
                  onSave={onConfigSave}
                  onCancel={onConfigFormToggle}
                />
              ) : (
                <StatisticalDrawerContent
                  drawerData={drawerData}
                  drawerLoading={drawerLoading}
                  row={row}
                />
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Collapse>
  );
}
