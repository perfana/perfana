'use client';

/**
 * SegmentsTab Component
 *
 * Displays segment statistics from AWR reports including table scans (FTS),
 * logical reads, physical reads, row lock waits, and buffer busy waits.
 *
 * @example
 * ```tsx
 * <SegmentsTab
 *   reportId="report-uuid"
 *   _testRunId="test-run-uuid"
 *   initialSegmentType="tableScans"
 * />
 * ```
 */

import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  Skeleton,
  Alert,
  Chip,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Storage as StorageIcon,
  TableChart as TableChartIcon,
  Lock as LockIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { getAwrReport, type AwrReport } from '@/lib/api/awr-reports';
import type { SegmentsTabProps } from '../types';
import { formatNumber } from '../utils';

// ==================== Types ====================

interface SegmentStatistic {
  owner: string;
  tablespaceName?: string;
  objectName: string;
  subobjectName?: string;
  objectType: string;
  objectId?: number;
  dataObjectId?: number;
  pdbName?: string;
  value: number;
  percentTotal?: number;
}

type SegmentType = 'tableScans' | 'logicalReads' | 'physicalReads' | 'physicalReadRequests' | 'rowLockWaits' | 'bufferBusyWaits';

interface SegmentTypeConfig {
  id: SegmentType;
  label: string;
  icon: React.ReactNode;
  valueLabel: string;
  description: string;
}

// ==================== Constants ====================

const SEGMENT_TYPE_CONFIGS: SegmentTypeConfig[] = [
  {
    id: 'tableScans',
    label: 'Table Scans',
    icon: <TableChartIcon />,
    valueLabel: 'Scans',
    description: 'Full table scans and index fast full scans',
  },
  {
    id: 'logicalReads',
    label: 'Logical Reads',
    icon: <StorageIcon />,
    valueLabel: 'Reads',
    description: 'Buffer cache reads (memory)',
  },
  {
    id: 'physicalReads',
    label: 'Physical Reads',
    icon: <StorageIcon />,
    valueLabel: 'Reads',
    description: 'Disk reads (I/O)',
  },
  {
    id: 'rowLockWaits',
    label: 'Row Lock Waits',
    icon: <LockIcon />,
    valueLabel: 'Waits',
    description: 'Row-level lock contention',
  },
  {
    id: 'bufferBusyWaits',
    label: 'Buffer Busy Waits',
    icon: <SpeedIcon />,
    valueLabel: 'Waits',
    description: 'Buffer cache contention',
  },
];

// ==================== Helper Functions ====================

/**
 * Segment statistics are grouped by ranking (byTableScans, byLogicalReads, ...)
 * with a matching total per group, so both lookups are keyed rather than named.
 */
type SegmentStatistics = Record<string, SegmentStatistic[] | number | undefined>;

function getSegmentData(report: AwrReport, segmentType: SegmentType): SegmentStatistic[] {
  const segmentStats = report?.parsedData?.segmentStatistics as SegmentStatistics | undefined;
  if (!segmentStats) return [];

  const mapping: Record<SegmentType, string> = {
    tableScans: 'byTableScans',
    logicalReads: 'byLogicalReads',
    physicalReads: 'byPhysicalReads',
    physicalReadRequests: 'byPhysicalReadRequests',
    rowLockWaits: 'byRowLockWaits',
    bufferBusyWaits: 'byBufferBusyWaits',
  };

  return (segmentStats[mapping[segmentType]] as SegmentStatistic[] | undefined) || [];
}

function getTotalValue(report: AwrReport, segmentType: SegmentType): number | undefined {
  const segmentStats = report?.parsedData?.segmentStatistics as SegmentStatistics | undefined;
  if (!segmentStats) return undefined;

  const mapping: Record<SegmentType, string> = {
    tableScans: 'totalTableScans',
    logicalReads: 'totalLogicalReads',
    physicalReads: 'totalPhysicalReads',
    physicalReadRequests: 'totalPhysicalReads',
    rowLockWaits: undefined,
    bufferBusyWaits: undefined,
  };

  const totalKey = mapping[segmentType];
  return totalKey ? (segmentStats[totalKey] as number | undefined) : undefined;
}

