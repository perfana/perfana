'use client';

import React from 'react';
import {
  Box,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
} from '@mui/material';
import { Scope } from '../types';

interface ScopeSelectorProps {
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
}

export function ScopeSelector({ scope, onScopeChange }: ScopeSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onScopeChange(e.target.value as Scope);
  };

  return (
    <Box sx={{ mb: 4 }}>
      <FormControl component="fieldset">
        <FormLabel component="legend">
          <Typography variant="h6" gutterBottom>
            Calculation Scope
          </Typography>
        </FormLabel>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose how thresholds should be calculated
        </Typography>
        <RadioGroup value={scope} onChange={handleChange}>
          <FormControlLabel
            value="workload"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" fontWeight={500}>
                  Workload-level
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Calculate a single threshold for all transactions (weighted average)
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="transaction"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" fontWeight={500}>
                  Transaction-level
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Calculate individual thresholds for each transaction
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
      </FormControl>
    </Box>
  );
}
