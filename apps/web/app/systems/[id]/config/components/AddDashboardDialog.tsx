import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Autocomplete,
  CircularProgress,
  Chip
} from '@mui/material';
import { GrafanaDashboard, VariableValue } from './types';
import { authenticatedFetch } from '@/lib/api';

interface AddDashboardDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (dashboardId: string, label: string, variables: VariableValue[]) => Promise<void>;
  availableDashboards: GrafanaDashboard[];
  systemName?: string;
  environment?: string;
  loading: boolean;
}

export default function AddDashboardDialog({
  open,
  onClose,
  onSubmit,
  availableDashboards,
  systemName,
  environment,
  loading
}: AddDashboardDialogProps) {
  const [selectedDashboard, setSelectedDashboard] = useState<GrafanaDashboard | null>(null);
  const [dashboardLabel, setDashboardLabel] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string[]>>({});
  const [variableOptions, setVariableOptions] = useState<Record<string, any[]>>({});
  const [loadingVariables, setLoadingVariables] = useState<Record<string, boolean>>({});

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedDashboard(null);
      setDashboardLabel('');
      setVariableValues({});
      setVariableOptions({});
      setLoadingVariables({});
    }
  }, [open]);

  const handleDashboardSelection = async (dashboard: GrafanaDashboard | null) => {
    setSelectedDashboard(dashboard);
    setDashboardLabel(dashboard ? `${dashboard.name} - ${environment}` : '');
    setVariableValues({});
    setVariableOptions({});
    setLoadingVariables({});
    
    if (dashboard && dashboard.templating_variables) {
      // Initialize variable values and start fetching options
      const initialValues: Record<string, string[]> = {};
      const initialLoading: Record<string, boolean> = {};
      
      dashboard.templating_variables.forEach(variable => {
        initialValues[variable.name] = [];
        initialLoading[variable.name] = true;
      });
      
      setVariableValues(initialValues);
      setLoadingVariables(initialLoading);
      
      // Fetch variable options from Grafana
      for (const variable of dashboard.templating_variables) {
        await fetchVariableOptions(variable, dashboard);
      }
    }
  };

  const handleVariableChange = (variableName: string, values: string[]) => {
    setVariableValues(prev => ({
      ...prev,
      [variableName]: values
    }));
  };

  const fetchVariableOptions = async (variable: any, dashboard: GrafanaDashboard) => {
    try {
      const response = await authenticatedFetch(`/grafana/dashboards/variable-values`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grafanaDashboardId: dashboard.id,
          variableName: variable.name,
          system: systemName,
          environment: environment,
          existingVariables: variableValues
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setVariableOptions(prev => ({
          ...prev,
          [variable.name]: data
        }));
        
        // Pre-select values based on configuration scope
        preSelectVariableValue(variable.name, data);
      } else {
        console.error(`Failed to fetch values for variable ${variable.name}:`, response.statusText);
        setVariableOptions(prev => ({
          ...prev,
          [variable.name]: []
        }));
        
        // Still attempt pre-selection even if no options are available
        preSelectVariableValue(variable.name, []);
      }
      
    } catch (error) {
      console.error(`Error fetching values for variable ${variable.name}:`, error);
      setVariableOptions(prev => ({
        ...prev,
        [variable.name]: []
      }));
      
      // Still attempt pre-selection even if there was an error
      preSelectVariableValue(variable.name, []);
    } finally {
      setLoadingVariables(prev => ({
        ...prev,
        [variable.name]: false
      }));
    }
  };

  const preSelectVariableValue = (variableName: string, options: any[]) => {
    // Check if this variable should be pre-selected based on configuration scope
    let preSelectedValue: string | null = null;
    
    // Priority 1: Pre-select system_under_test variable with systemName
    if (variableName === 'system_under_test' && systemName) {
      preSelectedValue = systemName;
    }
    
    // Priority 2: Pre-select test_environment variable with environment
    else if (variableName === 'test_environment' && environment) {
      preSelectedValue = environment;
    }
    
    // Priority 3: Auto-select if there's only one option available
    else if (options.length === 1) {
      const singleOption = options[0];
      preSelectedValue = typeof singleOption === 'string' 
        ? singleOption 
        : (singleOption.value || singleOption.label || singleOption);
      
      console.info(`Auto-selected single option "${preSelectedValue}" for variable "${variableName}"`);
    }
    
    if (preSelectedValue) {
      // Check if the value exists in the options (for validation)
      const optionExists = options.some(option => {
        const optionValue = typeof option === 'string' ? option : (option.value || option.label || option);
        return optionValue === preSelectedValue;
      });
      
      // Pre-select the value regardless of whether it exists in options (freeSolo allows custom values)
      setVariableValues(prev => ({
        ...prev,
        [variableName]: [preSelectedValue as string]
      }));
      
      if (!optionExists && options.length > 0) {
        console.info(`Pre-selected value "${preSelectedValue}" for variable "${variableName}" not found in fetched options, but setting anyway due to freeSolo mode.`);
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedDashboard || !dashboardLabel.trim()) return;

    const variables: VariableValue[] = Object.entries(variableValues).map(([name, values]) => ({
      name,
      values
    }));

    await onSubmit(selectedDashboard.id, dashboardLabel, variables);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Add Dashboard Configuration
        <Typography variant="body2" color="text.secondary">
          Configure a Grafana dashboard for {systemName} - {environment}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Dashboard Selection */}
          <Autocomplete
            options={availableDashboards}
            getOptionLabel={(option) => option.name}
            value={selectedDashboard}
            onChange={(_, newValue) => handleDashboardSelection(newValue)}
            loading={loading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Grafana Dashboard"
                variant="outlined"
                fullWidth
                sx={{ mb: 3 }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={option.id} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.uri} • {option.datasource_type}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />

          {/* Dashboard Label */}
          {selectedDashboard && (
            <TextField
              label="Dashboard Label"
              value={dashboardLabel}
              onChange={(e) => setDashboardLabel(e.target.value)}
              fullWidth
              sx={{ mb: 3 }}
              helperText="A descriptive label for this dashboard configuration"
            />
          )}

          {/* Templating Variables */}
          {selectedDashboard && selectedDashboard.templating_variables && selectedDashboard.templating_variables.length > 0 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Configure Variables
              </Typography>
              {selectedDashboard.templating_variables.map((variable) => (
                <Box key={variable.name} sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    {variable.name}
                    <Typography variant="body2" color="text.secondary" component="span" sx={{ ml: 1 }}>
                      ({variable.type})
                    </Typography>
                  </Typography>
                  
                  {loadingVariables[variable.name] ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', p: 2 }}>
                      <CircularProgress size={20} />
                      <Typography variant="body2" sx={{ ml: 1 }}>
                        Loading values...
                      </Typography>
                    </Box>
                  ) : (
                    <Autocomplete
                      multiple
                      freeSolo
                      options={variableOptions[variable.name] || []}
                      getOptionLabel={(option) => {
                        // Handle both string and object options
                        if (typeof option === 'string') return option;
                        return option.label || option.value || option;
                      }}
                      value={variableValues[variable.name] || []}
                      onChange={(_, newValue) => {
                        // Convert mixed array of strings and objects to array of strings
                        const stringValues = newValue.map(v => {
                          if (typeof v === 'string') return v;
                          return v.value || v.label || v;
                        });
                        handleVariableChange(variable.name, stringValues);
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          variant="outlined"
                          placeholder={`Select or enter ${variable.name} values`}
                          helperText={
                            variableOptions[variable.name]?.length === 0 
                              ? `No options found from Grafana. You can manually type values and press Enter.`
                              : variable.query 
                                ? `Query: ${typeof variable.query === 'string' ? variable.query : variable.query.query}` 
                                : ''
                          }
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            variant="outlined"
                            label={typeof option === 'string' ? option : option.label || option.value}
                            size="small"
                            {...getTagProps({ index })}
                            key={typeof option === 'string' ? option : option.value}
                          />
                        ))
                      }
                    />
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained"
          disabled={!selectedDashboard || !dashboardLabel.trim() || loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Adding...' : 'Add Dashboard'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}