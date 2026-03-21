# Tracked Regressions Implementation Guide

## Overview

This document outlines the implementation plan for the **Tracked Regressions** feature in Perfana's Anomaly Detection system. The feature prevents performance regressions from "fading away" by tracking them across multiple test runs until explicitly resolved.

## Problem Statement: Regression Normalization

### The "Fading Regression" Issue

When a test run has:
- ✅ **SLOs pass** (meets requirements)
- ⚠️ **ADAPT detects anomalies** (performance regression)

The test run gets added to the control group because SLOs passed, causing:
- Future test runs are compared against this **degraded baseline**
- Eventually, the regression becomes the **new normal**
- Performance degradation silently becomes accepted

## Solution: Tracked Results System

The tracked results system ensures regressions remain visible until explicitly resolved by:
1. **Continuous tracking** of detected regressions
2. **Persistence** across test runs even if added to control group
3. **User feedback** required to resolve (accept/reject)
4. **Prevention** of silent baseline degradation

## Implementation Components

### 1. TLDR Card Enhancement

Add a tracked regressions chip to the collapsed Anomaly Detection card:

```typescript
// In AnomalyDetectionSection.tsx - collapsed state

interface TLDRChips {
  anomaliesDetected: number;
  classificationsCount: number;
  trackedRegressions: number; // NEW
}

// Tracked regressions chip component
<Chip
  label={`${trackedRegressions} Unresolved`}
  icon={<TrendingUpIcon />}
  onClick={(e) => {
    e.stopPropagation(); // Prevent card expansion
    handleExpandWithTrackedTab(); // Expand and switch to tracked tab
  }}
  sx={{
    background: 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
    color: 'white',
    fontWeight: 600,
    '&:hover': {
      transform: 'translateY(-1px)',
      boxShadow: '0 4px 12px rgba(255, 152, 0, 0.3)',
      cursor: 'pointer',
    }
  }}
/>
```

### 2. Tab Structure for Expanded Card

Modify the expanded Anomaly Detection card to include tabs:

```typescript
// Tab definitions - simplified to just two tabs
interface AnomalyDetectionTabs {
  'current': 'Current Anomalies',      // Current content (table + charts)
  'tracked': 'Unresolved Regressions'  // NEW TAB for tracked regressions
}

// Tab navigation component
<Tabs value={activeTab} onChange={handleTabChange}>
  <Tab label="Current Anomalies" value="current" />
  <Tab
    label={
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <span>Unresolved Regressions</span>
        {trackedCount > 0 && (
          <Badge badgeContent={trackedCount} color="warning" />
        )}
      </Box>
    }
    value="tracked"
  />
</Tabs>
```

### 3. TrackedRegressionsTab Component

