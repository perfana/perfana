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
  const regressionCount = runs.filter(r => r.adapt_conclusion === 'REGRESSION').length;
  const passCount = runs.filter(r => r.adapt_ok === true).length;

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
        {passCount > 0 && (
          <Chip
            icon={<CheckCircleIcon />}
            label={`${passCount} passed`}
            size="small"
            color="success"
            variant="outlined"
          />
        )}
        {regressionCount > 0 && (
          <Chip
            icon={<ErrorIcon />}
            label={`${regressionCount} regression${regressionCount > 1 ? 's' : ''}`}
            size="small"
            color="error"
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
}
