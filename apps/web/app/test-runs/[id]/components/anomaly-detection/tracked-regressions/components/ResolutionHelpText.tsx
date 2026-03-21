'use client';

import React from 'react';
import { Alert, Typography } from '@mui/material';

interface ResolutionHelpTextProps {
  isOldest: boolean;
}

export const ResolutionHelpText: React.FC<ResolutionHelpTextProps> = ({ isOldest }) => {
  return (
    <Alert severity="info" variant="outlined">
      <Typography variant="body2">
        <strong>Resolution Options:</strong>
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        • <strong>Mark as Regression:</strong> Confirms this is a real performance issue.
        The test run will be excluded from the baseline control group.
      </Typography>
      <Typography variant="body2">
        • <strong>Mark as Variability:</strong> Indicates this change is within acceptable limits.
        The test run remains in the control group.
      </Typography>
      {!isOldest && (
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, color: 'warning.main' }}>
          <strong>Queue Resolution:</strong> Regressions must be resolved in order (oldest first).
          This ensures consistent baseline management and prevents dependency conflicts.
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
        Use the correlation analysis above to understand if this regression occurred
        alongside other performance changes that might help identify the root cause.
      </Typography>
    </Alert>
  );
};
