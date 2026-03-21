'use client';

import { Alert, Typography, Box, Chip } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';
import { AvailableVariable } from '../types';

interface VariablesInfoBoxProps {
  variables: AvailableVariable[];
}

/**
 * Info box displaying available dashboard templating variables
 */
export function VariablesInfoBox({ variables }: VariablesInfoBoxProps) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 1 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <strong>Available Dashboard Variables:</strong>
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {variables.map((variable) => (
          <Chip
            key={variable.name}
            label={`${variable.name} (${variable.type})`}
            size="small"
            variant="outlined"
          />
        ))}
      </Box>
    </Alert>
  );
}
