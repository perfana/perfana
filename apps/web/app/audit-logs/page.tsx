'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  KeyboardArrowDown,
  KeyboardArrowRight,
  Refresh,
  History,
} from '@mui/icons-material';
import { useAuditCapabilities, useAuditLogs } from '@/lib/hooks/use-audit-logs';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { useUserSearch } from '@/lib/hooks/use-user-search';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { fetchAllSystemsUnderTest } from '@/lib/systems';
import type { SystemUnderTest } from '@/types/test-runs';
import type { UserInfo } from '@/lib/api/users';
import { AuditAction, AuditFilter, AuditLogRow } from '@/lib/audit-api';

const PAGE_SIZE = 50;
const ACTIONS: AuditAction[] = ['CREATE', 'UPDATE', 'DELETE'];

const ACTION_COLORS: Record<AuditAction, 'success' | 'info' | 'error'> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'error',
};

interface FilterState {
  resourceType: string;
  user: UserInfo | null;
  action: AuditAction | '';
  organizationId: string;
  systemUnderTestId: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: FilterState = {
  resourceType: '',
  user: null,
  action: '',
  organizationId: '',
  systemUnderTestId: '',
  startDate: '',
  endDate: '',
};

function toAuditFilter(state: FilterState, page: number): AuditFilter {
  return {
    resourceType: state.resourceType || undefined,
    userId: state.user?.id || undefined,
    action: (state.action || undefined) as AuditAction | undefined,
    organizationId: state.organizationId || undefined,
    systemUnderTestId: state.systemUnderTestId || undefined,
    startDate: state.startDate ? new Date(state.startDate).toISOString() : undefined,
    endDate: state.endDate ? new Date(state.endDate).toISOString() : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
}

export default function AuditLogsPage() {
  const { data: caps, isLoading: capsLoading } = useAuditCapabilities();
  // Load orgs for every audit viewer so the table can resolve `organizationId`
  // → name. The Organization filter dropdown is still gated on isSuperAdmin
  // below; this hook just feeds the column renderer.
  const { data: organizations = [] } = useOrganizations({ enabled: caps?.canView ?? false });
  const orgById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of organizations) m.set(o.id, o.name);
    return m;
  }, [organizations]);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  // User filter — type-ahead backed by the same Keycloak user search the
  // org/team "Add Member" dialog uses, so the dropdown shows a real name +
  // email instead of a Keycloak `sub` UUID.
  const [userQuery, setUserQuery] = useState('');
  const debouncedUserQuery = useDebounce(userQuery, 300);
  const { data: userOptions = [], isFetching: userSearchLoading } = useUserSearch(
    { q: debouncedUserQuery, limit: 20 },
    { enabled: (caps?.canView ?? false) && debouncedUserQuery.length >= 2 },
  );

  // SUT filter — load once. The `/systems-under-test` endpoint is already
  // RBAC-scoped to the caller's accessible orgs server-side.
  const [systems, setSystems] = useState<SystemUnderTest[]>([]);
  useEffect(() => {
    if (!caps?.canView) return;
    let cancelled = false;
    fetchAllSystemsUnderTest()
      .then((rows) => { if (!cancelled) setSystems(rows); })
      .catch(() => { /* non-blocking — dropdown just stays empty */ });
    return () => { cancelled = true; };
  }, [caps?.canView]);
  const sutById = useMemo(() => {
    const m = new Map<string, SystemUnderTest>();
    for (const s of systems) if (s.id) m.set(s.id, s);
    return m;
  }, [systems]);
  const sutNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, s] of sutById) m.set(id, s.name);
    return m;
  }, [sutById]);

  const queryFilter = useMemo(() => toAuditFilter(appliedFilters, page), [appliedFilters, page]);
  const { data, isLoading, isFetching, error, refetch } = useAuditLogs(queryFilter, {
    enabled: caps?.canView ?? false,
  });

  if (capsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!caps?.canView) {
    return (
      <Box sx={{ py: 4, px: 3 }}>
        <Alert severity="warning">
          You don&apos;t have permission to view audit logs. Audit access is restricted to
          super-admins, system-admins, support staff, and organization admins.
        </Alert>
      </Box>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const apply = () => {
    setPage(1);
    setAppliedFilters(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setUserQuery('');
    setPage(1);
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <History fontSize="large" />
          <Box>
            <Typography variant="h4" fontWeight={600}>
              Audit Logs
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {caps.scope === 'cross-org'
                ? 'Cross-organization audit history.'
                : `Scoped to your ${caps.accessibleOrganizationIds.length} accessible organization${
                    caps.accessibleOrganizationIds.length === 1 ? '' : 's'
                  }.`}
            </Typography>
          </Box>
        </Stack>
        <IconButton onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
          <Refresh />
        </IconButton>
      </Stack>

      {/* Filter bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="resource-type-label">Resource Type</InputLabel>
            <Select
              labelId="resource-type-label"
              label="Resource Type"
              value={filters.resourceType}
              onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
            >
              <MenuItem value="">
                <em>All</em>
              </MenuItem>
              {(caps.knownResourceTypes ?? []).map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="action-label">Action</InputLabel>
            <Select
              labelId="action-label"
              label="Action"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value as AuditAction | '' })}
            >
              <MenuItem value="">
                <em>All</em>
              </MenuItem>
              {ACTIONS.map((a) => (
                <MenuItem key={a} value={a}>
                  {a}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {caps.isSuperAdmin && (
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="org-label">Organization</InputLabel>
              <Select
                labelId="org-label"
                label="Organization"
                value={filters.organizationId}
                onChange={(e) => setFilters({ ...filters, organizationId: e.target.value })}
              >
                <MenuItem value="">
                  <em>All</em>
                </MenuItem>
                {organizations.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Autocomplete<UserInfo, false, false, false>
            size="small"
            sx={{ minWidth: 240 }}
            value={filters.user}
            onChange={(_, value) => setFilters({ ...filters, user: value })}
            inputValue={userQuery}
            onInputChange={(_, value) => setUserQuery(value)}
            options={userOptions}
            getOptionLabel={(opt) => opt.displayName ?? opt.username ?? ''}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(opts) => opts}
            loading={userSearchLoading}
            noOptionsText={
              debouncedUserQuery.length < 2 ? 'Type at least 2 characters' : 'No users found'
            }
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box>
                  <Typography variant="body2">{option.displayName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.email ?? option.username}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => <TextField {...params} label="User" />}
          />

          <Autocomplete<SystemUnderTest, false, false, false>
            size="small"
            sx={{ minWidth: 240 }}
            value={filters.systemUnderTestId ? (sutById.get(filters.systemUnderTestId) ?? null) : null}
            onChange={(_, value) =>
              setFilters({ ...filters, systemUnderTestId: value?.id ?? '' })
            }
            options={systems}
            getOptionLabel={(opt) => opt.name ?? ''}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="System under test" />}
          />

          <TextField
            size="small"
            type="datetime-local"
            label="From"
            InputLabelProps={{ shrink: true }}
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />

          <TextField
            size="small"
            type="datetime-local"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" onClick={apply} disabled={isFetching}>
              Apply
            </Button>
            <Button variant="outlined" onClick={reset} disabled={isFetching}>
              Reset
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table size="small" aria-label="Audit log rows">
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell>Timestamp</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Resource</TableCell>
                <TableCell>System under test</TableCell>
                <TableCell>Org</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : (data?.rows.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No audit rows match these filters.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                data!.rows.map((row) => (
                  <AuditRow
                    key={row.id}
                    row={row}
                    sutNameById={sutNameById}
                    orgNameById={orgById}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {data && data.total > PAGE_SIZE && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total}
            </Typography>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(_, p) => setPage(p)}
              size="small"
              showFirstButton
              showLastButton
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}

function AuditRow({
  row,
  sutNameById,
  orgNameById,
}: {
  row: AuditLogRow;
  sutNameById: Map<string, string>;
  orgNameById: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDiff = !!row.changes && (row.changes.fields?.length ?? 0) > 0;
  const ts = new Date(row.timestamp);
  const sutName = row.systemUnderTestId ? sutNameById.get(row.systemUnderTestId) : undefined;
  const orgName = row.organizationId ? orgNameById.get(row.organizationId) : undefined;

  return (
    <>
      <TableRow
        hover={hasDiff}
        onClick={() => hasDiff && setExpanded((e) => !e)}
        sx={{ cursor: hasDiff ? 'pointer' : 'default' }}
      >
        <TableCell sx={{ color: 'text.secondary' }}>
          {hasDiff ? (
            expanded ? <KeyboardArrowDown fontSize="small" /> : <KeyboardArrowRight fontSize="small" />
          ) : null}
        </TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {ts.toLocaleString(undefined, { hour12: false })}
        </TableCell>
        <TableCell>
          <Box>
            {row.userEmail ? (
              <Typography variant="body2">{row.userEmail}</Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {row.userId}
            </Typography>
          </Box>
        </TableCell>
        <TableCell>
          <Chip label={row.action} color={ACTION_COLORS[row.action]} size="small" />
        </TableCell>
        <TableCell>
          <Typography variant="body2">{row.resourceType}</Typography>
          {row.resourceName ? (
            <Typography variant="caption" color="text.secondary">
              {row.resourceName}
            </Typography>
          ) : null}
        </TableCell>
        <TableCell>
          {row.systemUnderTestId ? (
            <Typography variant="body2">{sutName ?? row.systemUnderTestId}</Typography>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell>
          {row.organizationId ? (
            <Typography variant="body2">{orgName ?? row.organizationId}</Typography>
          ) : (
            '—'
          )}
        </TableCell>
      </TableRow>
      {hasDiff && (
        <TableRow>
          <TableCell colSpan={7} sx={{ p: 0, borderBottom: 'none' }}>
            <Collapse in={expanded} unmountOnExit>
              <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                <DiffViewer row={row} />
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DiffViewer({ row }: { row: AuditLogRow }) {
  const fields = row.changes?.fields ?? [];
  const before = (row.changes?.before ?? {}) as Record<string, unknown>;
  const after = (row.changes?.after ?? {}) as Record<string, unknown>;

  return (
    <Stack spacing={1}>
      <Typography variant="overline">Changed fields ({fields.length})</Typography>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
        }}
      >
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ textAlign: 'left', p: 1, width: '20%' }}>
              field
            </Box>
            <Box component="th" sx={{ textAlign: 'left', p: 1, width: '40%' }}>
              before
            </Box>
            <Box component="th" sx={{ textAlign: 'left', p: 1, width: '40%' }}>
              after
            </Box>
          </Box>
        </Box>
        <Box component="tbody">
          {fields.map((f) => (
            <Box component="tr" key={f}>
              <Box component="td" sx={{ p: 1, verticalAlign: 'top', fontWeight: 600 }}>
                {f}
              </Box>
              <Box component="td" sx={{ p: 1, verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                {formatValue(before[f])}
              </Box>
              <Box component="td" sx={{ p: 1, verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                {formatValue(after[f])}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      {row.metadata?.request_id ? (
        <Typography variant="caption" color="text.secondary">
          request_id: <code>{row.metadata.request_id}</code>
        </Typography>
      ) : null}
    </Stack>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
