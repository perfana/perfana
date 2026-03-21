'use client';

/**
 * OverviewTab Component
 *
 * Displays the AWR report overview including database info, host info,
 * snapshot info, load profile chart, and time model breakdown.
 *
 * @example
 * ```tsx
 * <OverviewTab
 *   reportId="report-uuid"
 *   testRunId="test-run-uuid"
 *   onSnackbar={(msg, sev) => showSnackbar(msg, sev)}
 * />
 * ```
 */

import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Divider,
  Skeleton,
  Chip,
  useTheme,
  alpha,
  Tooltip,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Computer as ComputerIcon,
  Schedule as ScheduleIcon,
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { getAwrReport } from '@/lib/api/awr-reports';
import type { OverviewTabProps, LoadProfileChartData, TimeModelChartData } from '../types';
import { LoadProfileChart } from '../charts';
import { TimeModelChart } from '../charts';
import {
  formatNumber,
  formatDbTime,
  formatDate,
  formatOracleVersion,
  formatHostCpuInfo,
  formatMemoryGb,
  formatSnapshotIdRange,
} from '../utils';

// ==================== Constants ====================

const SECTION_SPACING = 3;

// ==================== Helper Functions ====================

/**
 * Transform load profile data to chart format
 */
function transformLoadProfileData(report: {
  parsedData?: {
    loadProfile?: {
      dbTimePerSecond?: number;
      dbCpuPerSecond?: number;
      transactionsPerSecond?: number;
      logicalReadsPerSecond?: number;
      physicalReadsPerSecond?: number;
      physicalWritesPerSecond?: number;
      metrics?: Array<{
        name: string;
        perSecond?: number;
        [key: string]: unknown;
      }>;
      perSecond?: Record<string, number>;
    };
  };
}): LoadProfileChartData | null {
  const loadProfile = report.parsedData?.loadProfile;
  if (!loadProfile) return null;

  // Build metrics array from the metrics field if available
  let metrics = loadProfile.metrics
    ?.filter((m) => typeof m.perSecond === 'number' && m.perSecond > 0)
    .map((m) => ({
      name: m.name,
      value: m.perSecond!,
    }))
    .slice(0, 10) ?? [];

  // If metrics array is empty, build it from top-level properties
  if (metrics.length === 0) {
    const metricsFromProps: Array<{ name: string; value: number }> = [];

    if (loadProfile.dbTimePerSecond !== undefined && loadProfile.dbTimePerSecond > 0) {
      metricsFromProps.push({ name: 'DB Time', value: loadProfile.dbTimePerSecond });
    }
    if (loadProfile.dbCpuPerSecond !== undefined && loadProfile.dbCpuPerSecond > 0) {
      metricsFromProps.push({ name: 'DB CPU', value: loadProfile.dbCpuPerSecond });
    }
    if (loadProfile.logicalReadsPerSecond !== undefined && loadProfile.logicalReadsPerSecond > 0) {
      metricsFromProps.push({ name: 'Logical Reads', value: loadProfile.logicalReadsPerSecond });
    }
    if (loadProfile.physicalReadsPerSecond !== undefined && loadProfile.physicalReadsPerSecond > 0) {
      metricsFromProps.push({ name: 'Physical Reads', value: loadProfile.physicalReadsPerSecond });
    }
    if (loadProfile.physicalWritesPerSecond !== undefined && loadProfile.physicalWritesPerSecond > 0) {
      metricsFromProps.push({ name: 'Physical Writes', value: loadProfile.physicalWritesPerSecond });
    }
    if (loadProfile.transactionsPerSecond !== undefined && loadProfile.transactionsPerSecond > 0) {
      metricsFromProps.push({ name: 'Transactions', value: loadProfile.transactionsPerSecond });
    }

    metrics = metricsFromProps;
  }

  return {
    metrics,
    dbTimePerSecond: loadProfile.dbTimePerSecond,
    dbCpuPerSecond: loadProfile.dbCpuPerSecond,
    transactionsPerSecond: loadProfile.transactionsPerSecond,
    logicalReadsPerSecond: loadProfile.logicalReadsPerSecond,
    physicalReadsPerSecond: loadProfile.physicalReadsPerSecond,
    physicalWritesPerSecond: loadProfile.physicalWritesPerSecond,
  };
}

/**
 * Transform time model data to chart format
 */
function transformTimeModelData(report: {
  snapshot?: {
    dbTimeMinutes?: number;
  };
  parsedData?: {
    timeModel?: Record<string, number>;
  };
}): TimeModelChartData | null {
  const timeModel = report.parsedData?.timeModel;
  const dbTimeMinutes = report.snapshot?.dbTimeMinutes;

  if (!timeModel || dbTimeMinutes === undefined) return null;

  // Common time model components
  const segments = [
    { name: 'DB CPU', value: timeModel['DB CPU'] ?? 0 },
    { name: 'SQL Execute', value: timeModel['sql execute elapsed time'] ?? 0 },
    { name: 'Parse Time', value: timeModel['parse time elapsed'] ?? 0 },
    { name: 'PL/SQL', value: timeModel['PL/SQL execution elapsed time'] ?? 0 },
    { name: 'Sequence Load', value: timeModel['sequence load elapsed time'] ?? 0 },
    { name: 'Other', value: Math.max(0, (dbTimeMinutes * 60) - Object.values(timeModel).reduce((a, b) => a + (b || 0), 0)) },
  ].filter(s => s.value > 0);

  return {
    dbTime: dbTimeMinutes * 60, // Convert to seconds
    dbCpu: timeModel['DB CPU'],
    sqlExecute: timeModel['sql execute elapsed time'],
    parseTime: timeModel['parse time elapsed'],
    plsqlTime: timeModel['PL/SQL execution elapsed time'],
    segments,
  };
}