Create new file: `apps/web/app/test-runs/[id]/components/TrackedRegressionsTab.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import {
  Box, Grid, Card, CardContent, Typography, Chip, Alert, AlertTitle,
  Button, ButtonGroup, Collapse, Badge, CircularProgress, IconButton,
  Tooltip, Select, MenuItem, Divider
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import NumbersIcon from '@mui/icons-material/Numbers';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { formatDate, formatMetricValue } from '@/lib/utils';

interface TrackedRegression {
  id: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  firstDetected: Date;
  testRunsAffected: number;
  currentValue: number;
  baselineValue: number;
  percentageChange: number;
  status: 'unresolved' | 'accepted' | 'denied';
  trackedTestRuns: string[];
  unit: string;
  conclusion: {
    label: string;
    confidence: number;
  };
}

interface TrackedRegressionsTabProps {
  testRunId: string;
  system: string;
  environment: string;
  workload: string;
}

export const TrackedRegressionsTab: React.FC<TrackedRegressionsTabProps> = ({
  testRunId,
  system,
  environment,
  workload
}) => {
  const [trackedRegressions, setTrackedRegressions] = useState<TrackedRegression[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchTrackedRegressions();
  }, [testRunId]);

  const fetchTrackedRegressions = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/adapt/tracked-regressions?testRunId=${testRunId}&system=${system}&environment=${environment}&workload=${workload}`,
        { headers: { ...getAuthHeaders() } }
      );
      const data = await response.json();

      // Sort by firstDetected date - oldest first for ordered resolution
      const sortedRegressions = data.regressions.sort((a: TrackedRegression, b: TrackedRegression) =>
        new Date(a.firstDetected).getTime() - new Date(b.firstDetected).getTime()
      );

      setTrackedRegressions(sortedRegressions);
    } catch (error) {
      console.error('Failed to fetch tracked regressions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolution = async (resolution: 'accepted' | 'denied', regressionId: string) => {
    try {
      const response = await fetch('/api/adapt/tracked-regressions/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          regressionId,
          resolution,
          excludeFromBaseline: resolution === 'denied'
        })
      });

      if (response.ok) {
        // Refresh the list
        await fetchTrackedRegressions();
        // Show success notification
        showNotification(`Regression marked as ${resolution}`, 'success');
      }
    } catch (error) {
      console.error('Failed to resolve regression:', error);
      showNotification('Failed to resolve regression', 'error');
    }
  };

  const toggleCardExpansion = (id: string) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (trackedRegressions.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="success">
          <AlertTitle>No Unresolved Regressions</AlertTitle>
          All performance regressions have been resolved or no regressions are currently being tracked.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Summary Alert */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <AlertTitle>Unresolved Regressions Require Attention</AlertTitle>
        These performance regressions were detected in previous test runs and are still present.
        They require explicit resolution to prevent baseline degradation.
        <strong> {trackedRegressions.length} unresolved regression(s) found.</strong>
      </Alert>

      {/* Tracked Regressions List - Ordered by Date (Oldest First) */}
      <Grid container spacing={2}>
        {trackedRegressions.map((regression, index) => (
          <Grid item xs={12} key={regression.id}>
            <TrackedRegressionCard
              regression={regression}
              expanded={expandedCards[regression.id] || false}
              onToggle={() => toggleCardExpansion(regression.id)}
              onResolve={handleResolution}
              isOldest={index === 0} // Only the oldest regression can be resolved
              position={index + 1} // Show position for user clarity
              totalCount={trackedRegressions.length}
            />
          </Grid>
        ))}
      </Grid>

      {/* Trend Chart Section */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Regression Trend Analysis
        </Typography>
        <TrackedDifferencesChart
          testRunId={testRunId}
          trackedRegressions={trackedRegressions}
        />
      </Box>
    </Box>
  );
};
```

### 4. Enhanced TrackedRegressionCard Component

```typescript
interface TrackedRegressionCardProps {
  regression: TrackedRegression;
  expanded: boolean;
  onToggle: () => void;
  onResolve: (resolution: 'accepted' | 'denied', id: string) => void;
  isOldest: boolean; // Only the oldest regression can be resolved
  position: number; // Position in the queue (1-based)
  totalCount: number; // Total number of tracked regressions
}

