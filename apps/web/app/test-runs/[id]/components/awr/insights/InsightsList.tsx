'use client';

/**
 * Insights List Component
 *
 * Displays a list of AWR analysis insights with filtering, grouping,
 * and sorting capabilities.
 *
 * Features:
 * - Filter by severity levels (critical, warning, info)
 * - Filter by categories (SQL, wait events, etc.)
 * - Group by severity or category
 * - Search text filtering
 * - Loading and empty states
 * - Collapsible group sections
 *
 * @example
 * ```tsx
 * <InsightsList
 *   insights={analysisInsights}
 *   groupBySeverity
 *   onSqlClick={(sqlId) => navigateToSql(sqlId)}
 *   filters={{ severities: ['critical', 'warning'] }}
 *   onFiltersChange={setFilters}
 * />
 * ```
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Checkbox,
  ListItemText,
  OutlinedInput,
  Skeleton,
  Collapse,
  IconButton,
  Badge,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { InsightCard } from './InsightCard';
import { SeverityBadge } from './SeverityBadge';
import type {
  InsightsListProps,
  InsightFilters,
  InsightSeverity,
  InsightCategory,
  AwrInsight,
} from '../types';
import {
  applyInsightFilters,
  groupBySeverity,
  groupByCategory,
  getSeverityLabel,
  getCategoryLabel,
  getSeverityColor,
  getCategoryColor,
  calculateSeveritySummary,
} from '../utils/severity-helpers';

// ==================== Constants ====================

const ALL_SEVERITIES: InsightSeverity[] = ['critical', 'warning', 'info'];

const ALL_CATEGORIES: InsightCategory[] = [
  'sql_performance',
  'wait_events',
  'resource_utilization',
  'io_performance',
  'memory',
  'lock_contention',
  'parse_overhead',
  'network',
  'configuration',
  'regression',
  'improvement',
];

// ==================== Sub-Components ====================

/**
 * Group header component
 */
interface GroupHeaderProps {
  title: string;
  count: number;
  color: string;
  expanded: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
}

