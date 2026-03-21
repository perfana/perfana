'use client';

import { Box, CircularProgress, Alert } from '@mui/material';

interface TestRunsEmptyStateProps {
  loading: boolean;
  error: string | null;
}

export function TestRunsEmptyState({ loading, error }: TestRunsEmptyStateProps) {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return null;
}