const TrackedRegressionCard: React.FC<TrackedRegressionCardProps> = ({
  regression,
  expanded,
  onToggle,
  onResolve,
  isOldest,
  position,
  totalCount
}) => {
  const [selectedMetric, setSelectedMetric] = useState<string>(regression.metricName);
  const [correlatedRegressions, setCorrelatedRegressions] = useState<TrackedRegression[]>([]);
  const [chartData, setChartData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const severityColor = Math.abs(regression.percentageChange) > 10 ? 'error' : 'warning';

  // Fetch correlated regressions when card expands
  useEffect(() => {
    if (expanded) {
      fetchCorrelatedRegressions();
    }
  }, [expanded, regression.id]);

  // Fetch chart data when metric selection changes
  useEffect(() => {
    if (expanded && selectedMetric) {
      fetchChartData();
    }
  }, [expanded, selectedMetric]);

  const fetchCorrelatedRegressions = async () => {
    setLoading(true);
    try {
      // Get all regressions from the same test run that introduced this tracked regression
      const response = await fetch(
        `/api/adapt/correlated-regressions?trackedRegressionId=${regression.id}&sourceTestRun=${regression.sourceTestRunId}`,
        { headers: { ...getAuthHeaders() } }
      );
      const data = await response.json();
      setCorrelatedRegressions(data.regressions);
    } catch (error) {
      console.error('Failed to fetch correlated regressions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async () => {
    try {
      const response = await fetch(
        `/api/adapt/tracked-regression-chart?trackedRegressionId=${regression.id}&metricName=${selectedMetric}`,
        { headers: { ...getAuthHeaders() } }
      );
      const data = await response.json();

      // Process data for visualization similar to anomaly detection
      const processedData = processTrackedRegressionData(data);
      setChartData(processedData);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    }
  };

  const processTrackedRegressionData = (data: any) => {
    // Separate data into different series based on test run classification
    const controlGroup = [];
    const introducedRegression = []; // The test run that introduced the regression
    const subsequentRuns = []; // Test runs after the regression was detected
    const thresholdUpper = [];
    const thresholdLower = [];

    data.testRuns.forEach((point: any, index: number) => {
      const plotPoint = { x: index, y: point.value, ...point };

      if (point.isControlGroup) {
        controlGroup.push(plotPoint);
      } else if (point.isSourceTestRun) {
        // The test run that introduced this tracked regression
        introducedRegression.push(plotPoint);
      } else {
        // Test runs after the regression was detected
        subsequentRuns.push(plotPoint);
      }

      // Add threshold lines
      if (point.thresholds) {
        thresholdUpper.push({ x: index, y: point.thresholds.upper });
        thresholdLower.push({ x: index, y: point.thresholds.lower });
      }
    });

    return [
      {
        name: 'Control Group (Baseline)',
        x: controlGroup.map(p => p.x),
        y: controlGroup.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'square',
          size: 8,
          color: 'rgb(77, 89, 231)',
          line: { color: 'white', width: 1 }
        },
        hovertemplate: '%{text}<extra></extra>',
        text: controlGroup.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${formatMetricValue(p.y, regression.unit)}<br>` +
          `Date: ${formatDate(p.date)}<br>` +
          `Status: Control Group`
        )
      },
      {
        name: 'Regression Introduced',
        x: introducedRegression.map(p => p.x),
        y: introducedRegression.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'x',
          size: 12,
          color: 'rgb(222, 45, 38)',
          line: { color: 'white', width: 2 }
        },
        hovertemplate: '%{text}<extra></extra>',
        text: introducedRegression.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${formatMetricValue(p.y, regression.unit)}<br>` +
          `Date: ${formatDate(p.date)}<br>` +
          `Status: ⚠️ Regression Detected<br>` +
          `Change: ${p.percentageChange > 0 ? '+' : ''}${p.percentageChange.toFixed(1)}%`
        )
      },
      {
        name: 'Subsequent Test Runs',
        x: subsequentRuns.map(p => p.x),
        y: subsequentRuns.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'triangle-up',
          size: 8,
          color: subsequentRuns.map(p =>
            p.hasRegression ? 'rgb(222, 45, 38)' : 'rgb(77, 89, 231)'
          ),
          line: { color: 'white', width: 1 }
        },
        hovertemplate: '%{text}<extra></extra>',
        text: subsequentRuns.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${formatMetricValue(p.y, regression.unit)}<br>` +
          `Date: ${formatDate(p.date)}<br>` +
          `Status: ${p.hasRegression ? 'Regression Still Present' : 'Normal'}`
        )
      },
      {
        name: 'Upper Threshold',
        x: thresholdUpper.map(p => p.x),
        y: thresholdUpper.map(p => p.y),
        type: 'scatter',
        mode: 'lines',
        line: {
          color: 'rgba(20, 191, 191, 0.8)',
          dash: 'dash',
          width: 2
        },
        showlegend: true,
        hoverinfo: 'skip'
      },
      {
        name: 'Lower Threshold',
        x: thresholdLower.map(p => p.x),
        y: thresholdLower.map(p => p.y),
        type: 'scatter',
        mode: 'lines',
        line: {
          color: 'rgba(10, 155, 10, 0.8)',
          dash: 'dash',
          width: 2
        },
        fill: 'tonexty',
        fillcolor: 'rgba(0, 255, 0, 0.08)',
        showlegend: true,
        hoverinfo: 'skip'
      }
    ];
  };

  return (
    <Card sx={{
      border: '1px solid',
      borderColor: 'warning.main',
      borderLeft: '4px solid',
      borderLeftColor: severityColor === 'error' ? 'error.main' : 'warning.main',
      '&:hover': {
        boxShadow: 2
      }
    }}>
      <CardContent>
        <Grid container alignItems="center" spacing={2}>
          <Grid item xs={12} md={8}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TrendingUpIcon color={severityColor} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {regression.metricName}
              </Typography>
              {/* Queue Position Indicator */}
              <Chip
                label={`#${position} of ${totalCount}`}
                size="small"
                color={isOldest ? "success" : "default"}
                variant={isOldest ? "filled" : "outlined"}
                sx={{
                  fontSize: '0.7rem',
                  height: '20px',
                  fontWeight: isOldest ? 700 : 400
                }}
              />
              {isOldest && (
                <Chip
                  label="NEXT TO RESOLVE"
                  size="small"
                  color="success"
                  sx={{
                    fontSize: '0.65rem',
                    height: '20px',
                    fontWeight: 700,
                    animation: 'pulse 2s ease-in-out infinite',
                    '@keyframes pulse': {
                      '0%': { opacity: 1 },
                      '50%': { opacity: 0.7 },
                      '100%': { opacity: 1 }
                    }
                  }}
                />
              )}
              <IconButton size="small" onClick={onToggle}>
                {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {regression.dashboardLabel} / {regression.panelTitle}
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip
                label={`First detected: ${formatDate(regression.firstDetected)}`}
                size="small"
                variant="outlined"
                icon={<CalendarTodayIcon />}
              />
              <Chip
                label={`${regression.testRunsAffected} test runs affected`}
                size="small"
                color="warning"
                icon={<NumbersIcon />}
              />
              <Chip
                label={`${regression.percentageChange > 0 ? '+' : ''}${regression.percentageChange.toFixed(1)}%`}
                size="small"
                color={severityColor}
                icon={<TrendingUpIcon />}
              />
              <Chip
                label={`Confidence: ${(regression.conclusion.confidence * 100).toFixed(0)}%`}
                size="small"
                variant="outlined"
              />
            </Box>
          </Grid>

          <Grid item xs={12} md={4}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              {isOldest ? (
                // Only the oldest regression can be resolved
                <ButtonGroup variant="outlined" size="small">
                  <Tooltip title="Mark this as a real regression and exclude from baseline">
                    <Button
                      color="error"
                      startIcon={<BlockIcon />}
                      onClick={() => onResolve('denied', regression.id)}
                    >
                      Mark as Regression
                    </Button>
                  </Tooltip>
                  <Tooltip title="Accept this as normal variability and keep in baseline">
                    <Button
                      color="success"
                      startIcon={<CheckCircleIcon />}
                      onClick={() => onResolve('accepted', regression.id)}
                    >
                      Mark as Variability
                    </Button>
                  </Tooltip>
                </ButtonGroup>
              ) : (
                // Other regressions show they are waiting in queue
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    Waiting in queue
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    Resolve oldest regression first
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      startIcon={<BlockIcon />}
                      disabled
                      sx={{
                        fontSize: '0.7rem',
                        height: '24px',
                        opacity: 0.5
                      }}
                    >
                      Mark as Regression
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="success"
                      startIcon={<CheckCircleIcon />}
                      disabled
                      sx={{
                        fontSize: '0.7rem',
                        height: '24px',
                        opacity: 0.5
                      }}
                    >
                      Mark as Variability
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          </Grid>
        </Grid>

        {/* Expandable Details */}
        <Collapse in={expanded}>
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            {/* Value Comparison */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={4}>
                <Typography variant="body2" color="text.secondary">
                  Baseline Value
                </Typography>
                <Typography variant="h6">
                  {formatMetricValue(regression.baselineValue, regression.unit)}
                </Typography>
              </Grid>
              <Grid item xs={4}>
                <Typography variant="body2" color="text.secondary">
                  Current Value
                </Typography>
                <Typography variant="h6" color={severityColor}>
                  {formatMetricValue(regression.currentValue, regression.unit)}
                </Typography>
              </Grid>
              <Grid item xs={4}>
                <Typography variant="body2" color="text.secondary">
                  Change
                </Typography>
                <Typography variant="h6" color={severityColor}>
                  {regression.percentageChange > 0 ? '+' : ''}{regression.percentageChange.toFixed(1)}%
                </Typography>
              </Grid>
            </Grid>

            {/* Metric Selection for Correlation Analysis */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Correlation Analysis
              </Typography>

              {loading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2">Loading correlated regressions...</Typography>
                </Box>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
                      Select Metric to Analyze:
                    </Typography>
                    <Select
                      value={selectedMetric}
                      onChange={(e) => setSelectedMetric(e.target.value)}
                      size="small"
                      fullWidth
                    >
                      {/* Primary tracked regression */}
                      <MenuItem value={regression.metricName}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TrendingUpIcon color="warning" fontSize="small" />
                          <strong>{regression.metricName}</strong>
                          <Chip label="Tracked" size="small" color="warning" />
                        </Box>
                      </MenuItem>

                      {/* Correlated regressions from same test run */}
                      {correlatedRegressions.map(correlated => (
                        <MenuItem key={correlated.metricName} value={correlated.metricName}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <WarningIcon color="error" fontSize="small" />
                            {correlated.metricName}
                            <Chip
                              label={`${correlated.percentageChange > 0 ? '+' : ''}${correlated.percentageChange.toFixed(1)}%`}
                              size="small"
                              color="error"
                            />
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
                      Regressions Detected Together:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {correlatedRegressions.length === 0 ? (
                        <Chip label="No other regressions detected" size="small" variant="outlined" />
                      ) : (
                        correlatedRegressions.map(correlated => (
                          <Chip
                            key={correlated.metricName}
                            label={`${correlated.metricName} (${correlated.percentageChange > 0 ? '+' : ''}${correlated.percentageChange.toFixed(1)}%)`}
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={() => setSelectedMetric(correlated.metricName)}
                            sx={{ cursor: 'pointer' }}
                          />
                        ))
                      )}
                    </Box>
                  </Grid>
                </Grid>
              )}
            </Box>

            {/* Trend Chart - Similar to Anomaly Detection Charts */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Regression Timeline: {selectedMetric}
              </Typography>

              {chartData ? (
                <Box sx={{
                  backgroundColor: 'background.paper',
                  borderRadius: 1,
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider'
                }}>
                  <Plot
                    data={chartData}
                    layout={{
                      title: {
                        text: `Performance Trend: ${selectedMetric}`,
                        font: { size: 14 }
                      },
                      xaxis: {
                        title: 'Test Run Sequence',
                        showgrid: true,
                        gridcolor: 'rgba(128,128,128,0.2)'
                      },
                      yaxis: {
                        title: `Value (${regression.unit})`,
                        showgrid: true,
                        gridcolor: 'rgba(128,128,128,0.2)'
                      },
                      height: 350,
                      hovermode: 'closest',
                      showlegend: true,
                      legend: {
                        orientation: 'h',
                        y: -0.3,
                        font: { size: 10 }
                      },
                      annotations: [
                        {
                          x: 0.02,
                          y: 0.98,
                          xref: 'paper',
                          yref: 'paper',
                          text: '🔍 Hover over points for details',
                          showarrow: false,
                          font: { size: 10, color: 'gray' }
                        }
                      ]
                    }}
                    config={{
                      displayModeBar: true,
                      displaylogo: false,
                      modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d']
                    }}
                    style={{ width: '100%' }}
                  />
                </Box>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress />
                </Box>
              )}
            </Box>

            {/* Affected Test Runs */}
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
              Affected Test Runs:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
              {regression.trackedTestRuns.map(testRunId => (
                <Chip
                  key={testRunId}
                  label={testRunId}
                  size="small"
                  onClick={() => window.open(`/test-runs/${testRunId}`, '_blank')}
                  sx={{
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                />
              ))}
            </Box>

            {/* Resolution Help Text */}
            <Alert severity="info" variant="outlined">
              <Typography variant="body2">
                <strong>Resolution Options:</strong>
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                • <strong>Mark as Regression:</strong> Confirms this is a real performance issue.
                The test run will be excluded from the baseline control group.
              </Typography>
              <Typography variant="body2">
                • <strong>Mark as Variability:</strong> Indicates this change is within acceptable limits.
                The test run remains in the control group.
              </Typography>
              {!isOldest && (
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, color: 'warning.main' }}>
                  ⚠️ <strong>Queue Resolution:</strong> Regressions must be resolved in order (oldest first).
                  This ensures consistent baseline management and prevents dependency conflicts.
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                💡 Use the correlation analysis above to understand if this regression occurred
                alongside other performance changes that might help identify the root cause.
              </Typography>
            </Alert>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};
```

### 5. Integration with AnomalyDetectionSection

Update the existing `AnomalyDetectionSection.tsx`:

```typescript
// Add to existing imports
import { TrackedRegressionsTab } from './TrackedRegressionsTab';

// Add to component state
const [activeTab, setActiveTab] = useState<'current' | 'tracked'>('current');
const [trackedCount, setTrackedCount] = useState<number>(0);

// Add effect to fetch tracked count
useEffect(() => {
  fetchTrackedRegressionsCount();
}, [testRunId]);

const fetchTrackedRegressionsCount = async () => {
  try {
    const response = await fetch(
      `/api/adapt/tracked-regressions/count?testRunId=${testRunId}`,
      { headers: { ...getAuthHeaders() } }
    );
    const data = await response.json();
    setTrackedCount(data.count);
  } catch (error) {
    console.error('Failed to fetch tracked regressions count:', error);
  }
};

// Handle chip click in collapsed state
const handleTrackedChipClick = (e: React.MouseEvent) => {
  e.stopPropagation();
  onExpand();
  // Delay tab switch to allow expansion animation
  setTimeout(() => setActiveTab('tracked'), 300);
};

// In the collapsed state render, add the tracked chip
{trackedCount > 0 && (
  <Chip
    label={`${trackedCount} Unresolved`}
    onClick={handleTrackedChipClick}
    // ... styling from above
  />
)}

// In the expanded state render, replace current content with tabs
<Box>
  <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)}>
    <Tab label="Current Anomalies" value="current" />
    <Tab
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span>Unresolved Regressions</span>
          {trackedCount > 0 && (
            <Badge badgeContent={trackedCount} color="warning" />
          )}
        </Box>
      }
      value="tracked"
    />
  </Tabs>

  {activeTab === 'current' && (
    <Box sx={{ mt: 2 }}>
      {/* Current anomaly detection content - table and charts */}
      <AnomalyMetricsTable data={metricsData} />
      <AnomalyCharts data={chartsData} />
    </Box>
  )}

  {activeTab === 'tracked' && (
    <TrackedRegressionsTab
      testRunId={testRunId}
      system={system}
      environment={environment}
      workload={workload}
    />
  )}
</Box>
```

### 6. TrackedDifferencesChart Component

Create `apps/web/app/test-runs/[id]/components/TrackedDifferencesChart.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Typography, CircularProgress, Select, MenuItem } from '@mui/material';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TrackedDifferencesChartProps {
  testRunId: string;
  trackedRegressions: TrackedRegression[];
}

export const TrackedDifferencesChart: React.FC<TrackedDifferencesChartProps> = ({
  testRunId,
  trackedRegressions
}) => {
  const [chartData, setChartData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<string>('');

  useEffect(() => {
    if (trackedRegressions.length > 0 && !selectedMetric) {
      setSelectedMetric(trackedRegressions[0].metricName);
    }
  }, [trackedRegressions]);

  useEffect(() => {
    if (selectedMetric) {
      fetchChartData();
    }
  }, [selectedMetric, testRunId]);

  const fetchChartData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/adapt/tracked-differences/${selectedMetric}?testRunId=${testRunId}`,
        { headers: { ...getAuthHeaders() } }
      );
      const data = await response.json();

      // Process data for Plotly
      const processedData = processChartData(data);
      setChartData(processedData);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processChartData = (data: any) => {
    // Separate data into different series
    const controlGroup = [];
    const selectedTestRun = [];
    const subsequentRuns = [];
    const thresholdUpper = [];
    const thresholdLower = [];

    data.forEach((point: any, index: number) => {
      if (point.controlGroup) {
        controlGroup.push({ x: index, y: point.value, ...point });
      } else if (point.selectedTestRun) {
        selectedTestRun.push({ x: index, y: point.value, ...point });
      } else {
        subsequentRuns.push({ x: index, y: point.value, ...point });
      }

      // Add threshold lines
      if (point.thresholds) {
        thresholdUpper.push({ x: index, y: point.thresholds.upper });
        thresholdLower.push({ x: index, y: point.thresholds.lower });
      }
    });

    return [
      {
        name: 'Control Group',
        x: controlGroup.map(p => p.x),
        y: controlGroup.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'square',
          size: 8,
          color: 'rgb(77, 89, 231)'
        },
        hovertemplate: '%{text}<extra></extra>',
        text: controlGroup.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${p.y}<br>` +
          `Date: ${formatDate(p.date)}`
        )
      },
      {
        name: 'Selected Test Run',
        x: selectedTestRun.map(p => p.x),
        y: selectedTestRun.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'cross',
          size: 10,
          color: 'rgb(255, 152, 0)'
        },
        hovertemplate: '%{text}<extra></extra>',
        text: selectedTestRun.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${p.y}<br>` +
          `Date: ${formatDate(p.date)}<br>` +
          `Status: Current Test Run`
        )
      },
      {
        name: 'Subsequent Runs',
        x: subsequentRuns.map(p => p.x),
        y: subsequentRuns.map(p => p.y),
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'triangle-up',
          size: 8,
          color: subsequentRuns.map(p =>
            p.regression ? 'rgb(222, 45, 38)' : 'rgb(77, 89, 231)'
          )
        },
        hovertemplate: '%{text}<extra></extra>',
        text: subsequentRuns.map(p =>
          `Test Run: ${p.testRunId}<br>` +
          `Value: ${p.y}<br>` +
          `Date: ${formatDate(p.date)}<br>` +
          `Status: ${p.regression ? 'Regression Detected' : 'Normal'}`
        )
      },
      {
        name: 'Upper Threshold',
        x: thresholdUpper.map(p => p.x),
        y: thresholdUpper.map(p => p.y),
        type: 'scatter',
        mode: 'lines',
        line: {
          color: 'rgba(20, 191, 191, 0.5)',
          dash: 'dash'
        },
        showlegend: true,
        hoverinfo: 'none'
      },
      {
        name: 'Lower Threshold',
        x: thresholdLower.map(p => p.x),
        y: thresholdLower.map(p => p.y),
        type: 'scatter',
        mode: 'lines',
        line: {
          color: 'rgba(10, 155, 10, 0.5)',
          dash: 'dash'
        },
        fill: 'tonexty',
        fillcolor: 'rgba(0, 255, 0, 0.1)',
        showlegend: true,
        hoverinfo: 'none'
      }
    ];
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Metric Selector */}
      <Box sx={{ mb: 2 }}>
        <Select
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value)}
          size="small"
          fullWidth
          sx={{ maxWidth: 400 }}
        >
          {trackedRegressions.map(reg => (
            <MenuItem key={reg.metricName} value={reg.metricName}>
              {reg.metricName} - {reg.dashboardLabel}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* Chart */}
      <Box sx={{
        backgroundColor: 'background.paper',
        borderRadius: 1,
        p: 2,
        border: '1px solid',
        borderColor: 'divider'
      }}>
        <Plot
          data={chartData}
          layout={{
            title: `Tracked Regression: ${selectedMetric}`,
            xaxis: {
              title: 'Test Run Sequence',
              showgrid: true
            },
            yaxis: {
              title: 'Metric Value',
              showgrid: true
            },
            height: 400,
            hovermode: 'closest',
            showlegend: true,
            legend: {
              orientation: 'h',
              y: -0.2
            }
          }}
          config={{
            displayModeBar: true,
            displaylogo: false
          }}
          style={{ width: '100%' }}
        />
      </Box>
    </Box>
  );
};
```

## Backend API Requirements

### 1. Get Tracked Regressions

```typescript
// GET /api/adapt/tracked-regressions
interface TrackedRegressionsRequest {
  testRunId: string;
  system: string;
  environment: string;
  workload: string;
}

interface TrackedRegressionsResponse {
  regressions: TrackedRegression[];
  unresolvedCount: number;
  totalTracked: number;
}
```

### 2. Get Tracked Regressions Count

```typescript
// GET /api/adapt/tracked-regressions/count
interface TrackedCountRequest {
  testRunId: string;
}

interface TrackedCountResponse {
  count: number;
}
```

### 3. Resolve Tracked Regression

```typescript
// POST /api/adapt/tracked-regressions/resolve
interface ResolveRegressionRequest {
  regressionId: string;
  resolution: 'accepted' | 'denied';
  excludeFromBaseline: boolean;
  comment?: string;
}

interface ResolveRegressionResponse {
  success: boolean;
  message: string;
}
```

### 4. Get Tracked Differences Data

```typescript
// GET /api/adapt/tracked-differences/:metricName
interface TrackedDifferencesRequest {
  metricName: string;
  testRunId: string;
  limit?: number;
}

interface TrackedDifferencesResponse {
  data: Array<{
    testRunId: string;
    date: string;
    value: number;
    controlGroup: boolean;
    selectedTestRun: boolean;
    regression: boolean;
    thresholds?: {
      upper: number;
      lower: number;
    };
  }>;
}
```

## Database Schema Requirements

### Tables Needed

```sql
-- Tracked regressions table
CREATE TABLE ds_adapt_tracked_results (
  id UUID PRIMARY KEY,
  test_run_id VARCHAR(255) NOT NULL,
  control_group_id VARCHAR(255) NOT NULL,
  application_dashboard_id UUID NOT NULL,
  panel_id VARCHAR(255) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  tracked_test_run_id VARCHAR(255),
  tracked_difference_id TEXT,
  tracked_conclusion JSONB,
  first_detected TIMESTAMP NOT NULL, -- Used for ordering (oldest first)
  test_runs_affected INTEGER DEFAULT 1,
  current_value NUMERIC,
  baseline_value NUMERIC,
  percentage_change NUMERIC,
  status VARCHAR(50) DEFAULT 'unresolved', -- unresolved, accepted, denied
  resolution_comment TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMP,
  queue_position INTEGER, -- Auto-calculated based on first_detected order
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_tracked_results_test_run ON ds_adapt_tracked_results(test_run_id);
CREATE INDEX idx_tracked_results_status ON ds_adapt_tracked_results(status);
CREATE INDEX idx_tracked_results_metric ON ds_adapt_tracked_results(metric_name);
CREATE INDEX idx_tracked_results_first_detected ON ds_adapt_tracked_results(first_detected); -- For ordering
CREATE INDEX idx_tracked_results_queue_position ON ds_adapt_tracked_results(queue_position); -- For queue management

-- Trigger to auto-calculate queue position based on first_detected order
CREATE OR REPLACE FUNCTION update_tracked_regression_queue_position()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate queue position based on first_detected timestamp for unresolved regressions
  WITH ranked_regressions AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY first_detected ASC) as position
    FROM ds_adapt_tracked_results
    WHERE status = 'unresolved'
  )
  UPDATE ds_adapt_tracked_results
  SET queue_position = ranked_regressions.position
  FROM ranked_regressions
  WHERE ds_adapt_tracked_results.id = ranked_regressions.id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update queue positions on insert/update/delete
CREATE TRIGGER update_tracked_regression_queue_position_trigger
  AFTER INSERT OR UPDATE OR DELETE ON ds_adapt_tracked_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_tracked_regression_queue_position();
```

## Visual Flow Diagram

```
User Journey:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Collapsed Card View
┌─────────────────────────────────────┐
│ 🔍 Anomaly Detection                │
│ ┌──────┐ ┌──────┐ ┌──────────┐    │
│ │ 5 ⚠️ │ │ 3 📊 │ │ 2 📈     │    │ ← User clicks
│ │Anomal│ │Class │ │Unresolved│    │    unresolved chip
│ └──────┘ └──────┘ └──────────┘    │
└─────────────────────────────────────┘

2. Card Expands & Shows Tracked Tab
┌─────────────────────────────────────┐
│ [Current Anomalies][→Unresolved Regressions (2)←] │
│ ┌─────────────────────────────┐    │
│ │ ⚠️ 2 Unresolved Regressions │    │
│ │                             │    │
│ │ ┌─────────────────────┐    │    │
│ │ │ Metric: Response Time│    │    │
│ │ │ +15.3% regression    │    │    │
│ │ │ [Regression] [Variability] │    │
│ │ └─────────────────────┘    │    │
│ │                             │    │
│ │ ┌─────────────────────┐    │    │
│ │ │ Metric: CPU Usage    │    │    │
│ │ │ +8.7% regression     │    │    │
│ │ │ [Regression] [Variability] │    │
│ │ └─────────────────────┘    │    │
│ │                             │    │
│ │ [📈 Trend Chart Below]      │    │
│ └─────────────────────────────┘    │
└─────────────────────────────────────┘

3. User Resolves Oldest Regression
   Click [Mark as Regression] → Marks as real regression
                               Excludes from baseline
                               Next regression becomes resolvable

   Click [Mark as Variability] → Marks as acceptable variability
                                Keeps in baseline
                                Next regression becomes resolvable

4. Queue Management
   ✅ Only oldest regression shows active buttons
   ⏳ Other regressions show disabled buttons with "Waiting in queue"
   📊 Queue position displayed as "#1 of 3", "#2 of 3", etc.
   🔄 Automatic queue reordering when regression resolved
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create database tables and indexes
- [ ] Implement backend API endpoints
- [ ] Set up data fetching services

### Phase 2: UI Components (Week 2)
- [ ] Add tracked chip to TLDR
- [ ] Create TrackedRegressionsTab component
- [ ] Implement TrackedRegressionCard component
- [ ] Add tab navigation logic

### Phase 3: Visualization (Week 3)
- [ ] Implement TrackedDifferencesChart with Plotly
- [ ] Add metric selection dropdown
- [ ] Create threshold visualization

### Phase 4: Resolution Flow & Queue Management (Week 4)
- [ ] Implement ordered resolution logic (oldest first)
- [ ] Add queue position indicators and "NEXT TO RESOLVE" chips
- [ ] Disable buttons for non-oldest regressions
- [ ] Create PostgreSQL trigger for auto-queue management
- [ ] Add confirmation dialogs for resolution actions
- [ ] Create success/error notifications
- [ ] Update control group logic based on resolution

### Phase 5: Testing & Polish (Week 5)
- [ ] Unit tests for components
- [ ] Integration tests for API
- [ ] Performance optimization
- [ ] Documentation updates

## Key Benefits

1. **Prevents Silent Degradation**: Regressions can't fade into baseline
2. **Clear Visibility**: Unresolved regressions shown prominently in TLDR
3. **Actionable Interface**: One-click resolution options
4. **Historical Context**: Trend charts show regression persistence
5. **Audit Trail**: Track who resolved what and when

## Configuration

Add to environment variables:
```env
# Feature flags
NEXT_PUBLIC_ENABLE_TRACKED_REGRESSIONS=true

# API endpoints
NEXT_PUBLIC_ADAPT_API_URL=http://localhost:3001/api/adapt
```

## Testing Considerations

1. **Unit Tests**:
   - Component rendering
   - State management
   - API integration

2. **Integration Tests**:
   - End-to-end resolution flow
   - Data persistence
   - Control group updates

3. **Performance Tests**:
   - Large number of tracked regressions
   - Chart rendering performance
   - API response times

## Monitoring

Track these metrics:
- Number of unresolved regressions
- Time to resolution
- Resolution patterns (accept vs deny)
- Performance impact of tracking

## Future Enhancements

1. **ML-based Suggestions**: AI to recommend accept/reject based on patterns
2. **Bulk Resolution**: Resolve multiple regressions at once
3. **Notification System**: Alert when new tracked regressions appear
4. **Export Reports**: Generate reports of tracked regression history
5. **Team Collaboration**: Comments and discussions on regressions

## Conclusion

This implementation ensures that performance regressions never silently become the new normal. By tracking regressions across test runs and requiring explicit resolution, the system maintains performance quality standards while preventing baseline degradation.