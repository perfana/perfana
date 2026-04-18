'use client';

import React from 'react';
import {
  Grid,
  Typography,
  Box,
  TextField,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  Chip,
  InputAdornment,
  FormHelperText,
} from '@mui/material';
import { SLOFormData, ValidationErrors } from '../types';
import {
  EVALUATE_TYPE_OPTIONS,
  REQUIREMENT_OPERATOR_OPTIONS,
  getEvaluateTypeOption,
  getRequirementOperatorOption,
  getRequirementValuePlaceholder,
  getRequirementValueHelperText,
  getUnitChipLabel,
  isUnitChipPrimary,
} from '../utils/slo-formatters';
import { parseValueWithUnit } from '../utils/slo-validators';

interface SLOThresholdConfigProps {
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
}

export function SLOThresholdConfig({
  sloFormData,
  setSloFormData,
  validationErrors,
  setValidationErrors,
}: SLOThresholdConfigProps) {
  const clearValidationError = (field: string) => {
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  if (!sloFormData.selectedPanel) {
    return null;
  }

  return (
    <>
      {/* Evaluate Type */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          options={EVALUATE_TYPE_OPTIONS}
          getOptionLabel={(option) => option.label}
          value={sloFormData.evaluateType ? getEvaluateTypeOption(sloFormData.evaluateType) : null}
          onChange={(_, newValue) => {
            setSloFormData((prev) => ({
              ...prev,
              evaluateType: newValue?.value || 'avg',
            }));
          }}
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
          options={REQUIREMENT_OPERATOR_OPTIONS}
          getOptionLabel={(option) => option.label}
          value={sloFormData.requirementOperator ? getRequirementOperatorOption(sloFormData.requirementOperator) : null}
          onChange={(_, newValue) => {
            setSloFormData((prev) => ({
              ...prev,
              requirementOperator: newValue?.value || 'lt',
            }));
          }}
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
          value={sloFormData.requirementValue}
          onChange={(e) => {
            setSloFormData((prev) => ({ ...prev, requirementValue: e.target.value }));
            clearValidationError('requirementValue');
          }}
          required
          error={!!validationErrors.requirementValue}
          placeholder={getRequirementValuePlaceholder(sloFormData.selectedPanel)}
          helperText={
            validationErrors.requirementValue ||
            getRequirementValueHelperText(sloFormData.requirementValue, sloFormData.selectedPanel)
          }
          InputProps={{
            endAdornment: (() => {
              const chipLabel = getUnitChipLabel(sloFormData.requirementValue, sloFormData.selectedPanel);
              if (chipLabel) {
                return (
                  <InputAdornment position="end">
                    <Chip
                      label={chipLabel}
                      size="small"
                      color={isUnitChipPrimary(sloFormData.requirementValue) ? 'primary' : 'default'}
                      variant="outlined"
                    />
                  </InputAdornment>
                );
              }
              return null;
            })(),
          }}
        />
      </Grid>

      {/* Tags */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={sloFormData.tags}
          onChange={(_, newValue) => {
            setSloFormData((prev) => ({ ...prev, tags: newValue }));
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              placeholder="Add tags..."
              helperText="Press Enter to add a tag"
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...otherProps } = getTagProps({ index });
              return <Chip key={key} variant="outlined" label={option} {...otherProps} />;
            })
          }
        />
      </Grid>

      {/* Advanced Options */}
      {/* Exclude Ramp-up Time */}
      <Grid size={{ xs: 12, md: 6 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={sloFormData.excludeRampUpTime}
              onChange={(e) => setSloFormData((prev) => ({ ...prev, excludeRampUpTime: e.target.checked }))}
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
      <Grid size={{ xs: 12, md: 6 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={sloFormData.averageAll}
              onChange={(e) => setSloFormData((prev) => ({ ...prev, averageAll: e.target.checked }))}
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
      <Grid size={{ xs: 12, md: 6 }}>
        <TextField
          fullWidth
          label="Match Pattern"
          value={sloFormData.matchPattern}
          onChange={(e) => setSloFormData((prev) => ({ ...prev, matchPattern: e.target.value }))}
          placeholder="e.g. transaction_*, /api/v1/*"
          helperText="Optional regex pattern to match specific metrics"
        />
      </Grid>

      {/* Use Default If No Data */}
      <Grid size={{ xs: 12, md: 6 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={sloFormData.validateWithDefaultIfNoData}
              onChange={(e) =>
                setSloFormData((prev) => ({ ...prev, validateWithDefaultIfNoData: e.target.checked }))
              }
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
      {sloFormData.validateWithDefaultIfNoData && (
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            label="Default Value If No Data"
            type="text"
            value={sloFormData.validateWithDefaultIfNoDataValue}
            onChange={(e) => {
              setSloFormData((prev) => ({ ...prev, validateWithDefaultIfNoDataValue: e.target.value }));
              clearValidationError('validateWithDefaultIfNoDataValue');
            }}
            placeholder="e.g. 0, 100ms, 0.99"
            error={!!validationErrors.validateWithDefaultIfNoDataValue}
            helperText={
              validationErrors.validateWithDefaultIfNoDataValue || 'Default value to use when no data is available'
            }
            InputProps={{
              endAdornment: (() => {
                const chipLabel = getUnitChipLabel(
                  sloFormData.validateWithDefaultIfNoDataValue,
                  sloFormData.selectedPanel
                );
                if (chipLabel) {
                  return (
                    <InputAdornment position="end">
                      <Chip
                        label={chipLabel}
                        size="small"
                        color={isUnitChipPrimary(sloFormData.validateWithDefaultIfNoDataValue) ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </InputAdornment>
                  );
                }
                return null;
              })(),
            }}
          />
        </Grid>
      )}
    </>
  );
}
