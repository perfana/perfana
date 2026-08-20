'use client';

import { MetricTrendData } from '../types';
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Tooltip,
  IconButton,
  Collapse,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ExpandLess,
  ExpandMore,
} from '@mui/icons-material';
import TrendChart from './TrendChart';

interface UnresolvedRegression {
  id: string;
  testRunId: string;
  trackedTestRunId: string;
  metricName: string;
  applicationDashboardId?: string;
  panelId?: string;
  dashboardLabel?: string;
  panelTitle?: string;
  unit?: string;
  testRunStart: Date;
  updatedAt: Date;
  conclusion?: unknown;
  trackedConclusion?: unknown;
  // Additional test run info
  version?: string;
  annotations?: string;
  systemUnderTest?: string;
  environment?: string;
  workload?: string;
  // Computed fields
  status?: string;
  percentageChange?: number;
  severity?: string;
}

interface UnresolvedRegressionTableProps {
  regressions: UnresolvedRegression[];
  trendsData?: Record<string, MetricTrendData[]>;
}

export default function UnresolvedRegressionTable({ regressions, trendsData }: UnresolvedRegressionTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const formatMetricName = (metricName: string) => {
    if (metricName.length > 30) {
      return `${metricName.substring(0, 27)}...`;
    }
    return metricName;
  };

  const toggleRowExpanded = (rowKey: string) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(rowKey)) {
      newExpandedRows.delete(rowKey);
    } else {
      newExpandedRows.add(rowKey);
    }
    setExpandedRows(newExpandedRows);
  };

  if (!regressions || regressions.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No unresolved regressions found.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* Scrollable Container */}
      <Box sx={(t) => ({
        overflow: 'auto',
        maxHeight: 500,
        border: '1px solid',
        borderColor: alpha(t.palette.primary.main, 0.12),
        borderRadius: 2,
        backgroundColor: 'background.paper',
        boxShadow: `0 2px 8px ${alpha(t.palette.text.primary, 0.1)}`,
        minWidth: '800px'
      })}>

        {/* Table Headers */}
        <Box sx={(t) => ({
          display: 'grid',
          gridTemplateColumns: '40px minmax(180px, 1fr) minmax(160px, 1fr)',
          gap: 1,
          px: 2,
          py: 1.5,
          backgroundColor: alpha(t.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(t.palette.primary.main, 0.12)}`,
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 1
        })}>
          <Box />
          <Typography variant="subtitle2" sx={{
            fontWeight: 700,
            color: 'primary.dark',
            fontSize: '0.85rem',
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}>Metric</Typography>
          <Typography variant="subtitle2" sx={{
            fontWeight: 700,
            color: 'primary.dark',
            fontSize: '0.85rem',
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}>Dashboard / Panel</Typography>
        </Box>

        {/* Table Rows */}
        {regressions.map((regression, index) => {
          const rowKey = `${regression.id}_${index}`;
          const isExpanded = expandedRows.has(rowKey);

          return (
            <React.Fragment key={rowKey}>
              <Box
                sx={(t) => ({
                  display: 'grid',
                  gridTemplateColumns: '40px minmax(180px, 1fr) minmax(160px, 1fr)',
                  gap: 1,
                  px: 2,
                  py: 1.5,
                  borderBottom: index === regressions.length - 1 && !isExpanded ? 'none' : `1px solid ${alpha(t.palette.primary.main, 0.08)}`,
                  backgroundColor: index % 2 === 0 ? 'transparent' : alpha(t.palette.primary.main, 0.02),
                  alignItems: 'center',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: alpha(t.palette.primary.main, 0.04),
                  }
                })}
                onClick={() => toggleRowExpanded(rowKey)}
              >
                <IconButton
                  size="small"
                  sx={{
                    color: 'primary.main',
                    '&:hover': { backgroundColor: 'primary.light' }
                  }}
                >
                  {isExpanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>

                <Tooltip title={regression.metricName || 'Unknown Metric'} arrow>
                  <Typography variant="body2" sx={{
                    fontSize: '0.875rem',
                    lineHeight: 1.4,
                    color: 'text.primary',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {formatMetricName(regression.metricName || 'Unknown Metric')}
                  </Typography>
                </Tooltip>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                    {regression.dashboardLabel || 'Unknown Dashboard'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    {regression.panelTitle || 'Unknown Panel'}
                  </Typography>
                </Box>
              </Box>

              {/* Expanded Row Content.
                  onEntered: the TrendChart inside mounts mid-animation (unmountOnExit
                  remounts it on every expand) and Plotly measures hover geometry
                  against the partial size — dispatch a window resize once the
                  Collapse settles so useResizeHandler relayouts at the final size
                  (same fix as AnomalyExpandedContent / TrendsCard, v0.2.61.35). */}
              <Collapse
                in={isExpanded}
                timeout="auto"
                unmountOnExit
                onEntered={() => window.dispatchEvent(new Event('resize'))}
              >
                <Box sx={(t) => ({
                  borderLeft: '1px solid',
                  borderRight: '1px solid',
                  borderBottom: index === regressions.length - 1 ? '1px solid' : 'none',
                  borderColor: alpha(t.palette.primary.main, 0.12),
                  borderRadius: index === regressions.length - 1 ? '0 0 8px 8px' : '0',
                  background: `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.04)} 0%, ${alpha(t.palette.primary.main, 0.02)} 100%)`,
                  p: 3,
                  minWidth: '800px'
                })}>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.dark' }}>
                      Trends Chart: {regression.metricName}
                    </Typography>
                  </Box>

                  {/* Trends Chart */}
                  {trendsData && trendsData[regression.metricName] ? (
                    <TrendChart
                      data={trendsData[regression.metricName]}
                      rowKey={rowKey}
                      metricName={regression.metricName}
                      unit={regression.unit}
                      height={350}
                      regressionDetectionTestRunId={regression.trackedTestRunId}
                    />
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No trends data available for this metric: {regression.metricName}
                      </Typography>
                      {trendsData && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Available metrics: {Object.keys(trendsData).join(', ') || 'none'}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Collapse>
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
}