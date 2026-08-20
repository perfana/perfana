'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Collapse,
  alpha,
  useTheme,
  Tooltip,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Settings,
  Search,
  Clear,
} from '@mui/icons-material';
import SLOMetricsChart from '../SLOMetricsChart';
import AggregatedSloChart from '../AggregatedSloChart';
import SLOStatusChip from './SLOStatusChip';
import ApdexScenarioTable from './ApdexScenarioTable';
import MetricSeriesTable from './MetricSeriesTable';

import { SortField, SortDirection, SamplerStat } from '../types';
import { CheckResult, Benchmark } from '@/lib/types';
import { TestRun } from '@/types/test-runs';
import {
  isApdexResult,
  formatApdexRequirement,
  formatRequirement,
  formatAggregatedMetricLabel,
} from '../utils/slo-formatters';

interface SLOListProps {
  testRun: TestRun | null;
  testRunId: string;
  checkResults: CheckResult[];
  benchmarks: Benchmark[];
  expandedSloRows: Set<string>;
  sloFilter: 'all' | 'failed';
  searchText: string;
  sortConfig: Map<string, { field: SortField; direction: SortDirection }>;
  selectedTarget: Map<string, string>;
  setSelectedTarget: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  expandedTransactions: Set<string>;
  transactionSamples: Record<string, SamplerStat[]>;
  loadingTransactionSamples: Record<string, boolean>;
  transactionSamplesError: Record<string, string>;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;

  // Actions
  toggleSloRow: (key: string) => void;
  handleSort: (rowKey: string, field: SortField) => void;
  setSloFilter: (filter: 'all' | 'failed') => void;
  setIsFilterManuallySet: (value: boolean) => void;
  setSearchText: (text: string) => void;
  toggleTransactionExpanded: (transactionKey: string, transactionName: string, excludeRampUp: boolean) => Promise<void>;
  handleOpenRequestActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, samplerName: string) => void;
  handleOpenApdexActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, threshold: number) => void;
  handleEditSlo: (checkResult: CheckResult) => Promise<void>;
  handleReEvaluate: (panelId: number, applicationDashboardId?: string, metricName?: string) => Promise<void>;
  handleOpenApdexThresholdsDialog: (result: CheckResult, event: React.MouseEvent) => void;
  getCheckResultKey: (result: CheckResult) => string;
}

