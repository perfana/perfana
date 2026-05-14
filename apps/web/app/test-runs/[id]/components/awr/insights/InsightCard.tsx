'use client';

/**
 * Insight Card Component
 *
 * Displays a single AWR analysis insight with severity indicator, title,
 * description, recommendation, and optional SQL reference.
 *
 * Features:
 * - Severity-colored styling based on insight type
 * - Expandable/collapsible content for detailed view
 * - SQL ID link for navigation to SQL details
 * - Impact score indicator when available
 * - Recommendation section with actionable advice
 * - Compact mode for dense lists
 *
 * @example
 * ```tsx
 * <InsightCard
 *   insight={insight}
 *   expanded={isExpanded}
 *   onExpandToggle={() => setExpanded(!isExpanded)}
 *   onSqlClick={(sqlId) => navigateToSql(sqlId)}
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
  Chip,
  Tooltip,
  Link,
  alpha,
} from '@mui/material';
import {
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Code as SqlIcon,
  Lightbulb as RecommendationIcon,
  TrendingUp as ImprovementIcon,
  TrendingDown as RegressionIcon,
  Speed as ImpactIcon,
  ChangeCircle as PlanChangeIcon,
} from '@mui/icons-material';
import { SeverityBadge } from './SeverityBadge';
import type { InsightCardProps, InsightCategory } from '../types';
import {
  getSeverityColors,
  getCategoryLabel,
  getCategoryIcon,
  getCategoryColor,
  getImpactScoreColor,
  getImpactScoreLabel,
} from '../utils/severity-helpers';
import { formatPercentage, formatNumber } from '../utils/formatters';

// ==================== Helper Functions ====================

/**
 * Get the category icon component
 */
function getCategoryIconComponent(category: InsightCategory): JSX.Element {
  // Map category to appropriate icon
  switch (category) {
    case 'regression':
      return <RegressionIcon fontSize="small" />;
    case 'improvement':
      return <ImprovementIcon fontSize="small" />;
    default:
      return <SqlIcon fontSize="small" />;
  }
}

/**
 * Format the value with unit for display
 */
function formatValueWithUnit(value?: number, unit?: string): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (unit === '%' || unit === 'percent') {
    return formatPercentage(value, 1);
  }

  if (unit === 's' || unit === 'seconds') {
    if (value >= 3600) {
      return `${formatNumber(value / 3600, 1)} hours`;
    }
    if (value >= 60) {
      return `${formatNumber(value / 60, 1)} min`;
    }
    return `${formatNumber(value, 2)} sec`;
  }

  if (unit === 'ms' || unit === 'milliseconds') {
    return `${formatNumber(value, 2)} ms`;
  }

  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

// ==================== Component ====================

/**
 * Insight Card Component
 *
 * Displays a single AWR analysis insight with expandable details.
 */
