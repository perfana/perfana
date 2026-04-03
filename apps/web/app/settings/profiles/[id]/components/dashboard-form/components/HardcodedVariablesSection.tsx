'use client';

import {
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  Autocomplete,
  Tooltip,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { AvailableVariable, DashboardVariable, GrafanaDashboard } from '../types';

interface HardcodedVariablesSectionProps {
  variables: DashboardVariable[];
  availableVariableNames: AvailableVariable[];
  selectedDashboard: GrafanaDashboard | null;
  currentInputValues: Record<number, string>;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: 'name' | 'values', value: string | string[]) => void;
  onBlur: (index: number) => void;
  onInputChange: (index: number, value: string) => void;
  onClearInput: (index: number) => void;
}

/**
 * Section for managing hardcoded variable values
 */
export function HardcodedVariablesSection({
  variables,
  availableVariableNames,
  selectedDashboard,
  currentInputValues,
  disabled,
  onAdd,
  onRemove,
  onChange,
  onBlur,
  onInputChange,
  onClearInput,
}: HardcodedVariablesSectionProps) {
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2">Hardcoded Variables</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={disabled || !selectedDashboard}
        >
          Add Variable
        </Button>
      </Box>

      {variables.length === 0 && selectedDashboard && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No hardcoded variables configured. Click &quot;Add Variable&quot; to add one.
        </Typography>
      )}

      {variables.map((variable, index) => (
        <Box
          key={`hardcoded-var-${index}-${variable.name}`}
          display="flex"
          gap={1}
          mb={1}
          alignItems="flex-start"
        >
          {/* Variable Name Autocomplete */}
          <Autocomplete
            freeSolo
            options={availableVariableNames}
            getOptionLabel={(option) =>
              typeof option === 'string' ? option : option.name
            }
            value={variable.name}
            onChange={(_, newValue) => {
              if (typeof newValue === 'string') {
                onChange(index, 'name', newValue);
              } else if (newValue) {
                onChange(index, 'name', newValue.name);
              }
            }}
            onInputChange={(_, newValue) => {
              onChange(index, 'name', newValue);
            }}
            disabled={disabled}
            size="small"
            sx={{ flex: 1 }}
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
                label="Variable Name"
                placeholder={
                  availableVariableNames.length > 0
                    ? 'Select or type'
                    : 'Type variable name'
                }
              />
            )}
          />

          {/* Variable Values Autocomplete */}
          <Autocomplete
            key={`values-${index}-${variable.name}`}
            multiple
            freeSolo
            options={[]}
            value={variable.values || []}
            inputValue={currentInputValues[index] || ''}
            onChange={(_, newValue, reason) => {
              onChange(index, 'values', newValue);
              if (reason === 'createOption' || reason === 'selectOption') {
                onClearInput(index);
              }
            }}
            onInputChange={(_, value) => {
              onInputChange(index, value);
            }}
            onBlur={() => {
              onBlur(index);
            }}
            disabled={disabled}
            size="small"
            sx={{ flex: 2 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Values"
                placeholder="Type and press Enter or Tab"
              />
            )}
          />

          <Tooltip title="Remove variable">
            <span>
              <IconButton
                onClick={() => onRemove(index)}
                disabled={disabled}
                size="small"
                color="error"
                aria-label="Remove variable"
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}
