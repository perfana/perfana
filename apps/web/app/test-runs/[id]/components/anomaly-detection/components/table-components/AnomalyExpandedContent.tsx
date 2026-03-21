'use client';

import React from 'react';
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
import MetricConfigForm from '../../../configuration-comparison/MetricConfigForm';
import { createTrendsPlot } from '../utils/trends-plot-utils';
import { StatisticalDrawerContent } from './StatisticalDrawerContent';

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
  drawerData: any;
  drawerLoading: boolean;
  showConfigForm: boolean;
  showToast?: (message: string) => void;
  selectedTestRunIdForRow?: string;
  onDrawerToggle: () => void;
  onConfigFormToggle: () => void;
  onConfigSave: (rowKey: string, data: any) => void;
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

  // Generate trends plot data
  const getTrendsPlotData = (trendData: MetricTrendData[], unit?: string) => {
    return createTrendsPlot(trendData, rowKey, row.metric_name, theme, showToast, unit, selectedTestRunIdForRow, testRunId);
  };

  return (
    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
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
                    onInitialized={(figure: any, graphDiv: any) => {
                      graphDiv.on('plotly_click', (data: any) => {
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

                      graphDiv.on('plotly_hover', (data: any) => {
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
            <CurrentTestRunChart
              testRunId={selectedTestRunIdForRow || testRunId}
              applicationDashboardId={row.application_dashboard_id}
              panelId={row.panel_id}
              metricName={row.metric_name}
              testRun={(() => {
                const effectiveTestRunId = selectedTestRunIdForRow || testRunId;
                if (selectedTestRunIdForRow && trendsData) {
                  const selectedTrendData = trendsData.find(t => t.test_run_id === selectedTestRunIdForRow);
                  if (selectedTrendData) {
                    return {
                      start_time: selectedTrendData.test_run_start,
                      end_time: undefined,
                      ramp_up_seconds: undefined
                    };
                  }
                }
                return testRun ? {
                  start_time: testRun.start_time,
                  end_time: testRun.end_time || undefined,
                  ramp_up_seconds: testRun.ramp_up_seconds || undefined
                } : undefined;
              })()}
              thresholds={trendsData && trendsData.length > 0 ? trendsData.find(t => t.test_run_id === (selectedTestRunIdForRow || testRunId))?.thresholds : undefined}
              unit={row.unit}
              isDrawerOpen={drawerOpen}
              showToast={showToast}
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
                      const existingConfig = drawerData?.compare_config || {};
                      return {
                        ignore: existingConfig.ignore || false,
                        metricClassification: {
                          classification: existingConfig.metricClassification?.classification || existingConfig.classification || row.classification || 'unclassified',
                          higherIsBetter: existingConfig.metricClassification?.higherIsBetter || existingConfig.higherIsBetter || existingConfig.higher_is_better || false
                        },
                        thresholds: {
                          aggregation: existingConfig.thresholds?.aggregation || existingConfig.aggregation || existingConfig.statistic || 'mean',
                          percentageThreshold: (() => {
                            const pctThreshold = existingConfig.thresholds?.percentageThreshold || existingConfig.percentageThreshold || existingConfig.percentage_threshold || existingConfig.threshold_percentage;
                            return pctThreshold !== undefined && pctThreshold !== null ?
                              (pctThreshold < 1 ? pctThreshold * 100 : pctThreshold) : 15;
                          })(),
                          iqrThreshold: existingConfig.thresholds?.iqrThreshold || existingConfig.iqrThreshold || existingConfig.iqr_threshold || existingConfig.threshold_iqr || 2,
                          absoluteThreshold: existingConfig.thresholds?.absoluteThreshold || existingConfig.absoluteThreshold || existingConfig.absolute_threshold || existingConfig.threshold_absolute || null
                        },
                        defaultValueIfControlGroupMissing: existingConfig.defaultValueIfControlGroupMissing || existingConfig.default_value_if_control_group_missing || null,
                        configSource: existingConfig.source || 'global'
                      };
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
