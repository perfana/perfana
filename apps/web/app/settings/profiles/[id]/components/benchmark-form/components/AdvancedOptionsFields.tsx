'use client';

import React from 'react';
import {
  Grid,
  TextField,
  FormControlLabel,
  Checkbox,
  FormHelperText,
  InputAdornment,
  Chip,
} from '@mui/material';
import { getUnit } from '@/lib/units';
import { GrafanaPanel } from '../types';
import { parseValueWithUnit } from '../utils';

interface AdvancedOptionsFieldsProps {
  excludeRampUpTime: boolean;
  averageAll: boolean;
  matchPattern: string;
  validateWithDefaultIfNoData: boolean;
  validateWithDefaultIfNoDataValue: string;
  selectedPanel: GrafanaPanel | null;
  validationErrors: Record<string, string>;
  onExcludeRampUpTimeChange: (value: boolean) => void;
  onAverageAllChange: (value: boolean) => void;
  onMatchPatternChange: (value: string) => void;
  onValidateWithDefaultChange: (value: boolean) => void;
  onDefaultValueChange: (value: string) => void;
}

export function AdvancedOptionsFields({
  excludeRampUpTime,
  averageAll,
  matchPattern,
  validateWithDefaultIfNoData,
  validateWithDefaultIfNoDataValue,
  selectedPanel,
  validationErrors,
  onExcludeRampUpTimeChange,
  onAverageAllChange,
  onMatchPatternChange,
  onValidateWithDefaultChange,
  onDefaultValueChange,
}: AdvancedOptionsFieldsProps) {
  // Get unit display for default value
  const parsedDefaultValue = parseValueWithUnit(validateWithDefaultIfNoDataValue);
  const panelUnit = selectedPanel?.yAxesFormat ? getUnit(selectedPanel.yAxesFormat) : null;

  return (
    <>
      {/* Exclude Ramp-up Time */}
      <Grid item xs={12} md={6}>
        <FormControlLabel
          control={
            <Checkbox
              checked={excludeRampUpTime}
              onChange={(e) => onExcludeRampUpTimeChange(e.target.checked)}
              color="primary"
            />
          }
          label="Exclude Ramp-up Time"
        />
        <FormHelperText sx={{ ml: 0, mt: 0.5 }}>
          Exclude measurements taken during the ramp-up period from SLO evaluation
        </FormHelperText>
      </Grid>

      {/* Average All Values */}
      <Grid item xs={12} md={6}>
        <FormControlLabel
          control={
            <Checkbox
              checked={averageAll}
              onChange={(e) => onAverageAllChange(e.target.checked)}
              color="primary"
            />
          }
          label="Average All Values"
        />
        <FormHelperText sx={{ ml: 0, mt: 0.5 }}>
          Average all metric values instead of using evaluation type
        </FormHelperText>
      </Grid>

      {/* Match Pattern */}
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Match Pattern"
          value={matchPattern}
          onChange={(e) => onMatchPatternChange(e.target.value)}
          placeholder="e.g. transaction_*, /api/v1/*"
          helperText="Optional regex pattern to match specific metrics"
        />
      </Grid>

      {/* Use Default If No Data */}
      <Grid item xs={12} md={6}>
        <FormControlLabel
          control={
            <Checkbox
              checked={validateWithDefaultIfNoData}
              onChange={(e) => onValidateWithDefaultChange(e.target.checked)}
              color="primary"
            />
          }
          label="Use Default If No Data"
        />
        <FormHelperText sx={{ ml: 0, mt: 0.5 }}>
          Use default value when no metric data is available
        </FormHelperText>
      </Grid>

      {/* Default Value If No Data */}
      {validateWithDefaultIfNoData && (
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            label="Default Value If No Data"
            type="text"
            value={validateWithDefaultIfNoDataValue}
            onChange={(e) => onDefaultValueChange(e.target.value)}
            placeholder="e.g. 0, 100ms, 0.99"
            error={!!validationErrors.validateWithDefaultIfNoDataValue}
            helperText={validationErrors.validateWithDefaultIfNoDataValue || 'Default value to use when no data is available'}
            InputProps={{
              endAdornment: (parsedDefaultValue.unit || panelUnit?.format) ? (
                <InputAdornment position="end">
                  <Chip
                    label={parsedDefaultValue.unit || panelUnit?.format || ''}
                    size="small"
                    color={parsedDefaultValue.unit ? 'primary' : 'default'}
                    variant="outlined"
                  />
                </InputAdornment>
              ) : null,
            }}
          />
        </Grid>
      )}
    </>
  );
}
