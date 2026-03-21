'use client';

import React from 'react';
import { Box, Typography, Chip } from '@mui/material';

interface AffectedTestRunsProps {
  testRunIds: string[];
}

export const AffectedTestRuns: React.FC<AffectedTestRunsProps> = ({ testRunIds }) => {
  return (
    <>
      <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
        Affected Test Runs:
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
        {testRunIds.map(testRunId => (
          <Chip
            key={testRunId}
            label={testRunId}
            size="small"
            onClick={() => window.open(`/test-runs/${testRunId}`, '_blank')}
            sx={{
              cursor: 'pointer',
              '&:hover': { backgroundColor: 'action.hover' }
            }}
          />
        ))}
      </Box>
    </>
  );
};
