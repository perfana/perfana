'use client';

import { TextField, CircularProgress, Autocomplete } from '@mui/material';
import { GrafanaDashboard } from '../types';

interface DashboardSelectProps {
  dashboards: GrafanaDashboard[];
  selectedDashboard: GrafanaDashboard | null;
  grafanaLabel: string;
  loading: boolean;
  disabled: boolean;
  onChange: (uid: string) => void;
}

/**
 * Dashboard autocomplete selection with Grafana dashboard data
 */
export function DashboardSelect({
  dashboards,
  selectedDashboard,
  grafanaLabel,
  loading,
  disabled,
  onChange,
}: DashboardSelectProps) {
  return (
    <Autocomplete
      options={dashboards}
      getOptionLabel={(option) => option.name}
      value={selectedDashboard}
      onChange={(_, newValue) => onChange(newValue?.uid || '')}
      loading={loading}
      disabled={disabled || !grafanaLabel}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Dashboard"
          required
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          helperText={
            selectedDashboard
              ? `UID: ${selectedDashboard.uid}`
              : 'Select a Grafana instance first'
          }
        />
      )}
    />
  );
}
