'use client';

/**
 * CompareTab Component
 *
 * Displays baseline comparison results between two AWR reports,
 * including SQL regressions, wait event changes, and load profile differences.
 *
 * @example
 * ```tsx
 * <CompareTab
 *   reportId="report-uuid"
 *   testRunId="test-run-uuid"
 *   onSnackbar={(msg, sev) => showSnackbar(msg, sev)}
 * />
 * ```
 */

import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Tabs,
  Tab,
  Skeleton,
  Alert,
  AlertTitle,
  Chip,
  Divider,
  useTheme,
  alpha,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import {
  CompareArrows as CompareArrowsIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useAwrComparison, useComparisonStats } from '../hooks';
import type {
  CompareTabProps,
  ComparisonResponse,
  SqlComparisonItem,
  WaitEventComparisonItem,
  LoadProfileComparisonItem,
  AvailableBaseline,
  ChangeDirection,
} from '../types';
import {, SqlTextViewer } from '../sql';
import { InsightsList } from '../insights';
import {} from '../charts';
import {
  formatNumber,
  formatPercentage,
  formatDuration,
  formatDate,
  formatChangePercentage,
  getChangeDirectionColor,
  getChangeDirectionLabel,
} from '../utils';
import { CHANGE_DIRECTION_COLORS } from '../types';

// ==================== Constants ====================

type CompareSubTab = 'summary' | 'sql' | 'wait-events' | 'load-profile' | 'insights';

const COMPARE_TABS: { value: CompareSubTab; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'sql', label: 'SQL Changes' },
  { value: 'wait-events', label: 'Wait Events' },
  { value: 'load-profile', label: 'Load Profile' },
  { value: 'insights', label: 'Insights' },
];

// ==================== Helper Components ====================

interface StatusIndicatorProps {
  status: 'improved' | 'regressed' | 'stable' | 'unknown';
  size?: 'small' | 'medium' | 'large';
}

function StatusIndicator({ status, size = 'medium' }: StatusIndicatorProps) {
  const iconSize = size === 'small' ? 20 : size === 'large' ? 40 : 28;

  switch (status) {
    case 'improved':
      return <TrendingUpIcon sx={{ fontSize: iconSize, color: '#4caf50' }} />;
    case 'regressed':
      return <TrendingDownIcon sx={{ fontSize: iconSize, color: '#f44336' }} />;
    case 'stable':
      return <TrendingFlatIcon sx={{ fontSize: iconSize, color: '#9e9e9e' }} />;
    default:
      return <CompareArrowsIcon sx={{ fontSize: iconSize, color: '#9e9e9e' }} />;
  }
}

interface ChangeIndicatorProps {
  direction: ChangeDirection;
  value?: number;
  showLabel?: boolean;
}

function ChangeIndicator({ direction, value, showLabel = true }: ChangeIndicatorProps) {
  const color = CHANGE_DIRECTION_COLORS[direction];
  const label = getChangeDirectionLabel(direction);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      {showLabel && (
        <Typography variant="body2" sx={{ color, fontWeight: 500 }}>
          {label}
          {value !== undefined && ` (${formatChangePercentage(value)})`}
        </Typography>
      )}
    </Box>
  );
}

// ==================== Sub-Components ====================

function LoadingState() {
  return (
    <Box sx={{ p: 2 }}>
      <Skeleton variant="rectangular" height={80} sx={{ mb: 2, borderRadius: 1 }} />
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
    </Box>
  );
}

function NoBaselineState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        px: 3,
        backgroundColor: alpha(theme.palette.info.main, 0.04),
        borderRadius: 2,
      }}
    >
      <CompareArrowsIcon sx={{ fontSize: 48, color: theme.palette.info.main, mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        Select a Baseline
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center">
        Choose a baseline AWR report from another test run to compare against.
        This will show performance regressions and improvements.
      </Typography>
    </Box>
  );
}

