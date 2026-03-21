'use client';

import { Alert } from '@mui/material';

interface ChartErrorStateProps {
  error: string;
}

export function ChartErrorState({ error }: ChartErrorStateProps) {
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      {error}
    </Alert>
  );
}
