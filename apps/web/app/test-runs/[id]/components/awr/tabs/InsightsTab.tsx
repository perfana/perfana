'use client';

/**
 * InsightsTab Component
 *
 * Displays analysis insights from an AWR report with filtering,
 * grouping by severity or category, and detailed recommendations.
 *
 * @example
 * ```tsx
 * <InsightsTab
 *   reportId="report-uuid"
 *   _testRunId="test-run-uuid"
 *   showComparisonInsights={false}
 *   onSnackbar={(msg, sev) => showSnackbar(msg, sev)}
 * />
 * ```
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Skeleton,
  Alert,
  AlertTitle,
  useTheme,
  alpha,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Info as InfoIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useAwrAnalysis, useInsightsSummary } from '../hooks';
import { getAwrReport } from '@/lib/api/awr-reports';
import type {
  InsightsTabProps,
  InsightFilters,
  InsightSeverity,
  InsightCategory,
} from '../types';
import { InsightsList} from '../insights';
import { SqlTextViewer } from '../sql';
import {
  getSeverityColor,
  getSeverityBackgroundColor,
  getCategoryLabel,
  getCategoryColor,
} from '../utils';

// ==================== Constants ====================

const SEVERITY_ORDER: InsightSeverity[] = ['critical', 'warning', 'info'];

// ==================== Sub-Components ====================

function LoadingState() {
  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[1, 2, 3].map((i) => (
          <Grid size={{ xs: 12, md: 4 }} key={i}>
            <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 1 }} />
          </Grid>
        ))}
      </Grid>
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
    </Box>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
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
      <ErrorIcon sx={{ fontSize: 48, color: theme.palette.error.main, mb: 2 }} />
      <Typography variant="h6" color="error" gutterBottom>
        Failed to load analysis
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {message}
      </Typography>
      {onRetry && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
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
        backgroundColor: alpha(theme.palette.success.main, 0.04),
        borderRadius: 2,
      }}
    >
      <CheckCircleIcon sx={{ fontSize: 48, color: theme.palette.success.main, mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No issues found
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center">
        The analysis did not detect any performance issues in this AWR report.
        This is a good sign!
      </Typography>
    </Box>
  );
}

interface SeveritySummaryCardProps {
  severity: InsightSeverity;
  count: number;
  total: number;
  onClick?: () => void;
  selected?: boolean;
}

function SeveritySummaryCard({
  severity,
  count,
  total: _total,
  onClick,
  selected,
}: SeveritySummaryCardProps) {
  const theme = useTheme();
  const bgColor = getSeverityBackgroundColor(severity);
  const color = getSeverityColor(severity);

  const getIcon = () => {
    switch (severity) {
      case 'critical':
        return <ErrorIcon sx={{ fontSize: 32, color }} />;
      case 'warning':
        return <WarningIcon sx={{ fontSize: 32, color }} />;
      case 'info':
        return <InfoIcon sx={{ fontSize: 32, color }} />;
    }
  };

  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: 2,
        cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${selected ? color : theme.palette.divider}`,
        borderRadius: 2,
        backgroundColor: selected ? bgColor : 'transparent',
        transition: 'all 0.2s ease',
        '&:hover': onClick
          ? {
              borderColor: color,
              backgroundColor: bgColor,
            }
          : {},
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {getIcon()}
        <Box sx={{ flexGrow: 1 }}>
          <Typography
            variant="h4"
            fontWeight={700}
            sx={{ color, lineHeight: 1 }}
          >
            {count}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textTransform: 'capitalize' }}
          >
            {severity}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

interface CategoryChipProps {
  category: InsightCategory;
  count: number;
  selected: boolean;
  onClick: () => void;
}

function CategoryChip({ category, count, selected, onClick }: CategoryChipProps) {
  const color = getCategoryColor(category);
  const label = getCategoryLabel(category);

  return (
    <Chip
      label={`${label} (${count})`}
      onClick={onClick}
      variant={selected ? 'filled' : 'outlined'}
      sx={{
        borderColor: color,
        backgroundColor: selected ? alpha(color, 0.15) : 'transparent',
        color: selected ? color : 'inherit',
        '&:hover': {
          backgroundColor: alpha(color, 0.1),
        },
      }}
    />
  );
}

interface PendingAnalysisStateProps {
  onTriggerAnalysis?: () => void;
  isAnalyzing?: boolean;
}

function PendingAnalysisState({
  onTriggerAnalysis,
  isAnalyzing,
}: PendingAnalysisStateProps) {
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
        Analysis not yet performed
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} textAlign="center">
        Click the button below to run the analysis and generate insights.
      </Typography>
      {onTriggerAnalysis && (
        <Button
          variant="contained"
          color="primary"
          onClick={onTriggerAnalysis}
          disabled={isAnalyzing}
          startIcon={<RefreshIcon />}
        >
          {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      )}
    </Box>
  );
}

// ==================== Main Component ====================

/**
 * InsightsTab - Displays analysis insights from AWR report
 * with severity summary, category filtering, and detailed list.
 */
