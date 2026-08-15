'use client';

/**
 * WaitEventsTab Component
 *
 * Displays wait events from an AWR report with charts, grouping by wait class,
 * and detailed metrics table.
 *
 * @example
 * ```tsx
 * <WaitEventsTab
 *   reportId="report-uuid"
 *   _testRunId="test-run-uuid"
 *   groupByClass={true}
 *   _onSnackbar={(msg, sev) => showSnackbar(msg, sev)}
 * />
 * ```
 */

import React, { useState, useMemo, useCallback } from 'react';
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
  TableSortLabel,
  TextField,
  InputAdornment,
  FormControlLabel,
  Switch,
  Chip,
  Collapse,
  IconButton,
  Skeleton,
  useTheme,
  alpha,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { getAwrReport } from '@/lib/api/awr-reports';
import type {
  WaitEventsTabProps,
  WaitEventDisplay,
  WaitEventSortField,
  SortDirection,
  WaitEventChartData,
} from '../types';
import { WaitEventsChart } from '../charts';
import { formatNumber, formatDuration, formatPercentage } from '../utils';
import { WAIT_CLASS_COLORS } from '../types';

// ==================== Constants ====================

const DEFAULT_SORT_FIELD: WaitEventSortField = 'totalWaitTime';

// ==================== Helper Functions ====================

/**
 * Extract wait events from AWR report parsed data
 */
function extractWaitEvents(report: {
  parsedData?: {
    waitEvents?: {
      foreground?: Array<{
        event: string;
        waitClass?: string;
        waits?: number;
        totalWaitTime?: number;
        avgWaitMs?: number;
        percentDbTime?: number;
        percentWaitTime?: number;
        timeouts?: number;
      }>;
      background?: Array<{
        event: string;
        waitClass?: string;
        waits?: number;
        totalWaitTime?: number;
        avgWaitMs?: number;
        percentDbTime?: number;
        percentWaitTime?: number;
        timeouts?: number;
      }>;
      byClass?: Record<string, {
        totalWaitTime?: number;
        waits?: number;
        events?: number;
      }>;
    };
  };
}): { foreground: WaitEventDisplay[]; background: WaitEventDisplay[] } {
  const waitEvents = report.parsedData?.waitEvents;

  if (!waitEvents) {
    return { foreground: [], background: [] };
  }

  const mapEvent = (event: {
    event: string;
    waitClass?: string;
    waits?: number;
    totalWaitTime?: number;
    avgWaitMs?: number;
    percentDbTime?: number;
    percentWaitTime?: number;
    timeouts?: number;
  }): WaitEventDisplay => ({
    event: event.event,
    waitClass: event.waitClass ?? 'Other',
    waits: event.waits ?? 0,
    totalWaitTime: event.totalWaitTime ?? 0,
    avgWaitMs: event.avgWaitMs,
    percentDbTime: event.percentDbTime,
    percentWaitTime: event.percentWaitTime,
    timeouts: event.timeouts,
  });

  return {
    foreground: (waitEvents.foreground ?? []).map(mapEvent),
    background: (waitEvents.background ?? []).map(mapEvent),
  };
}

/**
 * Transform wait events to chart data format
 */
function transformToChartData(events: WaitEventDisplay[]): WaitEventChartData[] {
  const totalWaitTime = events.reduce((sum, e) => sum + e.totalWaitTime, 0);

  return events
    .filter((e) => e.totalWaitTime > 0)
    .map((e) => ({
      event: e.event,
      waitClass: e.waitClass ?? 'Other',
      waitTime: e.totalWaitTime,
      percent: totalWaitTime > 0 ? (e.totalWaitTime / totalWaitTime) * 100 : 0,
      color: WAIT_CLASS_COLORS[e.waitClass ?? 'Other'] ?? WAIT_CLASS_COLORS.Other,
    }))
    .sort((a, b) => b.waitTime - a.waitTime)
    .slice(0, 15);
}

/**
 * Group events by wait class
 */