interface BaselineSelectorProps {
  baselines: AvailableBaseline[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading?: boolean;
  error?: string | null;
}

function BaselineSelector({
  baselines,
  selectedId,
  onSelect,
  loading,
  error,
}: BaselineSelectorProps) {
  const _theme = useTheme();

  if (loading) {
    return <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 1 }} />;
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (baselines.length === 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        No baseline reports available for comparison. Upload AWR reports to other
        test runs to enable comparison.
      </Alert>
    );
  }

  const selectedBaseline = baselines.find((b) => b.awrReportId === selectedId);

  return (
    <FormControl fullWidth>
      <Select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        displayEmpty
        renderValue={(value) => {
          if (!value || !selectedBaseline) {
            return (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                Select baseline test run
              </Typography>
            );
          }
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5, width: '100%', overflow: 'visible' }}>
              <Typography
                variant="body2"
                sx={{
                  lineHeight: 1.3,
                  overflow: 'visible',
                  textOverflow: 'clip',
                  whiteSpace: 'normal',
                }}
              >
                {selectedBaseline.testRunName ?? selectedBaseline.testRunId}
                {selectedBaseline.dbName && ` - ${selectedBaseline.dbName}`}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  lineHeight: 1.2,
                  overflow: 'visible',
                  textOverflow: 'clip',
                  whiteSpace: 'normal',
                }}
              >
                {selectedBaseline.beginTime && formatDate(selectedBaseline.beginTime)}
              </Typography>
            </Box>
          );
        }}
        sx={{
          minHeight: 70,
          width: '100%',
          '& .MuiSelect-select': {
            display: 'flex',
            alignItems: 'center',
            minHeight: 70,
            height: 'auto',
            py: 1.5,
            whiteSpace: 'normal',
            overflow: 'visible',
            textOverflow: 'clip',
          },
          '& .MuiOutlinedInput-notchedOutline': {
            overflow: 'visible',
          },
        }}
      >
        <MenuItem value="">
          <em>Select baseline test run</em>
        </MenuItem>
        {baselines.map((baseline) => (
          <MenuItem key={baseline.awrReportId} value={baseline.awrReportId}>
            <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5 }}>
              <Typography variant="body2">
                {baseline.testRunName ?? baseline.testRunId}
                {baseline.dbName && ` - ${baseline.dbName}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {baseline.beginTime && formatDate(baseline.beginTime)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

interface SummaryCardProps {
  title: string;
  value: number;
  label: string;
  color: string;
  icon: React.ReactNode;
}

function SummaryCard({ title, value, _label, color, icon }: SummaryCardProps) {
  const theme = useTheme();

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 2,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Box sx={{ color, mt: 0.5 }}>{icon}</Box>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ color }}>
            {value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

interface SqlChangesViewProps {
  regressions: SqlComparisonItem[];
  improvements: SqlComparisonItem[];
  newStatements: SqlComparisonItem[];
  onSqlClick?: (sqlId: string, sqlText?: string) => void;
  onSnackbar?: (message: string, severity: 'success' | 'error' | 'info') => void;
}

function SqlChangesView({
  regressions,
  improvements,
  newStatements,
  onSqlClick,
  onSnackbar,
}: SqlChangesViewProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (regressions.length === 0 && improvements.length === 0 && newStatements.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 6,
          backgroundColor: alpha(theme.palette.success.main, 0.04),
          borderRadius: 2,
        }}
      >
        <CheckCircleIcon sx={{ mr: 1, color: theme.palette.success.main }} />
        <Typography variant="body1" color="text.secondary">
          No significant SQL changes detected
        </Typography>
      </Box>
    );
  }

  const renderSection = (
    title: string,
    items: SqlComparisonItem[],
    color: string
  ) => {
    if (items.length === 0) return null;

    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, color }}>
          {title} ({items.length})
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {items.slice(0, 10).map((item) => (
            <Paper
              key={item.sqlId}
              elevation={0}
              sx={{
                p: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                borderLeft: `3px solid ${color}`,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography
                  variant="body2"
                  fontFamily="monospace"
                  fontWeight={600}
                  onClick={() => onSqlClick?.(item.sqlId, item.fullSqlText || item.sqlText)}
                  sx={{
                    cursor: onSqlClick ? 'pointer' : 'default',
                    color: onSqlClick ? 'primary.main' : 'inherit',
                    '&:hover': onSqlClick ? {
                      textDecoration: 'underline',
                    } : {},
                  }}
                >
                  {item.sqlId}
                </Typography>
                <ChangeIndicator
                  direction={item.changeDirection}
                  value={item.deltaPercent.elapsedTime}
                />
              </Box>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">Elapsed Time</Typography>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                    {formatDuration(item.current.elapsedTime ?? 0)}
                  </Typography>
                  {item.deltaPercent.elapsedTime !== undefined && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: item.deltaPercent.elapsedTime > 0 ? '#f44336' : '#4caf50',
                        fontWeight: 600,
                      }}
                    >
                      {formatChangePercentage(item.deltaPercent.elapsedTime)}
                    </Typography>
                  )}
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">CPU Time</Typography>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                    {formatDuration(item.current.cpuTime ?? 0)}
                  </Typography>
                  {item.deltaPercent.cpuTime !== undefined && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: item.deltaPercent.cpuTime > 0 ? '#f44336' : '#4caf50',
                        fontWeight: 600,
                      }}
                    >
                      {formatChangePercentage(item.deltaPercent.cpuTime)}
                    </Typography>
                  )}
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">Buffer Gets</Typography>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                    {formatNumber(item.current.bufferGets ?? 0, 0)}
                  </Typography>
                  {item.deltaPercent.bufferGets !== undefined && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: item.deltaPercent.bufferGets > 0 ? '#f44336' : '#4caf50',
                        fontWeight: 600,
                      }}
                    >
                      {formatChangePercentage(item.deltaPercent.bufferGets)}
                    </Typography>
                  )}
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">Executions</Typography>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                    {formatNumber(item.current.executions ?? 0, 0)}
                  </Typography>
                  {item.deltaPercent.executions !== undefined && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: item.deltaPercent.executions > 0 ? '#9e9e9e' : '#9e9e9e',
                        fontWeight: 500,
                      }}
                    >
                      {formatChangePercentage(item.deltaPercent.executions)}
                    </Typography>
                  )}
                </Grid>
              </Grid>
            </Paper>
          ))}
        </Box>
        {items.length > 10 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
            ... and {items.length - 10} more
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Box>
      {renderSection('Regressions', regressions, '#f44336')}
      {renderSection('Improvements', improvements, '#4caf50')}
      {renderSection('New Statements', newStatements, '#2196f3')}
    </Box>
  );
}

interface WaitEventChangesViewProps {
  increases: WaitEventComparisonItem[];
  decreases: WaitEventComparisonItem[];
}

function WaitEventChangesView({ increases, decreases }: WaitEventChangesViewProps) {
  const theme = useTheme();

  if (increases.length === 0 && decreases.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 6,
          backgroundColor: alpha(theme.palette.success.main, 0.04),
          borderRadius: 2,
        }}
      >
        <CheckCircleIcon sx={{ mr: 1, color: theme.palette.success.main }} />
        <Typography variant="body1" color="text.secondary">
          No significant wait event changes detected
        </Typography>
      </Box>
    );
  }

  const renderSection = (
    title: string,
    items: WaitEventComparisonItem[],
    color: string
  ) => {
    if (items.length === 0) return null;

    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5, color }}>
          {title} ({items.length})
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {items.slice(0, 15).map((item) => (
            <Paper
              key={item.event}
              elevation={0}
              sx={{
                p: 1.5,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                borderLeft: `3px solid ${color}`,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {item.event}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.waitClass}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body2" fontFamily="monospace">
                    {formatDuration(item.current.totalWaitTime ?? 0)}
                  </Typography>
                  {item.deltaPercent.totalWaitTime !== undefined && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: item.deltaPercent.totalWaitTime > 0 ? '#f44336' : '#4caf50',
                      }}
                    >
                      {formatChangePercentage(item.deltaPercent.totalWaitTime)}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Paper>
          ))}
        </Box>
      </Box>
    );
  };

  return (
    <Box>
      {renderSection('Increased Wait Times', increases, '#f44336')}
      {renderSection('Decreased Wait Times', decreases, '#4caf50')}
    </Box>
  );
}

interface LoadProfileComparisonViewProps {
  metrics: LoadProfileComparisonItem[];
}

function LoadProfileComparisonView({ metrics }: LoadProfileComparisonViewProps) {
  const theme = useTheme();

  if (metrics.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 6,
          backgroundColor: alpha(theme.palette.grey[500], 0.04),
          borderRadius: 2,
        }}
      >
        <InfoIcon sx={{ mr: 1, color: theme.palette.grey[500] }} />
        <Typography variant="body1" color="text.secondary">
          No load profile data available for comparison
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Grid container spacing={2}>
        {metrics.map((metric) => {
          const isIncrease = metric.deltaPercent > 0;
          const isSignificant = Math.abs(metric.deltaPercent) > 20;
          const color = isSignificant
            ? isIncrease
              ? '#f44336'
              : '#4caf50'
            : theme.palette.text.secondary;

          return (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={metric.name}>
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {metric.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography variant="h6" fontFamily="monospace">
                    {formatNumber(metric.currentValue, 2)}
                  </Typography>
                  {metric.unit && (
                    <Typography variant="caption" color="text.secondary">
                      {metric.unit}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Baseline: {formatNumber(metric.baselineValue, 2)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color, fontWeight: isSignificant ? 600 : 400 }}
                  >
                    ({formatChangePercentage(metric.deltaPercent)})
                  </Typography>
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

// ==================== Main Component ====================

/**
 * CompareTab - Displays baseline comparison results
 * with SQL changes, wait event changes, and load profile differences.
 */
export function CompareTab({
  reportId,
  testRunId,
  baselineReportId: initialBaselineId,
  baselineTestRunId,
  onComparisonComplete,
  onSnackbar,
}: CompareTabProps) {
  const theme = useTheme();

  // State
  const [activeSubTab, setActiveSubTab] = useState<CompareSubTab>('summary');
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [selectedSql, setSelectedSql] = useState<{ sqlId: string; sqlText?: string } | null>(null);

  // Use comparison hook
  const {
    baselines,
    isLoadingBaselines,
    baselinesError,
    selectedBaselineId,
    setSelectedBaselineId,
    comparison,
    isComparing,
    comparisonError,
    compare,
    sqlRegressions,
    sqlImprovements,
    newSqlStatements,
    waitEventIncreases,
    waitEventDecreases,
    loadProfileComparisons,
    overallStatus,
    hasComparison,
    regressionCount,
    improvementCount,
  } = useAwrComparison(reportId, testRunId, {
    initialBaselineId,
    onCompareSuccess: (response) => {
      if (onComparisonComplete && response.severitySummary) {
        onComparisonComplete({
          sqlRegressions: response.sqlComparison?.summary?.regressionCount ?? 0,
          sqlImprovements: response.sqlComparison?.summary?.improvementCount ?? 0,
          newSqlStatements: response.sqlComparison?.summary?.newCount ?? 0,
          waitEventIncreases: response.waitEventComparison?.increases?.length ?? 0,
          waitEventDecreases: response.waitEventComparison?.decreases?.length ?? 0,
          dbTimeChangePercent: response.loadProfileComparison?.highlights?.dbTimeChange,
          transactionRateChangePercent: response.loadProfileComparison?.highlights?.transactionRateChange,
          overallStatus,
        });
      }
    },
    onSnackbar,
  });

  // Get comparison stats
  const stats = useComparisonStats(comparison);

  // Handlers
  const handleSubTabChange = useCallback((_: React.SyntheticEvent, newValue: CompareSubTab) => {
    setActiveSubTab(newValue);
  }, []);

  const handleCompare = useCallback(() => {
    compare();
  }, [compare]);

  const handleSqlClick = useCallback((sqlId: string, sqlText?: string) => {
    setSelectedSql({ sqlId, sqlText });
    setSqlModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setSqlModalOpen(false);
    setSelectedSql(null);
  }, []);

  return (
    <Box sx={{ p: 2 }}>
      {/* Baseline Selector */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        }}
      >
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 9 }}>
            <BaselineSelector
              baselines={baselines}
              selectedId={selectedBaselineId}
              onSelect={setSelectedBaselineId}
              loading={isLoadingBaselines}
              error={baselinesError}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Button
              variant="contained"
              fullWidth
              onClick={handleCompare}
              disabled={!selectedBaselineId || isComparing}
              startIcon={<CompareArrowsIcon />}
            >
              {isComparing ? 'Comparing...' : 'Compare'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Comparison Error */}
      {comparisonError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <AlertTitle>Comparison Failed</AlertTitle>
          {comparisonError}
        </Alert>
      )}

      {/* No Baseline Selected */}
      {!selectedBaselineId && !hasComparison && <NoBaselineState />}

      {/* Loading State */}
      {isComparing && <LoadingState />}

      {/* Comparison Results */}
      {hasComparison && !isComparing && (
        <>
          {/* Overall Status Banner */}
          <Paper
            elevation={0}
            sx={{
              p: 2,
              mb: 3,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              backgroundColor:
                overallStatus === 'regressed'
                  ? alpha('#f44336', 0.04)
                  : overallStatus === 'improved'
                    ? alpha('#4caf50', 0.04)
                    : alpha('#9e9e9e', 0.04),
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <StatusIndicator status={overallStatus} size="large" />
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" fontWeight={600}>
                  {overallStatus === 'regressed'
                    ? 'Performance Regressed'
                    : overallStatus === 'improved'
                      ? 'Performance Improved'
                      : 'Performance Stable'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {sqlRegressions.length > 0 && `${sqlRegressions.length} SQL regression${sqlRegressions.length !== 1 ? 's' : ''}`}
                  {sqlRegressions.length > 0 && sqlImprovements.length > 0 && ', '}
                  {sqlImprovements.length > 0 && `${sqlImprovements.length} SQL improvement${sqlImprovements.length !== 1 ? 's' : ''}`}
                  {(sqlRegressions.length > 0 || sqlImprovements.length > 0) && waitEventDecreases.length > 0 && ', '}
                  {waitEventDecreases.length > 0 && `${waitEventDecreases.length} wait decrease${waitEventDecreases.length !== 1 ? 's' : ''}`}
                  {(sqlRegressions.length > 0 || sqlImprovements.length > 0 || waitEventDecreases.length > 0) && waitEventIncreases.length > 0 && ', '}
                  {waitEventIncreases.length > 0 && `${waitEventIncreases.length} wait increase${waitEventIncreases.length !== 1 ? 's' : ''}`}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <SummaryCard
                title="SQL Regressions"
                value={sqlRegressions.length}
                label="regressions"
                color="#f44336"
                icon={<TrendingDownIcon />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <SummaryCard
                title="SQL Improvements"
                value={sqlImprovements.length}
                label="improvements"
                color="#4caf50"
                icon={<TrendingUpIcon />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <SummaryCard
                title="Wait Increases"
                value={waitEventIncreases.length}
                label="increased"
                color="#ff9800"
                icon={<WarningIcon />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <SummaryCard
                title="New SQL"
                value={newSqlStatements.length}
                label="new statements"
                color="#2196f3"
                icon={<InfoIcon />}
              />
            </Grid>
          </Grid>

          {/* Sub-tabs */}
          <Paper
            elevation={0}
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <Tabs
              value={activeSubTab}
              onChange={handleSubTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                borderBottom: `1px solid ${theme.palette.divider}`,
                '& .MuiTab-root': {
                  textTransform: 'none',
                },
              }}
            >
              {COMPARE_TABS.map((tab) => (
                <Tab key={tab.value} value={tab.value} label={tab.label} />
              ))}
            </Tabs>

            <Box sx={{ p: 2 }}>
              {activeSubTab === 'summary' && (
                <Box>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Comparison Summary
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    This comparison analyzes changes between the current AWR report and the selected baseline.
                    Below are the key findings across SQL performance, wait events, and system load.
                  </Typography>

                  {/* Quick stats */}
                  <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          backgroundColor: alpha(theme.palette.primary.main, 0.04),
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="subtitle2" color="primary" gutterBottom>
                          SQL Analysis
                        </Typography>
                        <Typography variant="body2">
                          {stats.totalSqlChanges} total SQL changes detected
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          backgroundColor: alpha(theme.palette.warning.main, 0.04),
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="subtitle2" color="warning.main" gutterBottom>
                          Wait Events
                        </Typography>
                        <Typography variant="body2">
                          {stats.totalWaitEventChanges} wait event changes
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          backgroundColor: alpha(theme.palette.info.main, 0.04),
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="subtitle2" color="info.main" gutterBottom>
                          Load Profile
                        </Typography>
                        <Typography variant="body2">
                          {stats.totalLoadProfileChanges} metrics compared
                        </Typography>
                      </Paper>
                    </Grid>
                  </Grid>
                </Box>
              )}

              {activeSubTab === 'sql' && (
                <SqlChangesView
                  regressions={sqlRegressions}
                  improvements={sqlImprovements}
                  newStatements={newSqlStatements}
                  onSqlClick={handleSqlClick}
                  onSnackbar={onSnackbar}
                />
              )}

              {activeSubTab === 'wait-events' && (
                <WaitEventChangesView
                  increases={waitEventIncreases}
                  decreases={waitEventDecreases}
                />
              )}

              {activeSubTab === 'load-profile' && (
                <LoadProfileComparisonView metrics={loadProfileComparisons} />
              )}

              {activeSubTab === 'insights' && comparison?.insights && (
                <InsightsList
                  insights={comparison.insights}
                  groupBySeverity
                  onSqlClick={handleSqlClick}
                  emptyMessage="No comparison insights generated"
                />
              )}
            </Box>
          </Paper>
        </>
      )}

      {/* SQL Text Modal */}
      <Dialog
        open={sqlModalOpen}
        onClose={handleModalClose}
        maxWidth="lg"
        fullWidth
        aria-labelledby="sql-text-dialog-title"
      >
        <DialogTitle
          id="sql-text-dialog-title"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" component="span">
              SQL Statement
            </Typography>
            {selectedSql && (
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  color: 'primary.main',
                  fontWeight: 600,
                }}
              >
                {selectedSql.sqlId}
              </Typography>
            )}
          </Box>
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleModalClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedSql?.sqlText ? (
            <SqlTextViewer
              sqlText={selectedSql.sqlText}
              sqlId={selectedSql.sqlId}
              maxHeight={600}
              showCopyButton
              showExpandButton
              onSnackbar={onSnackbar}
            />
          ) : (
            <Typography color="text.secondary">
              SQL text not available for this statement
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleModalClose}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default CompareTab;
