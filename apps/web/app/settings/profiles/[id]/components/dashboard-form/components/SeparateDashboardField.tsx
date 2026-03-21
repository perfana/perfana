'use client';

import { TextField, Autocomplete, Box, Typography } from '@mui/material';
import { AvailableVariable, GrafanaDashboard } from '../types';

interface SeparateDashboardFieldProps {
  value: string;
  variables: AvailableVariable[];
  selectedDashboard: GrafanaDashboard | null;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Autocomplete field for selecting a variable to create separate dashboards for
 */
export function SeparateDashboardField({
  value,
  variables,
  selectedDashboard,
  disabled,
  onChange,
}: SeparateDashboardFieldProps) {
  const getHelperText = () => {
    if (!selectedDashboard) {
      return 'Select a dashboard first';
    }
    return variables.length > 0
      ? 'Select from dashboard variables or type a custom name'
      : 'Dashboard has no templating variables, type a custom name';
  };

  return (
    <Autocomplete
      freeSolo
      options={variables}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
      value={value}
      onChange={(_, newValue) => {
        if (typeof newValue === 'string') {
          onChange(newValue);
        } else if (newValue) {
          onChange(newValue.name);
        } else {
          onChange('');
        }
      }}
      onInputChange={(_, newValue) => {
        onChange(newValue);
      }}
      disabled={disabled || !selectedDashboard}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <Box component="li" key={key} {...otherProps}>
            <Box>
              <Typography variant="body2">{option.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {option.type}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Create Separate Dashboard For Variable"
          helperText={getHelperText()}
        />
      )}
    />
  );
}
