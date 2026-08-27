'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  IconButton,
  Chip,
  Checkbox,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Dashboard as DashboardIcon,
  Block as BlockIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { QueriesTableProps, DynatraceQueryLocal } from '../types';
import { RequiresPermission } from '@/components/auth/RequiresPermission';

type SortKey = 'instance' | 'dashboard' | 'panelTitle' | 'enabled';
const ALL = '__all__';

/** Sorted distinct values for one column, used to populate a filter dropdown. */
function distinct(queries: DynatraceQueryLocal[], pick: (q: DynatraceQueryLocal) => string): string[] {
  return Array.from(new Set(queries.map(pick))).sort((a, b) => a.localeCompare(b));
}

export function QueriesTable({
  queries,
  selectedQueryIds,
  onSelectAll,
  onSelectOne,
  onEditQuery,
  onDeleteQuery,
  onToggleEnabled,
}: QueriesTableProps) {
  const [instanceFilter, setInstanceFilter] = useState(ALL);
  const [dashboardFilter, setDashboardFilter] = useState(ALL);
  const [panelTitleFilter, setPanelTitleFilter] = useState(ALL);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const instanceOf = (q: DynatraceQueryLocal) => q.dynatraceConfigLabel || 'Unknown';

  const instances = useMemo(() => distinct(queries, instanceOf), [queries]);
  const dashboards = useMemo(() => distinct(queries, (q) => q.dashboardLabel), [queries]);
  const panelTitles = useMemo(() => distinct(queries, (q) => q.panelTitle), [queries]);

  const visible = useMemo(() => {
    const filtered = queries.filter(
      (q) =>
        (instanceFilter === ALL || instanceOf(q) === instanceFilter) &&
        (dashboardFilter === ALL || q.dashboardLabel === dashboardFilter) &&
        (panelTitleFilter === ALL || q.panelTitle === panelTitleFilter)
    );

    if (!sortKey) return filtered;
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'instance':
          return sign * instanceOf(a).localeCompare(instanceOf(b));
        case 'dashboard':
          return sign * a.dashboardLabel.localeCompare(b.dashboardLabel);
        case 'panelTitle':
          return sign * a.panelTitle.localeCompare(b.panelTitle);
        case 'enabled':
          return sign * (Number(a.enabled) - Number(b.enabled));
      }
    });
  }, [queries, instanceFilter, dashboardFilter, panelTitleFilter, sortKey, sortDir]);

  const visibleIds = visible.map((q) => q.id);
  const selectedVisible = visibleIds.filter((id) => selectedQueryIds.has(id)).length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const header = (key: SortKey, label: string) => (
    <TableSortLabel
      active={sortKey === key}
      direction={sortKey === key ? sortDir : 'asc'}
      onClick={() => handleSort(key)}
    >
      {label}
    </TableSortLabel>
  );

  // A dropdown over a single value filters nothing — only render the ones that do work.
  const filterSelect = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    options: string[]
  ) =>
    options.length > 1 ? (
      <TextField
        select
        size="small"
        label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value={ALL}>All</MenuItem>
        {options.map((o) => (
          <MenuItem key={o} value={o}>
            {o}
          </MenuItem>
        ))}
      </TextField>
    ) : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {filterSelect('Dynatrace Instance', instanceFilter, setInstanceFilter, instances)}
        {filterSelect('Host / Dashboard', dashboardFilter, setDashboardFilter, dashboards)}
        {filterSelect('Panel Title', panelTitleFilter, setPanelTitleFilter, panelTitles)}
      </Box>

      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedVisible > 0 && selectedVisible === visibleIds.length}
                  indeterminate={selectedVisible > 0 && selectedVisible < visibleIds.length}
                  onChange={() => onSelectAll(visibleIds)}
                  inputProps={{ 'aria-label': 'Select all queries' }}
                />
              </TableCell>
              <TableCell>{header('instance', 'Dynatrace Instance')}</TableCell>
              <TableCell>{header('dashboard', 'Dashboard')}</TableCell>
              <TableCell>{header('panelTitle', 'Panel Title')}</TableCell>
              <TableCell>Variables</TableCell>
              <TableCell>Variable Values</TableCell>
              <TableCell>{header('enabled', 'Status')}</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                    No queries match the current filters
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {visible.map((query) => (
              <TableRow
                key={query.id}
                hover
                selected={selectedQueryIds.has(query.id)}
                sx={query.enabled ? undefined : { opacity: 0.6 }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedQueryIds.has(query.id)}
                    onChange={() => onSelectOne(query.id)}
                    inputProps={{ 'aria-label': `Select query ${query.panelTitle}` }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={query.dynatraceConfigLabel || 'Unknown'}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DashboardIcon color="primary" fontSize="small" />
                    <Typography variant="body2" fontWeight="medium">
                      {query.dashboardLabel}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight="medium">
                    {query.panelTitle}
                  </Typography>
                  {query.matchMetricPattern && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Pattern: {query.matchMetricPattern}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {query.templateVariables && Object.keys(query.templateVariables).length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {Object.keys(query.templateVariables).map((key) => (
                        <Chip
                          key={key}
                          label={key}
                          sx={{
                            height: '24px',
                            fontWeight: 600,
                            backdropFilter: 'blur(8px)',
                            transition: 'all 0.2s ease',
                            background: (theme) => theme.palette.mode === 'dark'
                              ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                              : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                            border: (theme) => theme.palette.mode === 'dark'
                              ? '1px solid rgba(56, 142, 232, 0.5)'
                              : '1px solid rgba(25, 118, 210, 0.3)',
                            color: 'primary.main',
                            '&:hover': {
                              transform: 'translateY(-1px)',
                              boxShadow: (theme) => theme.palette.mode === 'dark'
                                ? '0 4px 12px rgba(56, 142, 232, 0.3)'
                                : '0 4px 12px rgba(25, 118, 210, 0.2)',
                              border: (theme) => theme.palette.mode === 'dark'
                                ? '1px solid rgba(56, 142, 232, 0.7)'
                                : '1px solid rgba(25, 118, 210, 0.5)',
                            },
                            '& .MuiChip-label': {
                              px: 1,
                              py: 0,
                              fontSize: '0.75rem',
                            },
                          }}
                        />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No variables
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {query.templateVariables && Object.keys(query.templateVariables).length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {Object.entries(query.templateVariables).map(([key, value]) => (
                        <Typography key={key} variant="caption">
                          <strong>{key}:</strong> {value}
                        </Typography>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      -
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {query.enabled ? (
                    <Chip label="Enabled" size="small" color="success" variant="outlined" />
                  ) : (
                    <Chip label="Disabled" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {/* The IconButton is the direct child: RequiresPermission clones it
                        with `disabled` and supplies its own tooltip when denied. A MUI
                        Tooltip in between would receive the `disabled` prop instead. */}
                    <RequiresPermission
                      action="integration:dynatrace:update"
                      orgId={query.organizationId}
                      resourcePermissions={query._permissions}
                      disabledReason="You do not have permission to edit this query"
                    >
                      <IconButton
                        size="small"
                        title="Edit"
                        aria-label="Edit query"
                        onClick={() => onEditQuery(query)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </RequiresPermission>
                    <RequiresPermission
                      action="integration:dynatrace:update"
                      orgId={query.organizationId}
                      resourcePermissions={query._permissions}
                      disabledReason="You do not have permission to change this query"
                    >
                      <IconButton
                        size="small"
                        title={query.enabled ? 'Disable — stop collecting this metric' : 'Enable — resume collecting this metric'}
                        aria-label={query.enabled ? 'Disable query' : 'Enable query'}
                        onClick={() => onToggleEnabled(query)}
                      >
                        {query.enabled ? <BlockIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" color="success" />}
                      </IconButton>
                    </RequiresPermission>
                    <RequiresPermission
                      action="integration:dynatrace:delete"
                      orgId={query.organizationId}
                      resourcePermissions={query._permissions}
                      disabledReason="You do not have permission to delete this query"
                    >
                      <IconButton
                        size="small"
                        title="Delete"
                        aria-label="Delete query"
                        onClick={() => onDeleteQuery(query)}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </RequiresPermission>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
