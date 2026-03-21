'use client';

/**
 * SQL Statement Card Component
 *
 * Displays a single SQL statement with its metrics, including execution statistics,
 * timing, buffer gets, disk reads, and percentage of DB time. Supports comparison
 * mode to show differences from baseline.
 *
 * Features:
 * - Key metrics display (elapsed time, CPU time, buffer gets, disk reads)
 * - Expandable content showing full SQL text
 * - Comparison mode with change indicators
 * - Rank badge for top SQL display
 * - Copy to clipboard functionality
 * - Module/schema information display
 *
 * @example
 * ```tsx
 * <SqlStatementCard
 *   statement={sqlStatement}
 *   rank={1}
 *   expanded={isExpanded}
 *   onExpandToggle={() => setExpanded(!isExpanded)}
 * />
 * ```
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Collapse,
  Tooltip,
  Chip,
  Divider,
  alpha,
} from '@mui/material';
import {
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  ContentCopy as CopyIcon,
  Schedule as TimeIcon,
  Memory as CpuIcon,
  Storage as BufferIcon,
  Speed as DiskIcon,
  Repeat as ExecIcon,
  TrendingUp as RegressionIcon,
  TrendingDown as ImprovementIcon,
  Code as SqlIcon,
} from '@mui/icons-material';
import { SqlTextViewer } from './SqlTextViewer';
import type { SqlStatementCardProps, SqlStatementMetrics } from '../types';
import {
  formatDuration,
  formatNumber,
  formatCompactNumber,
  formatPercentage,
  formatChangePercentage,
  formatSqlId,
} from '../utils/formatters';
import { determineChangeDirection, getChangeDirectionColor } from '../utils/severity-helpers';

// ==================== Helper Functions ====================

/**
 * Calculate percentage change between two values
 */
function calculateChangePercent(
  current: number | undefined,
  baseline: number | undefined,
): number | null {
  if (
    current === undefined ||
    baseline === undefined ||
    baseline === 0
  ) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

/**
 * Metric change indicator component
 */
function MetricChange({
  current,
  baseline,
  label,
  formatFn = formatNumber,
  higherIsBetter = false,
}: {
  current: number | undefined;
  baseline: number | undefined;
  label: string;
  formatFn?: (value: number | null | undefined, decimals?: number) => string;
  higherIsBetter?: boolean;
}): JSX.Element | null {
  const changePercent = calculateChangePercent(current, baseline);
  if (changePercent === null) return null;

  const direction = determineChangeDirection(changePercent, 5, higherIsBetter);
  const color = getChangeDirectionColor(direction);
  const Icon = direction === 'regressed' ? RegressionIcon : ImprovementIcon;
  const showIcon = direction !== 'unchanged';

  return (
    <Tooltip title={`${label}: Baseline ${formatFn(baseline)} vs Current ${formatFn(current)}`}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          color,
          fontSize: '0.75rem',
        }}
      >
        {showIcon && <Icon sx={{ fontSize: 12 }} />}
        <Typography variant="caption" sx={{ fontWeight: 600, color }}>
          {formatChangePercentage(changePercent, 1)}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ==================== Metric Display Component ====================

interface MetricDisplayProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  highlight?: boolean;
  tooltip?: string;
  comparison?: React.ReactNode;
}

function MetricDisplay({
  icon,
  label,
  value,
  subValue,
  highlight = false,
  tooltip,
  comparison,
}: MetricDisplayProps): JSX.Element {
  const content = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 80,
        p: 1,
        borderRadius: 1,
        backgroundColor: highlight ? alpha('#1976d2', 0.08) : 'transparent',
        transition: 'background-color 0.2s',
        '&:hover': {
          backgroundColor: alpha('#1976d2', 0.04),
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
        {icon}
        <Typography variant="caption" sx={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>
          {label}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          fontFamily: 'monospace',
          color: highlight ? 'primary.main' : 'text.primary',
          mt: 0.25,
        }}
      >
        {value}
      </Typography>
      {subValue && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          {subValue}
        </Typography>
      )}
      {comparison}
    </Box>
  );

  return tooltip ? <Tooltip title={tooltip}>{content}</Tooltip> : content;
}

// ==================== Main Component ====================

/**
 * SQL Statement Card Component
 *
 * Displays a single SQL statement with expandable details.
 */
