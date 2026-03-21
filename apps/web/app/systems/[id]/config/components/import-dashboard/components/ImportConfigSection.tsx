'use client';

import {
  Box,
  TextField,
  CircularProgress,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  SelectChangeEvent,
} from '@mui/material';
import { DynatraceConfig } from '../../../../../../../lib/dynatrace';
import { METRIC_UNIT_OPTIONS } from '../types';

interface ImportConfigSectionProps {
  dynatraceConfigs: DynatraceConfig[];
  loadingConfigs: boolean;
  selectedDynatraceConfigId: string;
  onDynatraceConfigChange: (id: string) => void;
  dashboardName: string;
  onDashboardNameChange: (name: string) => void;
  metricUnit: string;
  onMetricUnitChange: (unit: string) => void;
}

export function ImportConfigSection({
  dynatraceConfigs,
  loadingConfigs,
  selectedDynatraceConfigId,
  onDynatraceConfigChange,
  dashboardName,
  onDashboardNameChange,
  metricUnit,
  onMetricUnitChange,
}: ImportConfigSectionProps) {
  const handleDynatraceConfigChange = (event: SelectChangeEvent) => {
    onDynatraceConfigChange(event.target.value);
  };

  const handleMetricUnitChange = (event: SelectChangeEvent) => {
    onMetricUnitChange(event.target.value);
  };

  return (
    <>
      {/* Dynatrace Instance Selection */}
      <Box sx={{ mb: 3 }}>
        <FormControl size="small" fullWidth required>
          <InputLabel>Dynatrace Instance</InputLabel>
          <Select
            value={selectedDynatraceConfigId}
            label="Dynatrace Instance"
            onChange={handleDynatraceConfigChange}
            disabled={loadingConfigs}
          >
            {loadingConfigs ? (
              <MenuItem value="" disabled>
                <CircularProgress size={16} sx={{ mr: 1 }} /> Loading instances...
              </MenuItem>
            ) : dynatraceConfigs.length === 0 ? (
              <MenuItem value="" disabled>
                No Dynatrace instances configured
              </MenuItem>
            ) : (
              dynatraceConfigs.map(config => (
                <MenuItem key={config.id} value={config.id}>
                  {config.label}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Box>

      {/* Dashboard Name */}
      <Box sx={{ mb: 3 }}>
        <TextField
          label="Dashboard Name"
          value={dashboardName}
          onChange={e => onDashboardNameChange(e.target.value)}
          size="small"
          fullWidth
          placeholder="Enter dashboard name"
          helperText="Name to identify this dashboard in Perfana"
        />
      </Box>

      {/* Metric Unit */}
      <Box sx={{ mb: 3 }}>
        <FormControl size="small" fullWidth>
          <InputLabel>Metric Unit</InputLabel>
          <Select
            value={metricUnit}
            label="Metric Unit"
            onChange={handleMetricUnitChange}
          >
            {METRIC_UNIT_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </>
  );
}
