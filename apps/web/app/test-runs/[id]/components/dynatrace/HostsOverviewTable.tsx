'use client';

import {
  Box,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { HostOverviewRow } from '@/lib/dynatrace';

interface HostEntity {
  id: string;
  entityId: string;
  entityDisplayName: string;
  dynatraceConfigId: string;
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

function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

export default function HostsOverviewTable({ hosts, rows, loading, onSelectHost }: HostsOverviewTableProps) {
  if (hosts.length === 0) {
    return (
      <Box py={4} textAlign="center">
        <Typography color="text.secondary">No hosts found</Typography>
      </Box>
    );
  }

  const byId = new Map(rows.map((r) => [r.hostId, r]));

  // problems first, then CPU avg descending (null CPU sinks to the bottom)
  const sorted = [...hosts].sort((a, b) => {
    const ra = byId.get(a.entityId);
    const rb = byId.get(b.entityId);
    const pa = (ra?.problemCount ?? 0) > 0 ? 1 : 0;
    const pb = (rb?.problemCount ?? 0) > 0 ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (rb?.cpuAvg ?? -1) - (ra?.cpuAvg ?? -1);
  });

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="hosts overview">
        <TableHead>
          <TableRow>
            <TableCell>Host</TableCell>
            <TableCell align="right">CPU avg</TableCell>
            <TableCell align="right">Memory avg</TableCell>
            <TableCell align="center">Problems</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((host) => {
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
  );
}