export function SqlStatementCard({
  statement,
  rank,
  expanded: controlledExpanded,
  onExpandToggle,
  showComparison = false,
  baselineMetrics,
  onSnackbar,
}: SqlStatementCardProps): JSX.Element {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(false);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : internalExpanded;

  /**
   * Handle expand toggle
   */
  const handleExpandToggle = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      if (isControlled && onExpandToggle) {
        onExpandToggle();
      } else {
        setInternalExpanded((prev) => !prev);
      }
    },
    [isControlled, onExpandToggle],
  );

  /**
   * Handle copy SQL ID to clipboard
   */
  const handleCopySqlId = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation();
      if (!statement.sqlId) return;

      try {
        await navigator.clipboard.writeText(statement.sqlId);
        onSnackbar?.('SQL ID copied to clipboard', 'success');
      } catch {
        onSnackbar?.('Failed to copy SQL ID', 'error');
      }
    },
    [statement.sqlId, onSnackbar],
  );

  // Determine if there are comparison metrics
  const hasComparison = showComparison && baselineMetrics;

  // Determine DB time percentage highlight threshold
  const isHighDbTime = (statement.percentDbTime ?? 0) >= 10;

  return (
    <Card
      variant="outlined"
      sx={{
        position: 'relative',
        borderLeft: isHighDbTime ? '4px solid #ff9800' : '4px solid transparent',
        backgroundColor: isHighDbTime ? alpha('#ff9800', 0.02) : 'transparent',
        '&:hover': {
          backgroundColor: alpha('#1976d2', 0.02),
        },
        transition: 'background-color 0.2s',
      }}
      role="article"
      aria-label={`SQL statement ${statement.sqlId || 'unknown'}`}
    >
      <CardContent sx={{ pb: isExpanded ? 2 : 1.5, '&:last-child': { pb: isExpanded ? 2 : 1.5 } }}>
        {/* Header Row */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          {/* Rank Badge */}
          {rank !== undefined && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: rank <= 3 ? alpha('#f44336', 0.1) : alpha('#9e9e9e', 0.1),
                color: rank <= 3 ? '#f44336' : 'text.secondary',
                fontWeight: 700,
                fontSize: '0.8rem',
                flexShrink: 0,
              }}
            >
              #{rank}
            </Box>
          )}

          {/* SQL Info */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {/* SQL ID Row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <SqlIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color: 'primary.main',
                  }}
                >
                  {formatSqlId(statement.sqlId)}
                </Typography>
              </Box>

              <Tooltip title="Copy SQL ID">
                <IconButton size="small" onClick={handleCopySqlId} aria-label="Copy SQL ID">
                  <CopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>

              {/* DB Time percentage */}
              {statement.percentDbTime !== undefined && (
                <Chip
                  size="small"
                  label={`${formatPercentage(statement.percentDbTime, 1)} DB Time`}
                  sx={{
                    height: 20,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    backgroundColor: isHighDbTime
                      ? alpha('#ff9800', 0.15)
                      : alpha('#1976d2', 0.1),
                    color: isHighDbTime ? '#e65100' : '#1976d2',
                    '& .MuiChip-label': { px: 1 },
                  }}
                />
              )}

              {/* Module/Schema badges */}
              {statement.module && (
                <Chip
                  size="small"
                  label={statement.module}
                  variant="outlined"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
              {statement.parsingSchemaName && (
                <Chip
                  size="small"
                  label={statement.parsingSchemaName}
                  variant="outlined"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
            </Box>

            {/* SQL Preview (one line) */}
            {statement.sqlText && (
              <Typography
                variant="body2"
                sx={{
                  mt: 0.75,
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}
              >
                {statement.sqlText.replace(/\s+/g, ' ').trim().substring(0, 100)}
                {statement.sqlText.length > 100 ? '...' : ''}
              </Typography>
            )}
          </Box>

          {/* Expand button */}
          <IconButton
            size="small"
            onClick={handleExpandToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            sx={{
              flexShrink: 0,
              color: 'text.secondary',
            }}
          >
            {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
          </IconButton>
        </Box>

        {/* Metrics Row */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            mt: 1.5,
            justifyContent: 'flex-start',
          }}
        >
          {/* Elapsed Time */}
          <MetricDisplay
            icon={<TimeIcon sx={{ fontSize: 14 }} />}
            label="Elapsed"
            value={formatDuration(statement.elapsedTime, 2)}
            subValue={
              statement.elapsedTimePerExec !== undefined
                ? `${formatDuration(statement.elapsedTimePerExec, 3)}/exec`
                : undefined
            }
            highlight={isHighDbTime}
            tooltip="Total elapsed time for all executions"
            comparison={
              hasComparison ? (
                <MetricChange
                  current={statement.elapsedTime}
                  baseline={baselineMetrics?.elapsedTime}
                  label="Elapsed Time"
                  formatFn={formatDuration}
                />
              ) : undefined
            }
          />

          {/* CPU Time */}
          <MetricDisplay
            icon={<CpuIcon sx={{ fontSize: 14 }} />}
            label="CPU"
            value={formatDuration(statement.cpuTime, 2)}
            subValue={
              statement.cpuTimePerExec !== undefined
                ? `${formatDuration(statement.cpuTimePerExec, 3)}/exec`
                : undefined
            }
            tooltip="Total CPU time for all executions"
            comparison={
              hasComparison ? (
                <MetricChange
                  current={statement.cpuTime}
                  baseline={baselineMetrics?.cpuTime}
                  label="CPU Time"
                  formatFn={formatDuration}
                />
              ) : undefined
            }
          />

          {/* Buffer Gets */}
          <MetricDisplay
            icon={<BufferIcon sx={{ fontSize: 14 }} />}
            label="Buffer Gets"
            value={formatCompactNumber(statement.bufferGets, 1)}
            subValue={
              statement.bufferGetsPerExec !== undefined
                ? `${formatCompactNumber(statement.bufferGetsPerExec, 1)}/exec`
                : undefined
            }
            tooltip="Total logical reads (buffer gets)"
            comparison={
              hasComparison ? (
                <MetricChange
                  current={statement.bufferGets}
                  baseline={baselineMetrics?.bufferGets}
                  label="Buffer Gets"
                  formatFn={formatCompactNumber}
                />
              ) : undefined
            }
          />

          {/* Disk Reads */}
          <MetricDisplay
            icon={<DiskIcon sx={{ fontSize: 14 }} />}
            label="Disk Reads"
            value={formatCompactNumber(statement.diskReads, 1)}
            subValue={
              statement.diskReadsPerExec !== undefined
                ? `${formatCompactNumber(statement.diskReadsPerExec, 1)}/exec`
                : undefined
            }
            tooltip="Total physical reads"
            comparison={
              hasComparison ? (
                <MetricChange
                  current={statement.diskReads}
                  baseline={baselineMetrics?.diskReads}
                  label="Disk Reads"
                  formatFn={formatCompactNumber}
                />
              ) : undefined
            }
          />

          {/* Executions */}
          <MetricDisplay
            icon={<ExecIcon sx={{ fontSize: 14 }} />}
            label="Executions"
            value={formatNumber(statement.executions, 0)}
            tooltip="Total number of executions"
            comparison={
              hasComparison ? (
                <MetricChange
                  current={statement.executions}
                  baseline={baselineMetrics?.executions}
                  label="Executions"
                  formatFn={formatNumber}
                  higherIsBetter={false}
                />
              ) : undefined
            }
          />
        </Box>

        {/* Expandable Content */}
        <Collapse in={isExpanded}>
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />

            {/* Plan Hash Value */}
            {statement.planHashValue !== undefined && (
              <Box sx={{ mb: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5 }}
                >
                  Plan Hash Value
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                >
                  {statement.planHashValue}
                </Typography>
              </Box>
            )}

            {/* Rows Processed */}
            {statement.rowsProcessed !== undefined && (
              <Box sx={{ mb: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5 }}
                >
                  Rows Processed
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                >
                  {formatNumber(statement.rowsProcessed, 0)}
                </Typography>
              </Box>
            )}

            {/* SQL Text */}
            {statement.sqlText && (
              <Box sx={{ mt: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  SQL Text
                </Typography>
                <SqlTextViewer
                  sqlText={statement.sqlText}
                  sqlId={statement.sqlId}
                  maxHeight={400}
                  showCopyButton
                  showExpandButton
                  onSnackbar={onSnackbar}
                />
              </Box>
            )}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

// Default export
export default SqlStatementCard;
