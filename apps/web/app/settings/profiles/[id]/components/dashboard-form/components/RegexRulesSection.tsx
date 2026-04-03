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
import { AvailableVariable, RegexRule, GrafanaDashboard } from '../types';

interface RegexRulesSectionProps {
  rules: RegexRule[];
  availableVariableNames: AvailableVariable[];
  selectedDashboard: GrafanaDashboard | null;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: 'key' | 'value', value: string) => void;
}

/**
 * Section for managing regex rules for variable matching
 */
export function RegexRulesSection({
  rules,
  availableVariableNames,
  selectedDashboard,
  disabled,
  onAdd,
  onRemove,
  onChange,
}: RegexRulesSectionProps) {
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2">Regex Rules</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAdd}
          disabled={disabled || !selectedDashboard}
        >
          Add Rule
        </Button>
      </Box>

      {rules.length === 0 && selectedDashboard && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No regex rules configured. Click &quot;Add Rule&quot; to add one.
        </Typography>
      )}

      {rules.map((rule, index) => (
        <Box key={index} display="flex" gap={1} mb={1} alignItems="flex-start">
          {/* Variable Name Autocomplete */}
          <Autocomplete
            freeSolo
            options={availableVariableNames}
            getOptionLabel={(option) =>
              typeof option === 'string' ? option : option.name
            }
            value={rule.key}
            onChange={(_, newValue) => {
              if (typeof newValue === 'string') {
                onChange(index, 'key', newValue);
              } else if (newValue) {
                onChange(index, 'key', newValue.name);
              }
            }}
            onInputChange={(_, newValue) => {
              onChange(index, 'key', newValue);
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

          {/* Regex Pattern Input */}
          <TextField
            label="Regex Pattern"
            value={rule.value}
            onChange={(e) => onChange(index, 'value', e.target.value)}
            disabled={disabled}
            size="small"
            sx={{ flex: 1, fontFamily: 'monospace' }}
            placeholder="^pattern.*"
          />

          <Tooltip title="Remove regex rule">
            <span>
              <IconButton
                onClick={() => onRemove(index)}
                disabled={disabled}
                size="small"
                color="error"
                aria-label="Remove regex rule"
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
