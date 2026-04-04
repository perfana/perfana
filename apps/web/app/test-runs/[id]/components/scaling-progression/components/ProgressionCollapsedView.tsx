'use client';

import { Box, Typography, Chip, CircularProgress } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { ProgressionData } from '../types';

interface Props {
  data: ProgressionData | null;
  loading: boolean;
  currentTestRunId: string;
}

export function ProgressionCollapsedView({ data, loading, currentTestRunId }: Props) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!data) return null;

  const { session, runs } = data;
  const currentIndex = runs.findIndex(r => r.test_run_id === currentTestRunId);

  // Count runs where all SLOs passed vs runs with at least one SLO failure
  const passedRuns = runs.filter(r => r.slo_results.length > 0 && r.slo_results.every(s => s.meets_requirement === true)).length;
  const failedRuns = runs.filter(r => r.slo_results.some(s => s.meets_requirement === false)).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
      <Typography variant="body2" color="text.secondary" noWrap>
        {session.name}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip
          icon={<TrendingUpIcon />}
          label={`Run ${currentIndex + 1} of ${runs.length}`}
          size="small"
          color="primary"
          variant="outlined"
        />
        {session.target_load && (
          <Chip
            label={`Target: ${session.target_load}`}
            size="small"
            variant="outlined"
          />
        )}
        {passedRuns > 0 && (
          <Chip
            icon={<CheckCircleIcon />}
            label={`${passedRuns} run${passedRuns > 1 ? 's' : ''} SLOs met`}
            size="small"
            color="success"
            variant="outlined"
          />
        )}
        {failedRuns > 0 && (
          <Chip
            icon={<ErrorIcon />}
            label={`${failedRuns} run${failedRuns > 1 ? 's' : ''} SLOs breached`}
            size="small"
            color="error"
            variant="outlined"
          />
        )}
        {session.linked_benchmarks.length > 0 && (
          <Chip
            label={`${session.linked_benchmarks.length} SLO${session.linked_benchmarks.length > 1 ? 's' : ''} tracked`}
            size="small"
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
}