// ==================== Sub-Components ====================

interface InfoItemProps {
  label: string;
  value: string | number | null | undefined;
  tooltip?: string;
}

function InfoItem({ label, value, tooltip }: InfoItemProps) {
  const theme = useTheme();

  const content = (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 0.75,
        px: 1,
        '&:hover': {
          backgroundColor: alpha(theme.palette.primary.main, 0.04),
          borderRadius: 1,
        },
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontWeight: 500 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: 'monospace',
          fontWeight: 600,
          color: theme.palette.text.primary,
        }}
      >
        {value ?? 'N/A'}
      </Typography>
    </Box>
  );

  if (tooltip) {
    return (
      <Tooltip title={tooltip} placement="left">
        {content}
      </Tooltip>
    );
  }

  return content;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
}

function SectionHeader({ icon, title }: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 1,
          backgroundColor: alpha(theme.palette.primary.main, 0.1),
          color: theme.palette.primary.main,
        }}
      >
        {icon}
      </Box>
      <Typography variant="subtitle1" fontWeight={600}>
        {title}
      </Typography>
    </Box>
  );
}

function LoadingState() {
  return (
    <Box sx={{ p: 3 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
        </Grid>
        <Grid item xs={12}>
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
        </Grid>
      </Grid>
    </Box>
  );
}

interface ErrorStateProps {
  message: string;
}

function ErrorState({ message }: ErrorStateProps) {
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
        backgroundColor: alpha(theme.palette.error.main, 0.04),
        borderRadius: 2,
      }}
    >
      <InfoIcon sx={{ fontSize: 48, color: theme.palette.error.main, mb: 2 }} />
      <Typography variant="h6" color="error" gutterBottom>
        Failed to load report data
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

function EmptyState() {
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
      <InfoIcon sx={{ fontSize: 48, color: theme.palette.info.main, mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No report data available
      </Typography>
      <Typography variant="body2" color="text.secondary">
        The AWR report is still being parsed or has no data yet.
      </Typography>
    </Box>
  );
}

// ==================== Main Component ====================

/**
 * OverviewTab - Displays AWR report overview with database info,
 * host info, snapshot details, load profile, and time model charts.
 */
export function OverviewTab({
  reportId,
  testRunId,
  report: providedReport,
  onSnackbar,
}: OverviewTabProps) {
  const theme = useTheme();

  // Fetch report data if not provided
  const { data: fetchedReport, isLoading, error } = useQuery({
    queryKey: ['awr-report', reportId],
    queryFn: () => getAwrReport(reportId),
    enabled: !providedReport && !!reportId,
    staleTime: 60000,
  });

  const report = providedReport ?? fetchedReport;

  // Transform data for charts
  const loadProfileData = useMemo(
    () => (report ? transformLoadProfileData(report as Parameters<typeof transformLoadProfileData>[0]) : null),
    [report]
  );

  const timeModelData = useMemo(
    () => (report ? transformTimeModelData(report as Parameters<typeof transformTimeModelData>[0]) : null),
    [report]
  );

  // Loading state
  if (isLoading) {
    return <LoadingState />;
  }

  // Error state
  if (error) {
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as Error).message
      : 'An unexpected error occurred';
    return <ErrorState message={errorMessage} />;
  }

  // Empty state
  if (!report) {
    return <EmptyState />;
  }

  const { database, host, snapshot } = report;

  return (
    <Box sx={{ p: 2 }}>
      {/* Info Cards Grid - Only show if data available */}
      {(database || host || snapshot) && (
        <Grid container spacing={SECTION_SPACING}>
          {/* Database Info */}
          {database && (
            <Grid item xs={12} md={4}>
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  height: '100%',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 2,
                }}
              >
                <SectionHeader icon={<StorageIcon fontSize="small" />} title="Database" />
                <Divider sx={{ mb: 1.5 }} />
                <InfoItem label="Name" value={database?.dbName} />
                <InfoItem label="ID" value={database?.dbId} />
                <InfoItem label="Instance" value={database?.instanceName} />
                <InfoItem
                  label="Version"
                  value={formatOracleVersion(database?.dbRelease)}
                  tooltip={database?.dbRelease}
                />
                <InfoItem label="Edition" value={database?.dbEdition} />
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                  {database?.isRac && (
                    <Chip label="RAC" size="small" color="info" variant="outlined" />
                  )}
                  {database?.isCdb && (
                    <Chip label="CDB" size="small" color="info" variant="outlined" />
                  )}
                </Box>
              </Paper>
            </Grid>
          )}

          {/* Host Info */}
          {host && (
            <Grid item xs={12} md={4}>
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  height: '100%',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 2,
                }}
              >
                <SectionHeader icon={<ComputerIcon fontSize="small" />} title="Host" />
                <Divider sx={{ mb: 1.5 }} />
                <InfoItem label="Hostname" value={host?.hostName} />
                <InfoItem label="Platform" value={host?.platform} />
                <InfoItem
                  label="CPUs"
                  value={formatHostCpuInfo(host?.cpus, host?.cores, host?.sockets)}
                  tooltip={`${host?.cpus ?? 0} CPUs, ${host?.cores ?? 0} cores, ${host?.sockets ?? 0} sockets`}
                />
                <InfoItem
                  label="Memory"
                  value={formatMemoryGb(host?.memoryGb)}
                />
              </Paper>
            </Grid>
          )}

          {/* Snapshot Info */}
          {snapshot && (
            <Grid item xs={12} md={4}>
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  height: '100%',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 2,
                }}
              >
                <SectionHeader icon={<ScheduleIcon fontSize="small" />} title="Snapshot" />
                <Divider sx={{ mb: 1.5 }} />
                <InfoItem
                  label="Snap Range"
                  value={formatSnapshotIdRange(snapshot?.snapIdBegin, snapshot?.snapIdEnd)}
                />
                <InfoItem
                  label="Begin"
                  value={formatDate(snapshot?.beginTime)}
                />
                <InfoItem
                  label="End"
                  value={formatDate(snapshot?.endTime)}
                />
                <InfoItem
                  label="Elapsed"
                  value={snapshot?.elapsedMinutes ? `${formatNumber(snapshot.elapsedMinutes)} min` : undefined}
                />
                <InfoItem
                  label="DB Time"
                  value={formatDbTime(snapshot?.dbTimeMinutes)}
                />
              </Paper>
            </Grid>
          )}
        </Grid>
      )}

      {/* Charts Section */}
      <Box sx={{ mt: SECTION_SPACING }}>
        <Grid container spacing={SECTION_SPACING}>
          {/* Load Profile Chart */}
          <Grid item xs={12} lg={7}>
            <Paper
              elevation={0}
              sx={{
                p: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
              }}
            >
              <SectionHeader icon={<SpeedIcon fontSize="small" />} title="Load Profile" />
              {loadProfileData ? (
                <LoadProfileChart
                  data={loadProfileData}
                  height={280}
                  showLegend={false}
                  chartType="bar"
                />
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 280,
                    backgroundColor: alpha(theme.palette.grey[500], 0.04),
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No load profile data available
                  </Typography>
                </Box>
              )}
            </Paper>
          </Grid>

          {/* Time Model Chart */}
          <Grid item xs={12} lg={5}>
            <Paper
              elevation={0}
              sx={{
                p: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
              }}
            >
              <SectionHeader icon={<MemoryIcon fontSize="small" />} title="Time Model" />
              {timeModelData ? (
                <TimeModelChart
                  data={timeModelData}
                  height={280}
                  chartType="donut"
                  showBreakdown={false}
                />
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 280,
                    backgroundColor: alpha(theme.palette.grey[500], 0.04),
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No time model data available
                  </Typography>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Box>

      {/* Key Metrics Summary */}
      {(loadProfileData?.dbTimePerSecond || loadProfileData?.transactionsPerSecond) && (
        <Box sx={{ mt: SECTION_SPACING }}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              backgroundColor: alpha(theme.palette.primary.main, 0.02),
            }}
          >
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Key Performance Metrics (per second)
            </Typography>
            <Grid container spacing={2}>
              {loadProfileData?.dbTimePerSecond !== undefined && (
                <Grid item xs={6} sm={3}>
                  <Typography variant="h5" fontWeight={600} color="primary">
                    {formatNumber(loadProfileData.dbTimePerSecond, 2)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    DB Time (s)
                  </Typography>
                </Grid>
              )}
              {loadProfileData?.dbCpuPerSecond !== undefined && (
                <Grid item xs={6} sm={3}>
                  <Typography variant="h5" fontWeight={600} color="success.main">
                    {formatNumber(loadProfileData.dbCpuPerSecond, 2)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    DB CPU (s)
                  </Typography>
                </Grid>
              )}
              {loadProfileData?.transactionsPerSecond !== undefined && (
                <Grid item xs={6} sm={3}>
                  <Typography variant="h5" fontWeight={600} color="secondary.main">
                    {formatNumber(loadProfileData.transactionsPerSecond, 1)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Transactions
                  </Typography>
                </Grid>
              )}
              {loadProfileData?.logicalReadsPerSecond !== undefined && (
                <Grid item xs={6} sm={3}>
                  <Typography variant="h5" fontWeight={600} color="info.main">
                    {formatNumber(loadProfileData.logicalReadsPerSecond, 0)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Logical Reads
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Paper>
        </Box>
      )}
    </Box>
  );
}

export default OverviewTab;