function groupByWaitClass(
  events: WaitEventDisplay[]
): Map<string, WaitEventDisplay[]> {
  const groups = new Map<string, WaitEventDisplay[]>();

  for (const event of events) {
    const waitClass = event.waitClass ?? 'Other';
    const existing = groups.get(waitClass) ?? [];
    existing.push(event);
    groups.set(waitClass, existing);
  }

  // Sort groups by total wait time
  return new Map(
    Array.from(groups.entries()).sort(([, a], [, b]) => {
      const totalA = a.reduce((sum, e) => sum + e.totalWaitTime, 0);
      const totalB = b.reduce((sum, e) => sum + e.totalWaitTime, 0);
      return totalB - totalA;
    })
  );
}

/**
 * Sort wait events
 */
function sortEvents(
  events: WaitEventDisplay[],
  sortBy: WaitEventSortField,
  direction: SortDirection
): WaitEventDisplay[] {
  return [...events].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortBy) {
      case 'totalWaitTime':
        aVal = a.totalWaitTime;
        bVal = b.totalWaitTime;
        break;
      case 'waits':
        aVal = a.waits;
        bVal = b.waits;
        break;
      case 'avgWaitMs':
        aVal = a.avgWaitMs ?? 0;
        bVal = b.avgWaitMs ?? 0;
        break;
      case 'percentDbTime':
        aVal = a.percentDbTime ?? 0;
        bVal = b.percentDbTime ?? 0;
        break;
      case 'event':
        aVal = a.event.toLowerCase();
        bVal = b.event.toLowerCase();
        break;
      default:
        aVal = a.totalWaitTime;
        bVal = b.totalWaitTime;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'desc'
        ? bVal.localeCompare(aVal)
        : aVal.localeCompare(bVal);
    }

    return direction === 'desc'
      ? (bVal as number) - (aVal as number)
      : (aVal as number) - (bVal as number);
  });
}

/**
 * Filter wait events by search text
 */
function filterEvents(
  events: WaitEventDisplay[],
  searchText: string
): WaitEventDisplay[] {
  if (!searchText.trim()) return events;

  const search = searchText.toLowerCase().trim();
  return events.filter(
    (e) =>
      e.event.toLowerCase().includes(search) ||
      e.waitClass?.toLowerCase().includes(search)
  );
}

// ==================== Sub-Components ====================

function LoadingState() {
  return (
    <Box sx={{ p: 2 }}>
      <Skeleton variant="rectangular" height={250} sx={{ mb: 2, borderRadius: 1 }} />
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
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
        Failed to load wait events
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
        No wait events found
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 500 }}>
        Wait events data was not found in this AWR report. The report may need to be re-parsed
        with the updated parser to include wait events information.
      </Typography>
    </Box>
  );
}

interface WaitClassGroupProps {
  waitClass: string;
  events: WaitEventDisplay[];
  expanded: boolean;
  onToggle: () => void;
  sortBy: WaitEventSortField;
  sortDirection: SortDirection;
  onSortChange: (field: WaitEventSortField) => void;
}