export function InsightCard({
  insight,
  expanded: controlledExpanded,
  onExpandToggle,
  showSqlLink = true,
  onSqlClick,
  compact = false,
}: InsightCardProps): JSX.Element {
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
   * Handle SQL ID click
   */
  const handleSqlClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      if (insight.sqlId && onSqlClick) {
        // Use fullSqlText if available, otherwise fall back to sqlText
        const sqlText = insight.fullSqlText || insight.sqlText;
        onSqlClick(insight.sqlId, sqlText);
      }
    },
    [insight.sqlId, insight.sqlText, insight.fullSqlText, onSqlClick],
  );

  // Get severity colors
  const severityColors = getSeverityColors(insight.severity);

  // Check if this is a plan change insight
  const isPlanChange = insight.tags?.includes('plan-change') ?? false;
  const planChangedMetadata = insight.metadata?.rawValues as Record<string, number> | undefined;
  const currentPlanHash = planChangedMetadata?.currentPlanHash;
  const baselinePlanHash = planChangedMetadata?.baselinePlanHash;
  const performanceFactor = planChangedMetadata?.performanceFactor;

  // Check if this is a row source insight (ASH SQL analysis)
  const isRowSourceInsight =
    insight.tags?.includes('execution-plan') || insight.tags?.includes('ash-analysis') || false;
  const rowSourceMetadata = insight.metadata?.rawValues as
    | Record<string, string | number>
    | undefined;
  const rowSource = rowSourceMetadata?.rowSource as string | undefined;
  const percentRowSource = rowSourceMetadata?.percentRowSource as number | undefined;
  const topEvent = (rowSourceMetadata?.topEvent || rowSourceMetadata?.topRowSource) as
    | string
    | undefined;
  const planHashValue = rowSourceMetadata?.planHashValue as number | undefined;

  // Determine if we have expandable content
  const hasExpandableContent =
    insight.recommendation ||
    insight.sqlText ||
    insight.metadata ||
    insight.changePercent !== undefined ||
    isPlanChange ||
    isRowSourceInsight;

  // Compact mode
  if (compact) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          py: 1,
          px: 1.5,
          borderRadius: 1,
          backgroundColor: alpha(severityColors.text, 0.04),
          borderLeft: `3px solid ${severityColors.text}`,
          '&:hover': {
            backgroundColor: alpha(severityColors.text, 0.08),
          },
        }}
        role="listitem"
        aria-label={`${insight.severity} insight: ${insight.title}`}
      >
        <SeverityBadge severity={insight.severity} showLabel={false} size="small" />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {insight.title}
          </Typography>
        </Box>
        {insight.sqlId && showSqlLink && onSqlClick && (
          <Tooltip title={`View SQL: ${insight.sqlId}`}>
            <IconButton size="small" onClick={handleSqlClick} aria-label="View SQL">
              <SqlIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: `4px solid ${severityColors.text}`,
        backgroundColor: alpha(severityColors.text, 0.02),
        '&:hover': {
          backgroundColor: alpha(severityColors.text, 0.04),
        },
        transition: 'background-color 0.2s',
      }}
      role="article"
      aria-label={`${insight.severity} insight: ${insight.title}`}
    >
      <CardContent sx={{ pb: isExpanded ? 2 : 1.5, '&:last-child': { pb: isExpanded ? 2 : 1.5 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          {/* Severity and Category badges */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flexShrink: 0 }}>
            <SeverityBadge severity={insight.severity} size="small" />
            <Chip
              size="small"
              icon={getCategoryIconComponent(insight.category)}
              label={getCategoryLabel(insight.category)}
              sx={{
                height: 20,
                fontSize: '0.65rem',
                backgroundColor: alpha(getCategoryColor(insight.category), 0.1),
                color: getCategoryColor(insight.category),
                '& .MuiChip-icon': {
                  color: getCategoryColor(insight.category),
                  fontSize: 12,
                  marginLeft: '4px',
                },
                '& .MuiChip-label': {
                  padding: '0 6px',
                },
              }}
            />
            {/* Plan Change Badge */}
            {isPlanChange && (
              <Tooltip title="Execution plan changed - likely root cause">
                <Chip
                  size="small"
                  icon={<PlanChangeIcon />}
                  label="Plan Changed"
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    backgroundColor: alpha('#ff9800', 0.15),
                    color: '#ff9800',
                    fontWeight: 600,
                    border: `1px solid ${alpha('#ff9800', 0.4)}`,
                    '& .MuiChip-icon': {
                      color: '#ff9800',
                      fontSize: 12,
                      marginLeft: '4px',
                    },
                    '& .MuiChip-label': {
                      padding: '0 6px',
                    },
                  }}
                />
              </Tooltip>
            )}
            {/* Row Source Badge */}
            {isRowSourceInsight && insight.tags?.includes('full-table-scan') && (
              <Tooltip title="Full table scan detected - inefficient data access">
                <Chip
                  size="small"
                  label="Full Scan"
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    backgroundColor: alpha('#e91e63', 0.15),
                    color: '#e91e63',
                    fontWeight: 600,
                    border: `1px solid ${alpha('#e91e63', 0.4)}`,
                    '& .MuiChip-label': {
                      padding: '0 6px',
                    },
                  }}
                />
              </Tooltip>
            )}
            {isRowSourceInsight && insight.tags?.includes('inefficient-index') && (
              <Tooltip title="Inefficient index usage detected">
                <Chip
                  size="small"
                  label="Index Issue"
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    backgroundColor: alpha('#ff5722', 0.15),
                    color: '#ff5722',
                    fontWeight: 600,
                    border: `1px solid ${alpha('#ff5722', 0.4)}`,
                    '& .MuiChip-label': {
                      padding: '0 6px',
                    },
                  }}
                />
              </Tooltip>
            )}
          </Box>

          {/* Content */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {/* Title */}
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                lineHeight: 1.3,
              }}
            >
              {insight.title}
            </Typography>

            {/* Description */}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                lineHeight: 1.5,
              }}
            >
              {insight.description}
            </Typography>

            {/* Metrics row */}
            <Box
              sx={{
                mt: 1,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.5,
                alignItems: 'center',
              }}
            >
              {/* Value */}
              {insight.value !== undefined && (
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    color: severityColors.text,
                    fontFamily: 'monospace',
                  }}
                >
                  {formatValueWithUnit(insight.value, insight.unit)}
                </Typography>
              )}

              {/* Percent of DB Time */}
              {insight.percentDbTime !== undefined && (
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: severityColors.text,
                    }}
                  />
                  {formatPercentage(insight.percentDbTime, 1)}{' '}
                  {insight.category === 'io_performance' && isRowSourceInsight
                    ? 'Row Source DB Time'
                    : insight.category === 'wait_events' && isRowSourceInsight
                      ? 'SQL Activity DB Time'
                      : 'of DB Time'}
                </Typography>
              )}

              {/* Impact Score */}
              {insight.impactScore !== undefined && (
                <Tooltip title={getImpactScoreLabel(insight.impactScore)}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    <ImpactIcon
                      sx={{ fontSize: 14, color: getImpactScoreColor(insight.impactScore) }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        color: getImpactScoreColor(insight.impactScore),
                      }}
                    >
                      {Math.round(insight.impactScore)}
                    </Typography>
                  </Box>
                </Tooltip>
              )}

              {/* Change Percent (for comparison insights) */}
              {insight.changePercent !== undefined && (
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    color: insight.changePercent > 0 ? '#f44336' : '#4caf50',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.25,
                  }}
                >
                  {insight.changePercent > 0 ? '+' : ''}
                  {formatPercentage(insight.changePercent, 1)}
                </Typography>
              )}

              {/* Performance Factor (for comparison insights) */}
              {performanceFactor !== undefined && performanceFactor !== 0 && performanceFactor !== 1 && (
                <Tooltip
                  title={
                    performanceFactor > 1
                      ? `${formatNumber(performanceFactor, 2)}x slower than baseline`
                      : `${formatNumber(1 / performanceFactor, 2)}x faster than baseline`
                  }
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: performanceFactor > 1 ? '#d32f2f' : '#2e7d32',
                      backgroundColor:
                        performanceFactor > 1
                          ? alpha('#d32f2f', 0.1)
                          : alpha('#2e7d32', 0.1),
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 0.5,
                      display: 'inline-block',
                    }}
                  >
                    {performanceFactor > 1
                      ? `${formatNumber(performanceFactor, 2)}x slower`
                      : `${formatNumber(1 / performanceFactor, 2)}x faster`}
                  </Typography>
                </Tooltip>
              )}

              {/* SQL ID link */}
              {insight.sqlId && showSqlLink && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <SqlIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  {onSqlClick ? (
                    <Link
                      component="button"
                      variant="caption"
                      onClick={handleSqlClick}
                      sx={{
                        fontFamily: 'monospace',
                        fontWeight: 500,
                        textDecoration: 'none',
                        '&:hover': {
                          textDecoration: 'underline',
                        },
                      }}
                    >
                      {insight.sqlId}
                    </Link>
                  ) : (
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        fontWeight: 500,
                        color: 'text.secondary',
                      }}
                    >
                      {insight.sqlId}
                    </Typography>
                  )}
                </Box>
              )}

              {/* Wait Event */}
              {insight.waitEvent && (
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    fontFamily: 'monospace',
                  }}
                >
                  {insight.waitEvent}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Expand button */}
          {hasExpandableContent && (
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
          )}
        </Box>

        {/* Expandable Content */}
        {hasExpandableContent && (
          <Collapse in={isExpanded}>
            <Box sx={{ mt: 2, pl: 0 }}>
              {/* Recommendation */}
              {insight.recommendation && (
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    p: 1.5,
                    borderRadius: 1,
                    backgroundColor: alpha('#4caf50', 0.08),
                    border: `1px solid ${alpha('#4caf50', 0.2)}`,
                    mb: insight.sqlText ? 1.5 : 0,
                  }}
                >
                  <RecommendationIcon
                    sx={{ fontSize: 18, color: '#4caf50', flexShrink: 0, mt: 0.25 }}
                  />
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, color: '#4caf50', display: 'block', mb: 0.5 }}
                    >
                      Recommendation
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {insight.recommendation}
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* SQL Text Preview */}
              {insight.sqlText && (
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    backgroundColor: alpha('#1976d2', 0.04),
                    border: `1px solid ${alpha('#1976d2', 0.15)}`,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#1976d2', display: 'block', mb: 0.5 }}
                  >
                    SQL Text
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: 'text.secondary',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      maxHeight: 120,
                      overflow: 'auto',
                    }}
                  >
                    {insight.sqlText.length > 500
                      ? `${insight.sqlText.substring(0, 500)}...`
                      : insight.sqlText}
                  </Typography>
                </Box>
              )}

              {/* Plan hash values (for plan change insights) */}
              {isPlanChange && baselinePlanHash !== undefined && currentPlanHash !== undefined && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: 1,
                    backgroundColor: alpha('#ff9800', 0.08),
                    border: `1px solid ${alpha('#ff9800', 0.2)}`,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#ff9800', display: 'block', mb: 0.5 }}
                  >
                    ⚠️ Execution Plan Changed
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      Baseline Plan: <strong>{baselinePlanHash}</strong>
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      Current Plan: <strong>{currentPlanHash}</strong>
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* Row Source Information (for ASH SQL analysis) */}
              {isRowSourceInsight && rowSource && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: 1,
                    backgroundColor: alpha('#e91e63', 0.08),
                    border: `1px solid ${alpha('#e91e63', 0.2)}`,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#e91e63', display: 'block', mb: 0.5 }}
                  >
                    🔍 Row Source Operation
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      Operation: <strong>{rowSource}</strong>
                    </Typography>
                    {percentRowSource !== undefined && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        DB Time: <strong>{formatPercentage(percentRowSource, 2)}</strong>
                      </Typography>
                    )}
                    {topEvent && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        Top Event: <strong>{topEvent}</strong>
                      </Typography>
                    )}
                    {planHashValue !== undefined && planHashValue > 0 && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        Plan Hash: <strong>{planHashValue}</strong>
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}

              {/* Baseline comparison info */}
              {insight.isComparison && insight.baselineValue !== undefined && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block' }}
                  >
                    Baseline: {formatValueWithUnit(insight.baselineValue, insight.unit)}
                    {insight.value !== undefined && (
                      <>
                        {' | Current: '}
                        {formatValueWithUnit(insight.value, insight.unit)}
                      </>
                    )}
                  </Typography>
                </Box>
              )}

              {/* Tags */}
              {insight.tags && insight.tags.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1.5 }}>
                  {insight.tags.map((tag, index) => (
                    <Chip
                      key={`${tag}-${index}`}
                      label={tag}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        '& .MuiChip-label': { px: 1 },
                      }}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </Collapse>
        )}
      </CardContent>
    </Card>
  );
}

// Default export
export default InsightCard;
