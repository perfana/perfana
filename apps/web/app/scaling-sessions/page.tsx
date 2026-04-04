'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { OpenInNew, TrendingUp } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

interface ScalingSession {
  id: string;
  name: string;
  description?: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  baseline_test_run_id?: string;
  target_load?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function ScalingSessionsPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganizationContext();
  const [sessions, setSessions] = useState<ScalingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('active');

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const response = await authenticatedFetch(`/scaling-sessions?${params}`, { method: 'GET' });
      if (!response.ok) throw new Error('Failed to fetch scaling sessions');
      const data = await response.json();
      setSessions(data);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load sessions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const statusColor = (status: string): 'success' | 'default' | 'primary' => {
    if (status === 'completed') return 'success';
    if (status === 'abandoned') return 'default';
    return 'primary';
  };

  const navigateToBaseline = (testRunId: string) => {
    router.push(`/test-runs/${testRunId}`);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <TrendingUp color="primary" />
            <Typography variant="h5" fontWeight={600}>
              Scaling Sessions
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Track performance across increasing load levels. Start a session from any test run's actions menu.
          </Typography>
        </Box>
      </Box>

      {/* Status filter */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={statusFilter}
          exclusive
          onChange={(_, value) => { if (value !== null) setStatusFilter(value); }}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              textTransform: 'none',
              fontWeight: 500,
              px: 2,
            },
          }}
        >
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="completed">Completed</ToggleButton>
          <ToggleButton value="abandoned">Abandoned</ToggleButton>
          <ToggleButton value="">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : sessions.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <TrendingUp sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No {statusFilter || ''} scaling sessions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Start a scaling session from a test run's actions menu to begin tracking performance across load levels.
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Environment</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Workload</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Target Load</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Baseline</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  key={session.id}
                  hover
                  sx={{ '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {session.name}
                    </Typography>
                    {session.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {session.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{session.test_environment}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{session.workload}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {session.target_load || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={session.status}
                      size="small"
                      color={statusColor(session.status)}
                      variant="outlined"
                      sx={{ textTransform: 'capitalize', height: 22 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(session.created_at).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {session.baseline_test_run_id ? (
                      <Tooltip title={`Go to baseline: ${session.baseline_test_run_id}`}>
                        <IconButton
                          size="small"
                          onClick={() => navigateToBaseline(session.baseline_test_run_id!)}
                        >
                          <OpenInNew fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.disabled">-</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