export function InsightsTab({
  reportId,
  initialFilters,
  showComparisonInsights = false,
  onSnackbar,
}: InsightsTabProps) {
  const theme = useTheme();

  // State for filters
  const [selectedSeverities, setSelectedSeverities] = useState<InsightSeverity[]>(
    initialFilters?.severities ?? []
  );
  const [selectedCategories, setSelectedCategories] = useState<InsightCategory[]>(
    initialFilters?.categories ?? []
  );
  const [searchText, setSearchText] = useState(initialFilters?.searchText ?? '');

  // State for SQL modal
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [selectedSql, setSelectedSql] = useState<{ sqlId: string; sqlText?: string } | null>(null);

  // Fetch analysis data
  const {
    analysis,
    insights: rawInsights,
    loading,
    error,
    refetch,
    reanalyze,
    isReanalyzing,
    hasAnalysis,
    filterInsights,
  } = useAwrAnalysis(reportId, {
    onSnackbar,
  });

  // Fetch report data to get full SQL text
  const {
    data: report,
    isLoading: reportLoading,
  } = useQuery({
    queryKey: ['awr-report', reportId],
    queryFn: () => getAwrReport(reportId),
    enabled: !!reportId,
    staleTime: 60000,
  });

  // Enrich insights with full SQL text from report's Top SQL data
  const insights = useMemo(() => {
    if (!report?.parsedData?.topSql) {
      return rawInsights;
    }

    // Build SQL ID to full SQL text mapping
    const sqlTextMap = new Map<string, string>();

    // Check all SQL statement arrays for fullSqlText
    // AWR groups Top SQL into several rankings (by elapsed time, by CPU, ...),
    // each an array of the same statement shape.
    const topSql = (report.parsedData.topSql ?? {}) as Record<
      string,
      Array<{ sqlId?: string; fullSqlText?: string }> | undefined
    >;
    const sqlArrays = [
      topSql.byElapsedTime,
      topSql.byCpuTime,
      topSql.byGetsPerExec,
      topSql.byReadsPerExec,
      topSql.byExecutions,
      topSql.byParseCall,
      topSql.byShareableMemory,
      topSql.byVersionCount,
    ];

    for (const sqlArray of sqlArrays) {
      if (Array.isArray(sqlArray)) {
        for (const stmt of sqlArray) {
          if (stmt.sqlId && stmt.fullSqlText) {
            sqlTextMap.set(stmt.sqlId, stmt.fullSqlText);
          }
        }
      }
    }

    // Enrich insights with full SQL text
    return rawInsights.map((insight) => {
      if (insight.sqlId && !insight.fullSqlText) {
        const fullSqlText = sqlTextMap.get(insight.sqlId);
        if (fullSqlText) {
          return { ...insight, fullSqlText };
        }
      }
      return insight;
    });
  }, [rawInsights, report]);

  // Calculate insights summary
  const summary = useInsightsSummary(insights);

  // Build current filters
  const currentFilters: InsightFilters = useMemo(
    () => ({
      severities: selectedSeverities.length > 0 ? selectedSeverities : undefined,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      searchText: searchText || undefined,
      comparisonOnly: showComparisonInsights ? true : undefined,
    }),
    [selectedSeverities, selectedCategories, searchText, showComparisonInsights]
  );

  // Get filtered insights
  const filteredInsights = useMemo(
    () => filterInsights(currentFilters),
    [filterInsights, currentFilters]
  );

  // Get unique categories from insights
  const availableCategories = useMemo(() => {
    const categoryMap = new Map<InsightCategory, number>();
    for (const insight of insights) {
      const count = categoryMap.get(insight.category) ?? 0;
      categoryMap.set(insight.category, count + 1);
    }
    return Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));
  }, [insights]);

  // Handlers
  const handleSeverityClick = useCallback((severity: InsightSeverity) => {
    setSelectedSeverities((prev) => {
      if (prev.includes(severity)) {
        return prev.filter((s) => s !== severity);
      }
      return [...prev, severity];
    });
  }, []);

  const handleCategoryClick = useCallback((category: InsightCategory) => {
    setSelectedCategories((prev) => {
      if (prev.includes(category)) {
        return prev.filter((c) => c !== category);
      }
      return [...prev, category];
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedSeverities([]);
    setSelectedCategories([]);
    setSearchText('');
  }, []);

  const handleSqlClick = useCallback((sqlId: string, sqlText?: string) => {
    setSelectedSql({ sqlId, sqlText });
    setSqlModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setSqlModalOpen(false);
    setSelectedSql(null);
  }, []);

  // Loading state
  if (loading || reportLoading) {
    return <LoadingState />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  // No analysis yet
  if (!hasAnalysis) {
    return (
      <PendingAnalysisState
        onTriggerAnalysis={reanalyze}
        isAnalyzing={isReanalyzing}
      />
    );
  }

  // No insights found
  if (insights.length === 0) {
    return <EmptyState />;
  }

  const hasActiveFilters =
    selectedSeverities.length > 0 || selectedCategories.length > 0 || searchText;

  return (
    <Box sx={{ p: 2 }}>
      {/* Severity Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {SEVERITY_ORDER.map((severity) => (
          <Grid size={{ xs: 12, sm: 4 }} key={severity}>
            <SeveritySummaryCard
              severity={severity}
              count={summary.bySeverity[severity]}
              total={summary.totalCount}
              selected={selectedSeverities.includes(severity)}
              onClick={() => handleSeverityClick(severity)}
            />
          </Grid>
        ))}
      </Grid>

      {/* Critical Alert Banner */}
      {summary.hasCritical && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => handleSeverityClick('critical')}
            >
              View All
            </Button>
          }
        >
          <AlertTitle>Critical Issues Detected</AlertTitle>
          {summary.criticalCount} critical performance issue
          {summary.criticalCount > 1 ? 's' : ''} found that may significantly
          impact database performance.
        </Alert>
      )}

      {/* Category Filter Chips */}
      {availableCategories.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 3,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 1.5,
            }}
          >
            <Typography variant="subtitle2" color="text.secondary">
              Filter by Category
            </Typography>
            {hasActiveFilters && (
              <Button
                size="small"
                onClick={handleClearFilters}
                sx={{ textTransform: 'none' }}
              >
                Clear all filters
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {availableCategories.map(({ category, count }) => (
              <CategoryChip
                key={category}
                category={category}
                count={count}
                selected={selectedCategories.includes(category)}
                onClick={() => handleCategoryClick(category)}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Re-analyze Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Tooltip title="Re-run analysis with latest algorithm">
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={reanalyze}
            disabled={isReanalyzing}
          >
            {isReanalyzing ? 'Analyzing...' : 'Re-analyze'}
          </Button>
        </Tooltip>
      </Box>

      {/* Filtered Results Notice */}
      {hasActiveFilters && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {filteredInsights.length} of {insights.length} insights
            {selectedSeverities.length > 0 && (
              <> • Severity: {selectedSeverities.join(', ')}</>
            )}
            {selectedCategories.length > 0 && (
              <> • Categories: {selectedCategories.length}</>
            )}
          </Typography>
        </Box>
      )}

      {/* Insights List */}
      {filteredInsights.length === 0 ? (
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
          <Typography variant="body2" color="text.secondary">
            No insights match your filter criteria.{' '}
            <Button size="small" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </Typography>
        </Box>
      ) : (
        <InsightsList
          insights={filteredInsights}
          groupBySeverity
          onSqlClick={handleSqlClick}
          emptyMessage="No insights to display"
        />
      )}

      {/* Analysis Metadata */}
      {analysis && (
        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="caption" color="text.disabled">
            Analysis performed at{' '}
            {new Date(analysis.analyzedAt).toLocaleString()}
            {analysis.analysisVersion && ` • Version ${analysis.analysisVersion}`}
          </Typography>
        </Box>
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

export default InsightsTab;
