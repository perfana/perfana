'use client';

import { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  InputAdornment,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { HostOverviewRow } from '@/lib/dynatrace';
import HostLabelChips from '@/components/HostLabelChips';

interface HostEntity {
  id: string;
  entityId: string;
  entityDisplayName: string;
  dynatraceConfigId: string;
  labels?: string[];
}

interface HostsOverviewTableProps {
  hosts: HostEntity[];
  rows: HostOverviewRow[];
  loading: boolean;
  onSelectHost: (hostId: string) => void;
}

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  AVAILABILITY: 'error',
  ERROR: 'error',
  PERFORMANCE: 'warning',
  RESOURCE_CONTENTION: 'warning',
  CUSTOM_ALERT: 'info',
  MONITORING_UNAVAILABLE: 'info',
  INFO: 'info',
};

type SortKey = 'host' | 'cpu' | 'mem' | 'problems';

function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

export default function HostsOverviewTable({ hosts, rows, loading, onSelectHost }: HostsOverviewTableProps) {
  // Default order: problems first, then CPU avg descending — the two things you scan for.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState<string[]>([]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.hostId, r])), [rows]);

  const labelOptions = useMemo(
    () => Array.from(new Set(hosts.flatMap((h) => h.labels ?? []))).sort(),
    [hosts],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const byName = needle
      ? hosts.filter((h) => h.entityDisplayName.toLowerCase().includes(needle))
      : hosts;
    // AND across the chosen labels — a multi-select filter reads as narrowing.
    const filtered =
      labelFilter.length === 0
        ? byName
        : byName.filter((h) => labelFilter.every((l) => (h.labels ?? []).includes(l)));

    const sign = sortDir === 'asc' ? 1 : -1;
    // A host Dynatrace returned no reading for sorts last in BOTH directions — it is
    // "no data", not "zero", and a plain sign flip would float it to the top on ascending.
    const byMetric = (a: number | null | undefined, b: number | null | undefined) => {
      const missA = a === null || a === undefined;
      const missB = b === null || b === undefined;
      if (missA || missB) return missA && missB ? 0 : missA ? 1 : -1;
      return sign * (a - b);
    };

    return [...filtered].sort((a, b) => {
      const ra = byId.get(a.entityId);
      const rb = byId.get(b.entityId);
      switch (sortKey) {
        case 'host':
          return sign * a.entityDisplayName.localeCompare(b.entityDisplayName);
        case 'cpu':
          return byMetric(ra?.cpuAvg, rb?.cpuAvg);
        case 'mem':
          return byMetric(ra?.memAvg, rb?.memAvg);
        case 'problems':
          return sign * ((ra?.problemCount ?? 0) - (rb?.problemCount ?? 0));
        default: {
          // Rows stream in one host at a time; re-sorting on every arrival makes
          // them jump under the cursor. Hold the mapping order until all are in.
          if (loading) return 0;
          const pa = (ra?.problemCount ?? 0) > 0 ? 1 : 0;
          const pb = (rb?.problemCount ?? 0) > 0 ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return (rb?.cpuAvg ?? -1) - (ra?.cpuAvg ?? -1);
        }
      }
    });
  }, [hosts, byId, filter, labelFilter, sortKey, sortDir, loading]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'host' ? 'asc' : 'desc');
    }
  };

  const header = (key: SortKey, label: string) => (
    <TableSortLabel
      active={sortKey === key}
      direction={sortKey === key ? sortDir : 'desc'}
      onClick={() => handleSort(key)}
    >
      {label}
    </TableSortLabel>
  );

  if (hosts.length === 0) {
    return (
      <Box py={4} textAlign="center">
        <Typography color="text.secondary">No hosts found</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Filter hosts"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ width: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          inputProps={{ 'aria-label': 'Filter hosts' }}
        />
        {labelOptions.length > 0 && (
          <Autocomplete
            multiple
            size="small"
            options={labelOptions}
            value={labelFilter}
            onChange={(_event, value) => setLabelFilter(value)}
            renderInput={(params) => <TextField {...params} label="Filter by label" />}
            sx={{ minWidth: 280 }}
          />
        )}
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="hosts overview">
          <TableHead>
            <TableRow>
              <TableCell>{header('host', 'Host')}</TableCell>
              <TableCell>Labels</TableCell>
              <TableCell align="right">{header('cpu', 'CPU avg')}</TableCell>
              <TableCell align="right">{header('mem', 'Memory avg')}</TableCell>
              <TableCell align="center">{header('problems', 'Problems')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" align="center" py={2}>
                    No hosts match the current filters
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {visible.map((host) => {
              const r = byId.get(host.entityId);
              const pending = loading && !r;
              return (
                <TableRow
                  key={host.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => onSelectHost(host.entityId)}
                >
                  <TableCell>{host.entityDisplayName}</TableCell>
                  <TableCell>
                    <HostLabelChips labels={host.labels} />
                  </TableCell>
                  <TableCell align="right">{pending ? <Skeleton width={40} /> : fmtPct(r?.cpuAvg)}</TableCell>
                  <TableCell align="right">{pending ? <Skeleton width={40} /> : fmtPct(r?.memAvg)}</TableCell>
                  <TableCell align="center">
                    {pending ? (
                      <Skeleton width={60} sx={{ mx: 'auto' }} />
                    ) : r && r.problemCount > 0 ? (
                      <Chip
                        size="small"
                        color={r.worstSeverity ? SEVERITY_COLOR[r.worstSeverity] ?? 'default' : 'default'}
                        label={r.problemCount}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        healthy
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
