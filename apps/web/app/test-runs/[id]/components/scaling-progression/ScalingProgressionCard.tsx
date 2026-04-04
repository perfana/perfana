'use client';

import { Card, CardContent, Box, Typography, IconButton, Collapse, Divider, Alert } from '@mui/material';
import TimelineIcon from '@mui/icons-material/Timeline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import { TestRun } from '@/types/test-runs';
import { useProgressionData } from './hooks/useProgressionData';
import { ProgressionCollapsedView } from './components/ProgressionCollapsedView';
import { ProgressionChart } from './components/ProgressionChart';

interface Props {
  testRun: TestRun | null;
  testRunId: string;
  expanded: boolean;
  onExpand: () => void;
}

export default function ScalingProgressionCard({ testRun, testRunId, expanded, onExpand }: Props) {
  const scalingSessionId = testRun?.scaling_session_id;
  const { data, loading, error, refresh } = useProgressionData({
    scalingSessionId,
    expanded,
  });

  if (!scalingSessionId) return null;

  return (
    <Card
      elevation={0}
      data-testid={expanded ? 'scaling-progression-card-expanded' : 'scaling-progression-card-collapsed'}
      tabIndex={expanded ? 0 : undefined}
      sx={{
        height: '100%',
        borderTop: '3px solid',
        borderColor: 'primary.main',
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
            <TimelineIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>
              Scaling Progression
            </Typography>
          </Box>
          {expanded ? (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton size="small" onClick={refresh} title="Refresh">
                <RefreshIcon fontSize="small" />
              </IconButton>
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