function WaitClassGroup({
  waitClass,
  events,
  expanded,
  onToggle,
  sortBy,
  sortDirection,
  onSortChange,
}: WaitClassGroupProps) {
  const theme = useTheme();
  const totalWaitTime = events.reduce((sum, e) => sum + e.totalWaitTime, 0);
  const totalWaits = events.reduce((sum, e) => sum + e.waits, 0);
  const sortedEvents = useMemo(
    () => sortEvents(events, sortBy, sortDirection),
    [events, sortBy, sortDirection]
  );

  const waitClassColor = WAIT_CLASS_COLORS[waitClass] ?? WAIT_CLASS_COLORS.Other;

  return (
    <Paper
      elevation={0}
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 2,
        overflow: 'hidden',
        mb: 2,
      }}
    >
      {/* Group Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          cursor: 'pointer',
          backgroundColor: alpha(waitClassColor, 0.08),
          '&:hover': {
            backgroundColor: alpha(waitClassColor, 0.12),
          },
        }}
        onClick={onToggle}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: waitClassColor,
            }}
          />
          <Typography variant="subtitle1" fontWeight={600}>
            {waitClass}
          </Typography>
          <Chip
            label={`${events.length} events`}
            size="small"
            variant="outlined"
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>{formatDuration(totalWaitTime)}</strong> total wait
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>{formatNumber(totalWaits, 0)}</strong> waits
          </Typography>
          <IconButton size="small">
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
      </Box>

      {/* Group Content */}
      <Collapse in={expanded}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Event</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'waits'}
                    direction={sortBy === 'waits' ? sortDirection : 'desc'}
                    onClick={() => onSortChange('waits')}
                  >
                    Waits
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'totalWaitTime'}
                    direction={sortBy === 'totalWaitTime' ? sortDirection : 'desc'}
                    onClick={() => onSortChange('totalWaitTime')}
                  >
                    Wait Time
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'avgWaitMs'}
                    direction={sortBy === 'avgWaitMs' ? sortDirection : 'desc'}
                    onClick={() => onSortChange('avgWaitMs')}
                  >
                    Avg Wait (ms)
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'percentDbTime'}
                    direction={sortBy === 'percentDbTime' ? sortDirection : 'desc'}
                    onClick={() => onSortChange('percentDbTime')}
                  >
                    % DB Time
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  Timeouts
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedEvents.map((event) => (
                <TableRow key={event.event} hover>
                  <TableCell>
                    <Tooltip title={event.event} placement="top-start">
                      <Typography
                        variant="body2"
                        sx={{
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {event.event}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {formatNumber(event.waits, 0)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {formatDuration(event.totalWaitTime)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {event.avgWaitMs !== undefined ? formatNumber(event.avgWaitMs, 2) : 'N/A'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontFamily: 'monospace',
                      color:
                        (event.percentDbTime ?? 0) > 10
                          ? theme.palette.error.main
                          : (event.percentDbTime ?? 0) > 5
                            ? theme.palette.warning.main
                            : undefined,
                    }}
                  >
                    {event.percentDbTime !== undefined
                      ? formatPercentage(event.percentDbTime)
                      : 'N/A'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {event.timeouts ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Paper>
  );
}

// ==================== Main Component ====================

/**
 * WaitEventsTab - Displays wait events from AWR report
 * with chart visualization and grouped/flat table views.
 */
export function WaitEventsTab({
  reportId,
  groupByClass: initialGroupByClass = true,
  showBackgroundEvents: initialShowBackground = false,
}: WaitEventsTabProps) {
  const theme = useTheme();

  // State
  const [sortBy, setSortBy] = useState<WaitEventSortField>(DEFAULT_SORT_FIELD);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchText, setSearchText] = useState('');
  const [groupByClass, setGroupByClass] = useState(initialGroupByClass);
  const [showBackground, setShowBackground] = useState(initialShowBackground);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());

  // Fetch report data
  const { data: report, isLoading, error } = useQuery({
    queryKey: ['awr-report', reportId],
    queryFn: () => getAwrReport(reportId),
    enabled: !!reportId,
    staleTime: 60000,
  });

  // Extract and process wait events
  const { allEvents, chartData, groupedEvents, displayEvents } = useMemo(() => {
    if (!report) {
      return {
        allEvents: [],
        chartData: [],
        groupedEvents: new Map<string, WaitEventDisplay[]>(),
        displayEvents: [],
      };
    }

    const { foreground, background } = extractWaitEvents(report as Parameters<typeof extractWaitEvents>[0]);
    const all = showBackground ? [...foreground, ...background] : foreground;
    const filtered = filterEvents(all, searchText);
    const sorted = sortEvents(filtered, sortBy, sortDirection);
    const grouped = groupByWaitClass(sorted);
    const chart = transformToChartData(foreground); // Always use foreground for chart

    return {
      allEvents: all,
      chartData: chart,
      groupedEvents: grouped,
      displayEvents: sorted,
    };
  }, [report, showBackground, searchText, sortBy, sortDirection]);

  // Handlers
  const handleSortChange = useCallback((field: WaitEventSortField) => {
    if (field === sortBy) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  }, [sortBy]);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchText(event.target.value);
    },
    []
  );

  const handleGroupByClassChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setGroupByClass(event.target.checked);
    },
    []
  );

  const handleShowBackgroundChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setShowBackground(event.target.checked);
    },
    []
  );

  const toggleClassExpanded = useCallback((waitClass: string) => {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(waitClass)) {
        next.delete(waitClass);
      } else {
        next.add(waitClass);
      }
      return next;
    });
  }, []);

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
  if (allEvents.length === 0) {
    return <EmptyState />;
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Chart Section */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Wait Events Distribution
        </Typography>
        <WaitEventsChart
          data={chartData}
          height={250}
          chartType="bar"
          showPercentages
          maxEvents={10}
        />
      </Paper>

      {/* Toolbar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <TextField
            placeholder="Search events..."
            value={searchText}
            onChange={handleSearchChange}
            size="small"
            sx={{ flexGrow: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={groupByClass}
                onChange={handleGroupByClassChange}
                size="small"
              />
            }
            label="Group by class"
          />

          <FormControlLabel
            control={
              <Switch
                checked={showBackground}
                onChange={handleShowBackgroundChange}
                size="small"
              />
            }
            label="Show background"
          />

          <Typography variant="body2" color="text.secondary">
            {displayEvents.length} events
          </Typography>
        </Box>
      </Paper>

      {/* Content */}
      {displayEvents.length === 0 ? (
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
            No wait events match your search criteria
          </Typography>
        </Box>
      ) : groupByClass ? (
        // Grouped View
        <Box>
          {Array.from(groupedEvents.entries()).map(([waitClass, events]) => (
            <WaitClassGroup
              key={waitClass}
              waitClass={waitClass}
              events={events}
              expanded={expandedClasses.has(waitClass) || expandedClasses.size === 0}
              onToggle={() => toggleClassExpanded(waitClass)}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
            />
          ))}
        </Box>
      ) : (
        // Flat Table View
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'event'}
                    direction={sortBy === 'event' ? sortDirection : 'desc'}
                    onClick={() => handleSortChange('event')}
                  >
                    Event
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Wait Class</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'waits'}
                    direction={sortBy === 'waits' ? sortDirection : 'desc'}
                    onClick={() => handleSortChange('waits')}
                  >
                    Waits
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'totalWaitTime'}
                    direction={sortBy === 'totalWaitTime' ? sortDirection : 'desc'}
                    onClick={() => handleSortChange('totalWaitTime')}
                  >
                    Wait Time
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'avgWaitMs'}
                    direction={sortBy === 'avgWaitMs' ? sortDirection : 'desc'}
                    onClick={() => handleSortChange('avgWaitMs')}
                  >
                    Avg Wait (ms)
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  <TableSortLabel
                    active={sortBy === 'percentDbTime'}
                    direction={sortBy === 'percentDbTime' ? sortDirection : 'desc'}
                    onClick={() => handleSortChange('percentDbTime')}
                  >
                    % DB Time
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayEvents.map((event) => {
                const waitClassColor = WAIT_CLASS_COLORS[event.waitClass ?? 'Other'] ?? WAIT_CLASS_COLORS.Other;

                return (
                  <TableRow key={`${event.event}-${event.waitClass}`} hover>
                    <TableCell>
                      <Tooltip title={event.event} placement="top-start">
                        <Typography
                          variant="body2"
                          sx={{
                            maxWidth: 300,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {event.event}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            backgroundColor: waitClassColor,
                          }}
                        />
                        <Typography variant="body2">
                          {event.waitClass ?? 'Other'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {formatNumber(event.waits, 0)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {formatDuration(event.totalWaitTime)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {event.avgWaitMs !== undefined
                        ? formatNumber(event.avgWaitMs, 2)
                        : 'N/A'}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: 'monospace',
                        color:
                          (event.percentDbTime ?? 0) > 10
                            ? theme.palette.error.main
                            : (event.percentDbTime ?? 0) > 5
                              ? theme.palette.warning.main
                              : undefined,
                      }}
                    >
                      {event.percentDbTime !== undefined
                        ? formatPercentage(event.percentDbTime)
                        : 'N/A'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default WaitEventsTab;
