'use client';

import React from 'react';
import {
  Grid,
  TextField,
  Autocomplete,
  Box,
  Typography,
  InputAdornment,
  Chip,
} from '@mui/material';
import { getUnit } from '@/lib/units';
import {
  EVALUATION_TYPES,
  REQUIREMENT_OPERATORS,
  EVALUATION_TYPE_LABELS,
  OPERATOR_LABELS,
  EvaluationTypeOption,
  OperatorOption,
  GrafanaPanel,
} from '../types';
import {
  parseValueWithUnit,
  getRequirementValueHelperText,
  getRequirementValuePlaceholder,
} from '../utils';

interface SloConfigFieldsProps {
  evaluateType: string;
  requirementOperator: string;
  requirementValue: string;
  selectedPanel: GrafanaPanel | null;
  validationErrors: Record<string, string>;
  onEvaluateTypeChange: (value: string) => void;
  onOperatorChange: (value: string) => void;
  onValueChange: (value: string) => void;
}

export function SloConfigFields({
  evaluateType,
  requirementOperator,
  requirementValue,
  selectedPanel,
  validationErrors,
  onEvaluateTypeChange,
  onOperatorChange,
  onValueChange,
}: SloConfigFieldsProps) {
  // Build current evaluation type option
  const currentEvaluationType: EvaluationTypeOption | null = evaluateType ? {
    value: evaluateType,
    label: EVALUATION_TYPE_LABELS[evaluateType] || evaluateType,
    description: EVALUATION_TYPES.find(t => t.value === evaluateType)?.description || '',
  } : null;

  // Build current operator option
  const currentOperator: OperatorOption | null = requirementOperator ? {
    value: requirementOperator,
    label: OPERATOR_LABELS[requirementOperator] || requirementOperator,
    description: REQUIREMENT_OPERATORS.find(o => o.value === requirementOperator)?.description || '',
  } : null;

  // Get unit display information
  const parsedValue = parseValueWithUnit(requirementValue);
  const panelUnit = selectedPanel?.yAxesFormat ? getUnit(selectedPanel.yAxesFormat) : null;

  return (
    <>
      {/* Evaluation Type */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          options={EVALUATION_TYPES}
          getOptionLabel={(option) => option.label}
          value={currentEvaluationType}
          onChange={(_, newValue) => onEvaluateTypeChange(newValue?.value || 'avg')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Evaluation Type"
              variant="outlined"
              fullWidth
              required
              helperText="How should the metric values be evaluated for this SLO?"
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box>
                  <Typography variant="body1">{option.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {option.description}
                  </Typography>
                </Box>
              </Box>
            );
          }}
        />
      </Grid>

      {/* Requirement Operator */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          options={REQUIREMENT_OPERATORS}
          getOptionLabel={(option) => option.label}
          value={currentOperator}
          onChange={(_, newValue) => onOperatorChange(newValue?.value || 'lt')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Requirement Operator"
              variant="outlined"
              fullWidth
              required
              helperText="How should the evaluated metric be compared to the threshold?"
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box>
                  <Typography variant="body1">{option.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {option.description}
                  </Typography>
                </Box>
              </Box>
            );
          }}
        />
      </Grid>

      {/* Requirement Value */}
      <Grid size={{ xs: 12 }}>
        <TextField
          fullWidth
          label="Requirement Value"
          type="text"
          value={requirementValue}
          onChange={(e) => onValueChange(e.target.value)}
          required
          error={!!validationErrors.requirementValue}
          placeholder={getRequirementValuePlaceholder(selectedPanel?.yAxesFormat)}
          helperText={getRequirementValueHelperText(
            requirementValue,
            selectedPanel?.yAxesFormat,
            validationErrors.requirementValue
          )}
          InputProps={{
            endAdornment: (parsedValue.unit || panelUnit?.format) ? (
              <InputAdornment position="end">
                <Chip
                  label={parsedValue.unit || panelUnit?.format || ''}
                  size="small"
                  color={parsedValue.unit ? 'primary' : 'default'}
                  variant="outlined"
                />
              </InputAdornment>
            ) : null,
          }}
        />
      </Grid>
    </>
  );
}
