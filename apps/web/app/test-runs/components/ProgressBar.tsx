'use client';

import { Box, Typography, LinearProgress } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { isRecentlyActive, calculateProgress } from '../utils';

interface ProgressBarProps {
  testRun: TestRun;
  currentTime: number;
}

export function ProgressBar({ testRun, currentTime }: ProgressBarProps): JSX.Element {
  const progress = calculateProgress(testRun, currentTime);
  const isActive = isRecentlyActive(testRun, currentTime);

  let color: 'primary' | 'success' | 'warning' | 'error' = 'primary';

  if (testRun.abort) {
    color = 'error';
  } else if (testRun.completed && !isActive) {
    color = progress <= 100 ? 'success' : 'warning';
  } else if (!testRun.completed || isActive) {
    color = progress >= 90 ? 'warning' : 'primary';
  }

  if (progress === 0) {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }

  return (
    <Box sx={{
      width: 100,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      height: '100%'
    }}>
      <LinearProgress
        variant="determinate"
        value={progress}
        color={color}
        sx={{ height: 8, borderRadius: 4 }}
      />
      <Typography variant="caption" color="text.secondary" align="center" display="block">
        {Math.round(progress)}%
      </Typography>
    </Box>
  );
}