export function SLOList({
  testRun,
  testRunId,
  checkResults,
  benchmarks,
  expandedSloRows,
  sloFilter,
  searchText,
  sortConfig,
  selectedTarget,
  setSelectedTarget,
  expandedTransactions,
  transactionSamples,
  loadingTransactionSamples,
  transactionSamplesError,
  hasDistributedTracing = false,
  hasDynatrace = false,
  toggleSloRow,
  handleSort,
  setSloFilter,
  setIsFilterManuallySet,
  setSearchText,
  toggleTransactionExpanded,
  handleOpenRequestActionMenu,
  handleOpenApdexActionMenu,
  handleEditSlo,
  handleReEvaluate,
  handleOpenApdexThresholdsDialog,
  getCheckResultKey,
}: SLOListProps) {
  const theme = useTheme();

  // Filter results based on search and status filter
  const getFilteredResults = () => {
    let filteredResults = checkResults;

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filteredResults = filteredResults.filter(r =>
        r.dashboard_label?.toLowerCase().includes(searchLower) ||
        r.panel_title?.toLowerCase().includes(searchLower) ||
        r.metric_name?.toLowerCase().includes(searchLower) ||
        r.config_title?.toLowerCase().includes(searchLower)
      );
    }

    // Apply status filter
    if (sloFilter === 'failed') {
      filteredResults = filteredResults.filter(r => r.meets_requirement === false);
    }

    // Sort: Apdex SLOs first, then by dashboard label
    filteredResults = [...filteredResults].sort((a, b) => {
      const aIsApdex = a.panel_type === 'apdex' || a.evaluate_type === 'apdex';
      const bIsApdex = b.panel_type === 'apdex' || b.evaluate_type === 'apdex';
      if (aIsApdex && !bIsApdex) return -1;
      if (!aIsApdex && bIsApdex) return 1;
      return (a.dashboard_label || '').localeCompare(b.dashboard_label || '');
    });

    return filteredResults;
  };

  // Get counts for filter chips
  const getFilterCounts = () => {
    let base = checkResults;
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      base = base.filter(r =>
        r.dashboard_label?.toLowerCase().includes(searchLower) ||
        r.panel_title?.toLowerCase().includes(searchLower) ||
        r.metric_name?.toLowerCase().includes(searchLower) ||
        r.config_title?.toLowerCase().includes(searchLower)
      );
    }
    return {
      all: base.length,
      failed: base.filter(r => r.meets_requirement === false).length,
    };
  };

  const filterCounts = getFilterCounts();
  const filteredResults = getFilteredResults();

  return (
    <Box sx={{ mt: 2 }}>
      {/* Search Filter */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search SLOs by dashboard or metric name..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: searchText && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearchText('')}
                  edge="end"
                >
                  <Clear fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={(thm) => ({
            '& .MuiOutlinedInput-root': {
              backgroundColor: 'background.paper',
              '&:hover': {
                backgroundColor: alpha(thm.palette.primary.main, 0.02),
              },
              '&.Mui-focused': {
                backgroundColor: alpha(thm.palette.primary.main, 0.04),
              }
            }
          })}
        />
      </Box>

      {/* SLO Filter */}
      <Box sx={{ mb: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ mr: 2 }}>
          Show:
        </Typography>
        <Chip
          label={`All (${filterCounts.all})`}
          clickable
          onClick={() => {
            setSloFilter('all');
            setIsFilterManuallySet(true);
          }}
          sx={(thm) => ({
            height: '32px',
            fontWeight: 600,
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
            background: `linear-gradient(135deg, ${alpha(thm.palette.primary.main, 0.08)} 0%, ${alpha(thm.palette.primary.main, 0.12)} 100%)`,
            border: `1px solid ${alpha(thm.palette.primary.main, 0.3)}`,
            color: 'primary.dark',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 12px ${alpha(thm.palette.primary.main, 0.2)}`,
              border: `1px solid ${alpha(thm.palette.primary.main, 0.5)}`,
            },
            '& .MuiChip-label': {
              px: 1.5,
              py: 0,
              fontSize: '0.75rem'
            }
          })}
        />
        <Chip
          label={`Failed only (${filterCounts.failed})`}
          clickable
          onClick={() => {
            setSloFilter('failed');
            setIsFilterManuallySet(true);
          }}
          sx={(thm) => ({
            height: '32px',
            fontWeight: 600,
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
            background: `linear-gradient(135deg, ${alpha(thm.palette.error.main, 0.08)} 0%, ${alpha(thm.palette.error.main, 0.12)} 100%)`,
            border: `1px solid ${alpha(thm.palette.error.main, 0.3)}`,
            color: 'error.dark',
            '&:hover': {
              transform: 'translateY(-1px)',
              boxShadow: `0 4px 12px ${alpha(thm.palette.error.main, 0.2)}`,
              border: `1px solid ${alpha(thm.palette.error.main, 0.5)}`,
            },
            '& .MuiChip-label': {
              px: 1.5,
              py: 0,
              fontSize: '0.75rem'
            }
          })}
        />
      </Box>

      {/* Table Header */}
      <Box sx={(thm) => ({
        display: 'grid',
        gridTemplateColumns: '40px 2fr 1.5fr 2fr 1fr 40px',
        gap: 2,
        p: 2,
        backgroundColor: thm.palette.mode === 'dark'
          ? alpha(thm.palette.common.white, 0.04)
          : 'action.hover',
        borderRadius: '4px 4px 0 0',
        border: '1px solid',
        borderColor: 'divider',
        borderBottom: 'none'
      })}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}></Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Dashboard</Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Metric Name</Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Requirement</Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}></Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}></Typography>
      </Box>

      {/* Table Rows */}
      {filteredResults.map((result) => {
        const resultKey = getCheckResultKey(result);
        return (
          <React.Fragment key={resultKey}>
            <Box
              onClick={() => toggleSloRow(resultKey)}
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 2fr 1.5fr 2fr 1fr 40px',
                gap: 2,
                p: 2,
                mt: 0.75,
                border: '1px solid',
                borderColor: alpha(theme.palette.divider, 0.6),
                borderRadius: '4px',
                backgroundColor: 'background.paper',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  backgroundColor: theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.06)
                    : alpha(theme.palette.primary.main, 0.04),
                  transform: 'translateY(-1px)',
                  boxShadow: `0 2px 8px ${alpha(theme.palette.text.primary, 0.08)}`,
                  borderColor: alpha(theme.palette.divider, 0.8)
                }
              }}
            >
              {/* Expand Button */}
              <Box display="flex" alignItems="center" justifyContent="center">
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSloRow(resultKey);
                  }}
                  size="small"
                  sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                >
                  {expandedSloRows.has(resultKey) ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
              </Box>

              {/* Dashboard Information */}
              <Box>
                {isApdexResult(result) ? (
                  <>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      Apdex SLO
                    </Typography>
                    {result.panel_title && result.panel_title !== 'Workload Apdex' && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Transaction: {result.panel_title}
                      </Typography>
                    )}
                  </>
                ) : (
                  <>
                    {result.dashboard_label && (
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {result.dashboard_label}
                      </Typography>
                    )}
                  </>
                )}

                {/* Source and Tags */}
                {((result.tags && result.tags.length > 0) || result.source) && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                    {(() => {
                      const benchmark = benchmarks.find(b => b.id === result.benchmark_id);
                      const source = benchmark?.source || result.source;
                      if (!source) return null;
                      const isGrafana = source === 'grafana';
                      const sourceLabel = source === 'custom' ? 'performance-metrics' : source;
                      return (
                        <Chip
                          label={sourceLabel}
                          sx={(thm) => ({
                            height: '20px',
                            fontWeight: 600,
                            backdropFilter: 'blur(8px)',
                            transition: 'all 0.2s ease',
                            background: isGrafana
                              ? `linear-gradient(135deg, ${alpha(thm.palette.primary.main, 0.08)} 0%, ${alpha(thm.palette.primary.main, 0.12)} 100%)`
                              : `linear-gradient(135deg, ${alpha(thm.palette.secondary.main, 0.08)} 0%, ${alpha(thm.palette.secondary.main, 0.12)} 100%)`,
                            border: isGrafana
                              ? `1px solid ${alpha(thm.palette.primary.main, 0.3)}`
                              : `1px solid ${alpha(thm.palette.secondary.main, 0.3)}`,
                            color: isGrafana ? 'primary.dark' : 'secondary.main',
                            '&:hover': {
                              transform: 'translateY(-1px)',
                              boxShadow: isGrafana
                                ? `0 4px 12px ${alpha(thm.palette.primary.main, 0.2)}`
                                : `0 4px 12px ${alpha(thm.palette.secondary.main, 0.2)}`,
                              border: isGrafana
                                ? `1px solid ${alpha(thm.palette.primary.main, 0.5)}`
                                : `1px solid ${alpha(thm.palette.secondary.main, 0.5)}`,
                            },
                            '& .MuiChip-label': {
                              px: 0.75,
                              py: 0,
                              fontSize: '0.65rem'
                            }
                          })}
                        />
                      );
                    })()}
                    {result.tags && result.tags.length > 0 && result.tags.map((tag: string, tagIndex: number) => (
                      <Chip
                        key={tagIndex}
                        label={tag}
                        sx={(thm) => ({
                          height: '20px',
                          fontWeight: 600,
                          backdropFilter: 'blur(8px)',
                          transition: 'all 0.2s ease',
                          background: `linear-gradient(135deg, ${alpha(thm.palette.primary.main, 0.08)} 0%, ${alpha(thm.palette.primary.main, 0.12)} 100%)`,
                          border: `1px solid ${alpha(thm.palette.primary.main, 0.3)}`,
                          color: 'primary.dark',
                          '&:hover': {
                            transform: 'translateY(-1px)',
                            boxShadow: `0 4px 12px ${alpha(thm.palette.primary.main, 0.2)}`,
                            border: `1px solid ${alpha(thm.palette.primary.main, 0.5)}`,
                          },
                          '& .MuiChip-label': {
                            px: 0.75,
                            py: 0,
                            fontSize: '0.6rem'
                          }
                        })}
                      />
                    ))}
                  </Box>
                )}
              </Box>

              {/* Metric Name / Apdex Score */}
              <Box>
                {isApdexResult(result) ? (
                  <Typography variant="body2" color="text.secondary">
                    Apdex Score
                  </Typography>
                ) : result.evaluate_type === 'aggregated' ? (
                  <Typography variant="body2" color="text.secondary">
                    {formatAggregatedMetricLabel(result.requirement)}
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      {result.panel_title || '-'}
                    </Typography>
                    {result.match_pattern && (
                      <Typography variant="caption" color="text.secondary" sx={{
                        display: 'block',
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        mt: 0.5
                      }}>
                        For series matching pattern: {result.match_pattern}
                      </Typography>
                    )}
                  </>
                )}
              </Box>

              {/* Human Readable Requirement */}
              <Typography variant="body2">
                {isApdexResult(result)
                  ? formatApdexRequirement(result.requirement)
                  : formatRequirement(result.requirement, result.evaluate_type, result.metric_unit)}
              </Typography>

              {/* Status Chip */}
              <Box display="flex" alignItems="center" justifyContent="center">
                <SLOStatusChip
                  result={result}
                  benchmark={benchmarks.find(b => b.id === result.benchmark_id)}
                  onReEvaluate={handleReEvaluate}
                />
              </Box>

              {/* Edit SLO Cogs Icon */}
              <Box display="flex" alignItems="center" justifyContent="center">
                <Tooltip title={isApdexResult(result) ? "Configure Apdex Thresholds" : "Edit SLO Configuration"} arrow>
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isApdexResult(result)) {
                        handleOpenApdexThresholdsDialog(result, e);
                      } else {
                        handleEditSlo(result);
                      }
                    }}
                    size="small"
                    sx={{
                      '&:hover': {
                        backgroundColor: 'action.hover',
                        color: 'primary.main'
                      }
                    }}
                  >
                    <Settings fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Expanded Content */}
            <Collapse in={expandedSloRows.has(resultKey)}>
              <Box sx={(thm) => ({
                mt: 0.75,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '4px',
                backgroundColor: thm.palette.mode === 'dark'
                  ? alpha(thm.palette.common.white, 0.03)
                  : 'action.hover',
                p: 3
              })}>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                  Details
                </Typography>

                {/* Apdex-specific Details */}
                {isApdexResult(result) ? (
                  <ApdexScenarioTable
                    result={result}
                    resultKey={resultKey}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    expandedTransactions={expandedTransactions}
                    onToggleTransaction={toggleTransactionExpanded}
                    transactionSamples={transactionSamples}
                    loadingTransactionSamples={loadingTransactionSamples}
                    transactionSamplesError={transactionSamplesError}
                    onOpenApdexActionMenu={handleOpenApdexActionMenu}
                    onOpenRequestActionMenu={handleOpenRequestActionMenu}
                    hasDistributedTracing={hasDistributedTracing}
                    hasDynatrace={hasDynatrace}
                  />
                ) : result.evaluate_type !== 'aggregated' ? (
                  /* Metrics Chart - Full width container */
                  <Box sx={{ width: 'calc(100% + 48px)', mx: -3 }}>
                    <SLOMetricsChart
                      testRunId={testRunId}
                      checkResult={result}
                      testRun={testRun ?? undefined}
                      targetName={selectedTarget.get(resultKey)}
                      isVisible={expandedSloRows.has(resultKey)}
                    />
                  </Box>
                ) : (
                  /* Aggregated SLO Chart */
                  <Box sx={{ width: 'calc(100% + 48px)', mx: -3 }}>
                    <AggregatedSloChart
                      testRunId={testRunId}
                      checkResult={result}
                      testRun={testRun ?? undefined}
                      isVisible={expandedSloRows.has(resultKey)}
                    />
                  </Box>
                )}

                {/* Target Values Table (only for non-Apdex results) */}
                {!isApdexResult(result) && (
                  <MetricSeriesTable
                    result={result}
                    resultKey={resultKey}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    selectedTarget={selectedTarget}
                    onSelectTarget={(key, targetName) => {
                      if (targetName === undefined) {
                        setSelectedTarget(prev => {
                          const newMap = new Map(prev);
                          newMap.delete(key);
                          return newMap;
                        });
                      } else {
                        setSelectedTarget(prev => {
                          const newMap = new Map(prev);
                          newMap.set(key, targetName);
                          return newMap;
                        });
                      }
                    }}
                    benchmarks={benchmarks}
                  />
                )}
              </Box>
            </Collapse>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
