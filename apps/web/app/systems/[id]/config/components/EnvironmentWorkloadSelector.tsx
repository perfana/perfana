import { useEffect } from 'react';
import {
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography
} from '@mui/material';

interface EnvironmentWorkloadSelectorProps {
  selectedEnvironment: string;
  selectedWorkload: string;
  availableEnvironments: string[];
  availableWorkloads: string[];
  onEnvironmentChange: (environment: string) => void;
  onWorkloadChange: (workload: string) => void;
  disabled?: boolean;
}

export default function EnvironmentWorkloadSelector({
  selectedEnvironment,
  selectedWorkload,
  availableEnvironments,
  availableWorkloads,
  onEnvironmentChange,
  onWorkloadChange,
  disabled = false
}: EnvironmentWorkloadSelectorProps) {
  // Auto-select workload if there's only one option
  useEffect(() => {
    if (selectedEnvironment && !selectedWorkload && availableWorkloads.length === 1) {
      onWorkloadChange(availableWorkloads[0]);
    }
  }, [selectedEnvironment, selectedWorkload, availableWorkloads, onWorkloadChange]);

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Configuration Scope
      </Typography>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth sx={{ minWidth: 250 }} disabled={disabled}>
            <InputLabel id="environment-select-label">Environment</InputLabel>
            <Select
              labelId="environment-select-label"
              id="environment-select"
              value={selectedEnvironment}
              label="Environment"
              onChange={(e) => onEnvironmentChange(e.target.value)}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 300,
                    width: 'auto',
                  },
                },
              }}
            >
              <MenuItem value="">
                <em>Select Environment</em>
              </MenuItem>
              {availableEnvironments.map((env) => (
                <MenuItem key={env} value={env}>
                  {env}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth sx={{ minWidth: 250 }} disabled={!selectedEnvironment || disabled}>
            <InputLabel id="workload-select-label">Workload</InputLabel>
            <Select
              labelId="workload-select-label"
              id="workload-select"
              value={selectedWorkload}
              label="Workload"
              onChange={(e) => onWorkloadChange(e.target.value)}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 300,
                    width: 'auto',
                  },
                },
              }}
            >
              <MenuItem value="">
                <em>Select Workload</em>
              </MenuItem>
              {availableWorkloads.map((workload) => (
                <MenuItem key={workload} value={workload}>
                  {workload}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    </Paper>
  );
}