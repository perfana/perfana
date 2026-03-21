'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Button,
  Collapse,
  CircularProgress
} from '@mui/material';
import { BarChart } from '@mui/icons-material';
import {
  MetricComparison,
  RelatedTestRun,
  Panel,
  ApplicationDashboard,
  GraphData,
  CompareSeries
} from '../types/compare.types';
import {
  getVisibleColumns,
  getGridTemplateColumns,
  getDiffColor,
  applyUnitConversion,
  formatCompareNumber,
  COLUMN_LABELS
} from '../utils/compare-utils';
import ComparisonPlot from './ComparisonPlot';
import { TestRun } from '@/types/test-runs';

interface MetricsComparisonTableProps {
  metricComparisons: MetricComparison[];
  selectedTestRun: RelatedTestRun;
  testRunId: string;
  showPercentiles: boolean;
  seriesSearchText: string;
  selectedMetric: Panel | null;
  selectedDashboard: ApplicationDashboard | null;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (metricName: string) => void;
  onShowGraphsChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onGraphDataChange: (update: (prev: Record<string, GraphData>) => Record<string, GraphData>) => void;
  onGraphLoadingChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
  addedSeries: CompareSeries[];
}

export default function MetricsComparisonTable({
  metricComparisons,
  selectedTestRun,
  testRunId,
  showPercentiles,
  seriesSearchText,
  selectedMetric,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  onShowGraphsChange,
  onGraphDataChange,
  onGraphLoadingChange,
  testRun,
  relatedTestRuns,
  showToast,
  addedSeries
}: MetricsComparisonTableProps) {
  const visibleColumns = getVisibleColumns(showPercentiles);
  const gridTemplateColumns = getGridTemplateColumns(showPercentiles);
  const panelYAxesFormat = selectedMetric?.yAxesFormat;

  // Group comparisons by metric name
  const metricGroups = metricComparisons.reduce((groups, comparison) => {
    if (!groups[comparison.metric_name]) {
      groups[comparison.metric_name] = [];
    }
    groups[comparison.metric_name].push(comparison);
    return groups;
  }, {} as Record<string, MetricComparison[]>);

  // Filter groups based on search text
  const filteredGroups = (() => {
    if (seriesSearchText === '') {
      return metricGroups;
    }

    const filtered = Object.fromEntries(
      Object.entries(metricGroups).filter(([metricName]) =>
        metricName.toLowerCase().includes(seriesSearchText.toLowerCase())
      )
    );

    // Clean up graph state for metrics that are no longer visible
    const visibleMetricNames = Object.keys(filtered);
    const currentGraphKeys = Object.keys(showGraphs);
    const graphKeysToRemove = currentGraphKeys.filter(key => !visibleMetricNames.includes(key));

    if (graphKeysToRemove.length > 0) {
      onShowGraphsChange(prev => {
        const newState = { ...prev };
        graphKeysToRemove.forEach(key => delete newState[key]);
        return newState;
      });
      onGraphDataChange(prev => {
        const newState = { ...prev };
        graphKeysToRemove.forEach(key => delete newState[key]);
        return newState;
      });
      onGraphLoadingChange(prev => {
        const newState = { ...prev };
        graphKeysToRemove.forEach(key => delete newState[key]);
        return newState;
      });
    }

    return filtered;
  })();

  return (
    <>
      {Object.entries(filteredGroups).map(([metricName, comparisons]) => (
        <Box key={metricName} sx={{ mb: 3 }}>
          {/* Table for each metric */}
          <Box sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden'
          }}>
            {/* Table Header with metric name */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns,
              gap: 0,
              background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.06) 50%, rgba(25, 118, 210, 0.04) 100%)',
              borderBottom: '2px solid',
              borderColor: 'rgba(25, 118, 210, 0.15)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
              backdropFilter: 'blur(8px)'
            }}>
              <Box sx={{ p: 2.5, borderRight: '1px solid', borderColor: 'rgba(25, 118, 210, 0.15)' }}>
                <Typography variant="subtitle2" sx={{
                  fontWeight: 700,
                  color: 'primary.dark',
                  fontSize: '0.85rem',
                  letterSpacing: '0.5px',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere'
                }}>
                  {metricName}
                </Typography>
              </Box>
              {visibleColumns.map((col) => (
                <Box key={col} sx={{ p: 2.5, borderRight: '1px solid', borderColor: 'rgba(25, 118, 210, 0.15)', textAlign: 'center' }}>
                  <Typography variant="subtitle2" sx={{
                    fontWeight: 700,
                    color: 'primary.dark',
                    fontSize: '0.85rem',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase'
                  }}>
                    {COLUMN_LABELS[col]}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Baseline Test Run Row */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns,
              gap: 0,
              backgroundColor: 'background.paper',
              borderBottom: '1px solid',
              borderColor: 'divider'
            }}>
              <Box sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label="BASELINE"
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
                    color: 'rgba(156, 39, 176, 0.9)',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    height: '20px',
                    border: '1px solid rgba(156, 39, 176, 0.2)'
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.75rem' }}>
                  {selectedTestRun.test_run_id}
                </Typography>
              </Box>
              {visibleColumns.map((evaluateType) => {
                const comparison = comparisons.find(c => c.evaluate_type === evaluateType);
                const baselineValue = comparison?.selected_value;

                return (
                  <Box key={evaluateType} sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {formatCompareNumber(baselineValue, panelYAxesFormat)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {/* Current Test Run Row */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns,
              gap: 0,
              backgroundColor: 'action.hover',
              borderBottom: '1px solid',
              borderColor: 'divider'
            }}>
              <Box sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label="CURRENT"
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                    color: 'rgba(25, 118, 210, 0.9)',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    height: '20px',
                    border: '1px solid rgba(25, 118, 210, 0.2)'
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.75rem' }}>
                  {testRunId}
                </Typography>
              </Box>
              {visibleColumns.map((evaluateType) => {
                const comparison = comparisons.find(c => c.evaluate_type === evaluateType);
                return (
                  <Box key={evaluateType} sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {formatCompareNumber(comparison?.current_value ?? null, panelYAxesFormat)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {/* Difference Row with absolute and relative values */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns,
              gap: 0,
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }}>
              <Box sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
                  Difference
                </Typography>
              </Box>
              {visibleColumns.map((evaluateType) => {
                const comparison = comparisons.find(c => c.evaluate_type === evaluateType);
                const currentValue = comparison?.current_value;
                const baselineValue = comparison?.selected_value;
                const absoluteDiff = currentValue !== null && currentValue !== undefined &&
                  baselineValue !== null && baselineValue !== undefined
                  ? currentValue - baselineValue
                  : null;
                const convertedAbsoluteDiff = applyUnitConversion(absoluteDiff, panelYAxesFormat);
                const percentDiff = comparison?.percentage_difference;

                return (
                  <Box key={evaluateType} sx={{ p: 1.5, borderRight: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
                    {convertedAbsoluteDiff != null && percentDiff != null ? (
                      <>
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: getDiffColor(percentDiff)
                          }}
                        >
                          {convertedAbsoluteDiff > 0 ? '+' : ''}{convertedAbsoluteDiff.toFixed(2)}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: getDiffColor(percentDiff)
                          }}
                        >
                          ({percentDiff > 0 ? '+' : ''}{percentDiff.toFixed(1)}%)
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.secondary' }}>
                        -
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* Show graph button row */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 0,
              backgroundColor: 'primary.main',
              color: 'white'
            }}>
              <Box sx={{
                p: 1.5,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 1
              }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={graphLoading[metricName] ? <CircularProgress size={16} color="inherit" /> : <BarChart />}
                  onClick={() => onToggleGraph(metricName)}
                  disabled={graphLoading[metricName]}
                  sx={{
                    backgroundColor: 'white',
                    color: 'primary.main',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    px: 2,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': {
                      backgroundColor: 'action.selected',
                      transform: 'translateY(-1px)'
                    },
                    '&:disabled': {
                      backgroundColor: 'grey.200',
                      color: 'grey.500'
                    }
                  }}
                >
                  {showGraphs[metricName] ? 'Hide Graph' : 'Show Graph'}
                </Button>
              </Box>
            </Box>

            {/* Expandable graph row */}
            <Collapse in={showGraphs[metricName]}>
              <Box sx={{
                p: 2,
                backgroundColor: 'action.hover',
                borderTop: '1px solid',
                borderColor: 'divider'
              }}>
                <ComparisonPlot
                  metricName={metricName}
                  graphData={graphData[metricName]}
                  graphLoading={graphLoading[metricName]}
                  selectedMetric={selectedMetric}
                  testRun={testRun}
                  relatedTestRuns={relatedTestRuns}
                  showToast={showToast}
                />
              </Box>
            </Collapse>
          </Box>
        </Box>
      ))}
    </>
  );
}
