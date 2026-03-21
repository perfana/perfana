'use client';

import {
  Box,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
} from '@mui/material';
import { ApdexScope } from '../types/apdex-thresholds.types';

interface ApdexScopeSelectorProps {
  scope: ApdexScope;
  onScopeChange: (scope: ApdexScope) => void;
}

export function ApdexScopeSelector({ scope, onScopeChange }: ApdexScopeSelectorProps) {
  return (
    <Box sx={{ mb: 4 }}>
      <FormControl component="fieldset">
        <FormLabel component="legend">
          <Typography variant="h6" gutterBottom>
            Configuration Scope
          </Typography>
        </FormLabel>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose how thresholds should be calculated
        </Typography>
        <RadioGroup
          value={scope}
          onChange={(e) => onScopeChange(e.target.value as ApdexScope)}
        >
          <FormControlLabel
            value="workload"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" fontWeight={500}>
                  Workload-level
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Calculate a single threshold for all transactions (simpler)
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
                  Calculate individual thresholds per transaction (more precise)
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
      </FormControl>
    </Box>
  );
}

export default ApdexScopeSelector;
