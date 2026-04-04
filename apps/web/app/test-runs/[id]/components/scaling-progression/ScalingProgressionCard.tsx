'use client';

import { useState } from 'react';
import { Card, CardContent, Box, Typography, IconButton, Collapse, Divider, Alert, Menu, MenuItem, Chip } from '@mui/material';
import TimelineIcon from '@mui/icons-material/Timeline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { useProgressionData } from './hooks/useProgressionData';
import { ProgressionCollapsedView } from './components/ProgressionCollapsedView';
import { ProgressionChart } from './components/ProgressionChart';

interface Props {
  testRun: TestRun | null;
  testRunId: string;
  expanded: boolean;
  onExpand: () => void;
  showToast?: (message: string) => void;
  onRefresh?: () => void;
}

export default function ScalingProgressionCard({ testRun, testRunId, expanded, onExpand, showToast, onRefresh }: Props) {
  const scalingSessionId = testRun?.scaling_session_id;
  const { data, loading, error, refresh } = useProgressionData({
    scalingSessionId,
    expanded,
  });

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [updating, setUpdating] = useState(false);

  if (!scalingSessionId) return null;

  const sessionStatus = data?.session?.status || 'active';
  const isActive = sessionStatus === 'active';

  const handleUpdateStatus = async (status: 'completed' | 'abandoned') => {
    setMenuAnchor(null);
    setUpdating(true);
    try {
      const response = await authenticatedFetch(`/scaling-sessions/${scalingSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Failed to update session');
      showToast?.(`Session ${status === 'completed' ? 'completed' : 'abandoned'}`);
      refresh();
      onRefresh?.();
    } catch {
      showToast?.('Failed to update session status');
    } finally {
      setUpdating(false);
    }
  };

  const statusColor = sessionStatus === 'completed' ? 'success' : sessionStatus === 'abandoned' ? 'default' : 'primary';

  return (
    <Card
      elevation={0}
      data-testid={expanded ? 'scaling-progression-card-expanded' : 'scaling-progression-card-collapsed'}
      tabIndex={expanded ? 0 : undefined}
      sx={{
        height: '100%',
        borderTop: '3px solid',
        borderColor: `${statusColor}.main`,
        cursor: expanded ? 'default' : 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': !expanded ? { transform: 'translateY(-2px)', boxShadow: 3 } : {},
      }}
      onClick={!expanded ? onExpand : undefined}
    >
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TimelineIcon color={statusColor as any} fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>
              Scaling Progression
            </Typography>
            {!isActive && (
              <Chip
                label={sessionStatus}
                size="small"
                color={statusColor as any}
                variant="outlined"
                sx={{ textTransform: 'capitalize', height: 20, fontSize: '0.7rem' }}
              />
            )}
          </Box>
          {expanded ? (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton size="small" onClick={refresh} disabled={updating} title="Refresh">
                <RefreshIcon fontSize="small" />
              </IconButton>
              {isActive && (
                <>
                  <IconButton
                    size="small"
                    onClick={(e) => setMenuAnchor(e.currentTarget)}
                    disabled={updating}
                    title="Session actions"
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                  <Menu
                    anchorEl={menuAnchor}
                    open={Boolean(menuAnchor)}
                    onClose={() => setMenuAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  >
                    <MenuItem onClick={() => handleUpdateStatus('completed')}>
                      <CheckCircleIcon sx={{ mr: 1.5, fontSize: '1.2rem', color: 'success.main' }} />
                      Complete Session
                    </MenuItem>
                    <MenuItem onClick={() => handleUpdateStatus('abandoned')}>
                      <CancelIcon sx={{ mr: 1.5, fontSize: '1.2rem', color: 'text.secondary' }} />
                      Abandon Session
                    </MenuItem>
                  </Menu>
                </>
              )}
              <IconButton size="small" onClick={onExpand} title="Collapse">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <IconButton size="small">
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {/* Collapsed view */}
        {!expanded && (
          <ProgressionCollapsedView
            data={data}
            loading={loading}
            currentTestRunId={testRunId}
          />
        )}

        {/* Expanded view */}
        <Collapse in={expanded}>
          <Divider sx={{ my: 1 }} />
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}
          {data && (
            <ProgressionChart
              data={data}
              currentTestRunId={testRunId}
            />
          )}
          {!data && !loading && !error && (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No progression data available.
            </Typography>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
}