// ==================== Main Component ====================

export function SegmentsTab({
  reportId,
  initialSegmentType = 'tableScans',
}: SegmentsTabProps) {
  const theme = useTheme();
  const [selectedType, setSelectedType] = useState<SegmentType>(initialSegmentType);

  // Fetch AWR report
  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['awr-report', reportId],
    queryFn: () => getAwrReport(reportId),
    enabled: !!reportId,
    staleTime: 30000,
  });

  // Get segment data and configuration
  const segments = useMemo(() => getSegmentData(report, selectedType), [report, selectedType]);
  const totalValue = useMemo(() => getTotalValue(report, selectedType), [report, selectedType]);
  const config = SEGMENT_TYPE_CONFIGS.find((c) => c.id === selectedType)!;

  // Handle tab change
  const handleTabChange = (_event: React.SyntheticEvent, newValue: SegmentType) => {
    setSelectedType(newValue);
  };

  // Loading state
  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={400} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load segment statistics</Alert>
      </Box>
    );
  }

  // No data state
  if (!report?.parsedData?.segmentStatistics) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No segment statistics available in this AWR report. The report may not have been fully parsed yet.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Segment Type Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={selectedType}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              textTransform: 'none',
              minHeight: 64,
              px: 3,
            },
          }}
        >
          {SEGMENT_TYPE_CONFIGS.map((typeConfig) => {
            const data = getSegmentData(report, typeConfig.id);
            const hasData = data && data.length > 0;

            return (
              <Tab
                key={typeConfig.id}
                value={typeConfig.id}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {typeConfig.icon}
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {typeConfig.label}
                      </Typography>
                      {hasData && (
                        <Typography variant="caption" color="text.secondary">
                          {data.length} segments
                        </Typography>
                      )}
                    </Box>
                  </Box>
                }
                disabled={!hasData}
              />
            );
          })}
        </Tabs>
      </Paper>

      {/* Segment Type Description */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {config.label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {config.description}
          </Typography>
        </Box>
        {totalValue !== undefined && (
          <Chip
            label={`Total: ${formatNumber(totalValue)}`}
            color="primary"
            variant="outlined"
          />
        )}
      </Box>

      {/* Segments Table */}
      {segments.length === 0 ? (
        <Alert severity="info">No {config.label.toLowerCase()} found in this report.</Alert>
      ) : (
        <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}>
                  #
                </TableCell>
                <TableCell sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}>
                  Owner
                </TableCell>
                <TableCell sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}>
                  Object Name
                </TableCell>
                <TableCell sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}>
                  Type
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}
                >
                  {config.valueLabel}
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ fontWeight: 600, backgroundColor: alpha(theme.palette.primary.main, 0.05) }}
                >
                  % Total
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {segments.map((segment, index) => (
                <TableRow
                  key={`${segment.owner}-${segment.objectName}-${index}`}
                  hover
                  sx={{
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.03),
                    },
                  }}
                >
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Tooltip title={segment.pdbName || 'N/A'} arrow>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {segment.owner}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {segment.objectName}
                    </Typography>
                    {segment.subobjectName && (
                      <Typography variant="caption" color="text.secondary">
                        ({segment.subobjectName})
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={segment.objectType}
                      size="small"
                      color={segment.objectType === 'TABLE' ? 'primary' : 'default'}
                      variant={segment.objectType === 'TABLE' ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {formatNumber(segment.value)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {segment.percentTotal !== undefined ? (
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          color:
                            segment.percentTotal > 10
                              ? theme.palette.error.main
                              : segment.percentTotal > 5
                              ? theme.palette.warning.main
                              : 'text.primary',
                        }}
                      >
                        {segment.percentTotal.toFixed(2)}%
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default SegmentsTab;