function GroupHeader({
  title,
  count,
  color,
  expanded,
  onToggle,
  icon,
}: GroupHeaderProps): JSX.Element {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 1,
        px: 1.5,
        cursor: 'pointer',
        borderRadius: 1,
        backgroundColor: alpha(color, 0.08),
        borderLeft: `4px solid ${color}`,
        mb: 1,
        '&:hover': {
          backgroundColor: alpha(color, 0.12),
        },
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${title} group with ${count} items`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {icon}
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 600,
          color,
          flexGrow: 1,
        }}
      >
        {title}
      </Typography>
      <Badge
        badgeContent={count}
        color="default"
        sx={{
          '& .MuiBadge-badge': {
            backgroundColor: alpha(color, 0.2),
            color,
            fontWeight: 600,
          },
        }}
      />
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={expanded ? 'Collapse group' : 'Expand group'}
        sx={{ color }}
      >
        {expanded ? <CollapseIcon /> : <ExpandIcon />}
      </IconButton>
    </Box>
  );
}

/**
 * Loading skeleton
 */
function InsightsListSkeleton(): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[1, 2, 3].map((i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5 }}>
          <Skeleton variant="rounded" width={60} height={24} />
          <Box sx={{ flexGrow: 1 }}>
            <Skeleton variant="text" width="60%" height={24} />
            <Skeleton variant="text" width="90%" height={20} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Empty state
 */
interface EmptyStateProps {
  message: string;
  hasFilters: boolean;
  onClearFilters?: () => void;
}

function EmptyState({ message, hasFilters, onClearFilters }: EmptyStateProps): JSX.Element {
  return (
    <Box
      sx={{
        py: 4,
        px: 2,
        textAlign: 'center',
        backgroundColor: alpha('#9e9e9e', 0.04),
        borderRadius: 1,
        border: `1px dashed ${alpha('#9e9e9e', 0.3)}`,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
      {hasFilters && onClearFilters && (
        <Box
          component="button"
          onClick={onClearFilters}
          sx={{
            mt: 1.5,
            px: 2,
            py: 0.5,
            cursor: 'pointer',
            backgroundColor: 'transparent',
            border: `1px solid ${alpha('#1976d2', 0.5)}`,
            borderRadius: 1,
            color: '#1976d2',
            fontSize: '0.875rem',
            '&:hover': {
              backgroundColor: alpha('#1976d2', 0.08),
            },
          }}
        >
          Clear filters
        </Box>
      )}
    </Box>
  );
}

// ==================== Main Component ====================

/**
 * Insights List Component
 *
 * Displays a filterable, groupable list of AWR analysis insights.
 */
export function InsightsList({
  insights,
  groupByCategory: shouldGroupByCategory = false,
  groupBySeverity: shouldGroupBySeverity = false,
  filters: externalFilters,
  onFiltersChange,
  onSqlClick,
  emptyMessage = 'No insights found',
  loading = false,
}: InsightsListProps): JSX.Element {
  // Internal filter state for uncontrolled mode
  const [internalFilters, setInternalFilters] = useState<InsightFilters>({});

  // Group expansion state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['critical', 'warning']));

  // Determine filters (controlled vs uncontrolled)
  const filters = externalFilters ?? internalFilters;
  const setFilters = onFiltersChange ?? setInternalFilters;

  // Filter insights
  const filteredInsights = useMemo(() => {
    return applyInsightFilters(insights, {
      severities: filters.severities,
      categories: filters.categories,
      minImpactScore: filters.minImpactScore,
      searchText: filters.searchText,
      sortBy: 'severity',
    });
  }, [insights, filters]);

  // Group insights if needed
  const groupedInsights = useMemo(() => {
    if (shouldGroupBySeverity) {
      return groupBySeverity(filteredInsights);
    }
    if (shouldGroupByCategory) {
      return groupByCategory(filteredInsights);
    }
    return null;
  }, [filteredInsights, shouldGroupBySeverity, shouldGroupByCategory]);

  // Calculate summary
  const summary = useMemo(() => calculateSeveritySummary(insights), [insights]);

  // Check if any filters are applied
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      (filters.severities && filters.severities.length > 0) ||
        (filters.categories && filters.categories.length > 0) ||
        filters.searchText ||
        filters.minImpactScore,
    );
  }, [filters]);

  /**
   * Handle search text change
   */
  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      setFilters({ ...filters, searchText: event.target.value });
    },
    [filters, setFilters],
  );

  /**
   * Handle severity filter change
   */
  const handleSeverityChange = useCallback(
    (event: { target: { value: unknown } }): void => {
      const value = event.target.value as InsightSeverity[];
      setFilters({ ...filters, severities: value.length > 0 ? value : undefined });
    },
    [filters, setFilters],
  );

  /**
   * Handle category filter change
   */
  const handleCategoryChange = useCallback(
    (event: { target: { value: unknown } }): void => {
      const value = event.target.value as InsightCategory[];
      setFilters({ ...filters, categories: value.length > 0 ? value : undefined });
    },
    [filters, setFilters],
  );

  /**
   * Clear all filters
   */
  const handleClearFilters = useCallback((): void => {
    setFilters({});
  }, [setFilters]);

  /**
   * Toggle group expansion
   */
  const toggleGroup = useCallback((groupId: string): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  /**
   * Render insight card
   */
  const renderInsight = (insight: AwrInsight): JSX.Element => (
    <InsightCard
      key={insight.id}
      insight={insight}
      onSqlClick={onSqlClick}
      showSqlLink={Boolean(onSqlClick)}
    />
  );

  // Loading state
  if (loading) {
    return <InsightsListSkeleton />;
  }

  return (
    <Box>
      {/* Filters Section */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 2,
          alignItems: 'flex-end',
        }}
      >
        {/* Search */}
        <TextField
          size="small"
          placeholder="Search insights..."
          value={filters.searchText || ''}
          onChange={handleSearchChange}
          sx={{ minWidth: 200, flexGrow: 1, maxWidth: 300 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
            endAdornment: filters.searchText && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setFilters({ ...filters, searchText: undefined })}
                  aria-label="Clear search"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          aria-label="Search insights"
        />

        {/* Severity Filter */}
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="severity-filter-label">Severity</InputLabel>
          <Select
            labelId="severity-filter-label"
            multiple
            value={filters.severities || []}
            onChange={handleSeverityChange}
            input={<OutlinedInput label="Severity" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(selected as InsightSeverity[]).map((severity) => (
                  <Chip
                    key={severity}
                    label={getSeverityLabel(severity)}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      backgroundColor: alpha(getSeverityColor(severity), 0.15),
                      color: getSeverityColor(severity),
                    }}
                  />
                ))}
              </Box>
            )}
            aria-label="Filter by severity"
          >
            {ALL_SEVERITIES.map((severity) => (
              <MenuItem key={severity} value={severity}>
                <Checkbox checked={(filters.severities || []).includes(severity)} size="small" />
                <ListItemText
                  primary={getSeverityLabel(severity)}
                  primaryTypographyProps={{
                    sx: { color: getSeverityColor(severity), fontWeight: 500 },
                  }}
                />
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Category Filter */}
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="category-filter-label">Category</InputLabel>
          <Select
            labelId="category-filter-label"
            multiple
            value={filters.categories || []}
            onChange={handleCategoryChange}
            input={<OutlinedInput label="Category" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(selected as InsightCategory[]).slice(0, 2).map((category) => (
                  <Chip
                    key={category}
                    label={getCategoryLabel(category)}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.65rem',
                      maxWidth: 80,
                      backgroundColor: alpha(getCategoryColor(category), 0.15),
                      color: getCategoryColor(category),
                    }}
                  />
                ))}
                {(selected as InsightCategory[]).length > 2 && (
                  <Chip
                    label={`+${(selected as InsightCategory[]).length - 2}`}
                    size="small"
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                )}
              </Box>
            )}
            aria-label="Filter by category"
          >
            {ALL_CATEGORIES.map((category) => (
              <MenuItem key={category} value={category}>
                <Checkbox checked={(filters.categories || []).includes(category)} size="small" />
                <ListItemText
                  primary={getCategoryLabel(category)}
                  primaryTypographyProps={{
                    sx: { color: getCategoryColor(category), fontWeight: 500, fontSize: '0.875rem' },
                  }}
                />
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <IconButton
            size="small"
            onClick={handleClearFilters}
            aria-label="Clear all filters"
            sx={{ color: 'text.secondary' }}
          >
            <FilterIcon />
            <ClearIcon
              sx={{
                fontSize: 12,
                position: 'absolute',
                right: 4,
                top: 4,
                backgroundColor: 'background.paper',
                borderRadius: '50%',
              }}
            />
          </IconButton>
        )}
      </Box>

      {/* Summary */}
      {insights.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            mb: 2,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {filteredInsights.length} of {insights.length} insights
          </Typography>
          {summary.critical > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SeverityBadge severity="critical" showLabel={false} size="small" />
              <Typography variant="caption" sx={{ color: '#d32f2f', fontWeight: 500 }}>
                {summary.critical}
              </Typography>
            </Box>
          )}
          {summary.warning > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SeverityBadge severity="warning" showLabel={false} size="small" />
              <Typography variant="caption" sx={{ color: '#ed6c02', fontWeight: 500 }}>
                {summary.warning}
              </Typography>
            </Box>
          )}
          {summary.info > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SeverityBadge severity="info" showLabel={false} size="small" />
              <Typography variant="caption" sx={{ color: '#0288d1', fontWeight: 500 }}>
                {summary.info}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Empty state */}
      {filteredInsights.length === 0 && (
        <EmptyState
          message={hasActiveFilters ? 'No insights match your filters' : emptyMessage}
          hasFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
        />
      )}

      {/* Insights List - Grouped by Severity */}
      {filteredInsights.length > 0 && shouldGroupBySeverity && groupedInsights && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Array.from(groupedInsights as Map<InsightSeverity, AwrInsight[]>).map(
            ([severity, groupInsights]) => {
              if (groupInsights.length === 0) return null;
              const isExpanded = expandedGroups.has(severity);
              return (
                <Box key={severity}>
                  <GroupHeader
                    title={getSeverityLabel(severity)}
                    count={groupInsights.length}
                    color={getSeverityColor(severity)}
                    expanded={isExpanded}
                    onToggle={() => toggleGroup(severity)}
                    icon={<SeverityBadge severity={severity} showLabel={false} size="small" />}
                  />
                  <Collapse in={isExpanded}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                      {groupInsights.map(renderInsight)}
                    </Box>
                  </Collapse>
                </Box>
              );
            },
          )}
        </Box>
      )}

      {/* Insights List - Grouped by Category */}
      {filteredInsights.length > 0 && shouldGroupByCategory && groupedInsights && !shouldGroupBySeverity && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Array.from(groupedInsights as Map<InsightCategory, AwrInsight[]>).map(
            ([category, groupInsights]) => {
              if (groupInsights.length === 0) return null;
              const isExpanded = expandedGroups.has(category);
              return (
                <Box key={category}>
                  <GroupHeader
                    title={getCategoryLabel(category)}
                    count={groupInsights.length}
                    color={getCategoryColor(category)}
                    expanded={isExpanded}
                    onToggle={() => toggleGroup(category)}
                  />
                  <Collapse in={isExpanded}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
                      {groupInsights.map(renderInsight)}
                    </Box>
                  </Collapse>
                </Box>
              );
            },
          )}
        </Box>
      )}

      {/* Insights List - Flat (no grouping) */}
      {filteredInsights.length > 0 && !shouldGroupBySeverity && !shouldGroupByCategory && (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          role="list"
          aria-label="Insights list"
        >
          {filteredInsights.map(renderInsight)}
        </Box>
      )}
    </Box>
  );
}

// Default export
export default InsightsList;
