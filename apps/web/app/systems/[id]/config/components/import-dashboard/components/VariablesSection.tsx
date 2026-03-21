'use client';

import { Box, Typography, TextField } from '@mui/material';
import { getVariableHelperText } from '../types';

interface VariablesSectionProps {
  variables: string[];
  variableValues: Record<string, string>;
  onVariableChange: (variable: string, value: string) => void;
}

export function VariablesSection({
  variables,
  variableValues,
  onVariableChange,
}: VariablesSectionProps) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Template Variables
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Provide values for the template variables found in the DQL queries:
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {variables.map(variable => (
          <TextField
            key={variable}
            label={`$${variable}`}
            value={variableValues[variable] || ''}
            onChange={e => onVariableChange(variable, e.target.value)}
            size="small"
            placeholder={`Enter value for $${variable}`}
            helperText={getVariableHelperText(variable)}
          />
        ))}
      </Box>
    </Box>
  );
}
