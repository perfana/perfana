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
import { authenticatedFetch } from '@/lib/api';
import { DashboardVariable, DashboardVariableOption } from '@/lib/types';
import { ApplicationDashboard, VariableValue } from './types';

interface EditDashboardDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (label: string, variables: VariableValue[]) => Promise<void>;
  dashboard: ApplicationDashboard | null;
  loading: boolean;
  systemName?: string;
  selectedEnvironment?: string;
}

export default function EditDashboardDialog({
  open,
  onClose,
  onSubmit,
  dashboard,
  loading,
  systemName,
  selectedEnvironment
}: EditDashboardDialogProps) {
  const [dashboardLabel, setDashboardLabel] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string[]>>({});
  const [variableOptions, setVariableOptions] = useState<Record<string, DashboardVariableOption[]>>({});
  const [loadingVariables, setLoadingVariables] = useState<Record<string, boolean>>({});

  // Helper function for auth headers

  // Function to fetch variable options from Grafana
  // Only the variable's name is used; callers pass either a stored
  // DashboardVariable or a Grafana templating variable, which lacks `values`.
  const fetchVariableOptions = async (variable: Pick<DashboardVariable, 'name'>, dashboard: ApplicationDashboard) => {
    if (!systemName || !selectedEnvironment) {
      console.warn('Missing systemName or selectedEnvironment for variable options fetch');
      return;
    }

    try {
      setLoadingVariables(prev => ({
        ...prev,
        [variable.name]: true
      }));

      const response = await authenticatedFetch(`/grafana/dashboards/variable-values`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grafanaDashboardId: dashboard.grafana_dashboard_id,
          variableName: variable.name,
          system: systemName,
          environment: selectedEnvironment,
          existingVariables: variableValues
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setVariableOptions(prev => ({
          ...prev,
          [variable.name]: data
        }));
      } else {
        console.error(`Failed to fetch values for variable ${variable.name}:`, response.statusText);
        setVariableOptions(prev => ({
          ...prev,
          [variable.name]: []
        }));
      }
      
    } catch (error) {
      console.error(`Error fetching values for variable ${variable.name}:`, error);
      setVariableOptions(prev => ({
        ...prev,
        [variable.name]: []
      }));
    } finally {
      setLoadingVariables(prev => ({
        ...prev,
        [variable.name]: false
      }));
    }
  };

  // Initialize form when dashboard or dialog state changes
  useEffect(() => {
    if (open && dashboard) {
      setDashboardLabel(dashboard.dashboard_label || '');
      
      // Initialize variable values from dashboard
      const initialVariableValues: Record<string, string[]> = {};
      if (dashboard.variables && Array.isArray(dashboard.variables)) {
        dashboard.variables.forEach((variable: DashboardVariable) => {
          initialVariableValues[variable.name] = variable.values || [];
        });
      }
      setVariableValues(initialVariableValues);
      setVariableOptions({});
      setLoadingVariables({});
      
      // Fetch variable options from Grafana
      if (dashboard.variables && Array.isArray(dashboard.variables) && systemName && selectedEnvironment) {
        dashboard.variables.forEach(async (variable: DashboardVariable) => {
          await fetchVariableOptions(variable, dashboard);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dashboard, systemName, selectedEnvironment]);

  const handleVariableChange = (variableName: string, values: string[]) => {
    setVariableValues(prev => ({
      ...prev,
      [variableName]: values
    }));
  };

  const handleSubmit = async () => {
    if (!dashboard || !dashboardLabel.trim()) return;

    const variables: VariableValue[] = Object.entries(variableValues).map(([name, values]) => ({
      name,
      values
    }));

    await onSubmit(dashboardLabel, variables);
  };

  if (!dashboard) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Dashboard Configuration
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            Dashboard: <strong>{dashboard.dashboard_name}</strong>
          </Typography>
          
          <TextField
            fullWidth
            label="Configuration Label"
            value={dashboardLabel}
            onChange={(e) => setDashboardLabel(e.target.value)}
            margin="normal"
            required
            helperText="A descriptive label for this dashboard configuration"
          />

          {/* Variables Configuration */}
          {dashboard.variables && Array.isArray(dashboard.variables) && dashboard.variables.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Dashboard Variables
              </Typography>
              
              {dashboard.variables.map((variable: DashboardVariable, index: number) => {
                const currentValues = variableValues[variable.name] || variable.values || [];
                const options = variableOptions[variable.name] || [];
                const isLoading = loadingVariables[variable.name] || false;

                // Add "All" option if includeAll is true
                const includeAll = variable.includeAll === true;
                const optionsWithAll = includeAll ? ['All', ...options] : options;

                // Default to ["All"] if no values selected and includeAll is true
                const effectiveValues = currentValues.length === 0 && includeAll ? ['All'] : currentValues;

                return (
                  <Box key={`${variable.name}-${index}`} sx={{ mt: 2 }}>
                    <Autocomplete
                      multiple
                      freeSolo
                      loading={isLoading}
                      options={optionsWithAll}
                      getOptionLabel={(option) => {
                        if (typeof option === 'string') return option;
                        return option.label;
                      }}
                      value={effectiveValues}
                      onChange={(_, newValue) => {
                        const stringValues = newValue.map(v => {
                          if (typeof v === 'string') return v;
                          return v.value;
                        });
                        handleVariableChange(variable.name, stringValues);
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={variable.name}
                          variant="outlined"
                          placeholder={`Select or enter ${variable.name} values`}
                          helperText={
                            options.length === 0 
                              ? `No options found from Grafana. You can manually type values and press Enter.`
                              : variable.query 
                                ? `Query: ${typeof variable.query === 'string' ? variable.query : variable.query.query}` 
                                : ''
                          }
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {isLoading ? <CircularProgress size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, tagIndex) => (
                          <Chip
                            variant="outlined"
                            label={typeof option === 'string' ? option : option.label || option.value}
                            size="small"
                            {...getTagProps({ index: tagIndex })}
                            key={typeof option === 'string' ? option : option.value}
                          />
                        ))
                      }
                    />
                  </Box>
                );
              })}
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
          disabled={!dashboardLabel.trim() || loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Updating...' : 'Update Configuration'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}