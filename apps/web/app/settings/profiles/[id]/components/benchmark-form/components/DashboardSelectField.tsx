'use client';

import React, { useMemo } from 'react';
import {
  Grid,
  TextField,
  Autocomplete,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { ProfileDashboard } from '@/lib/profiles';
import {
  isPerfTestProfileDashboard,
  isDynatraceHostsProfileDashboard,
  isSplunkProfileDashboard,
  isPatternProfileDashboard,
  availablePseudoDashboards,
  ConfiguredIntegrations,
} from '@/lib/profile-benchmarks';

const pseudoDashboardDescription = (option: ProfileDashboard): string | null =>
  isPerfTestProfileDashboard(option)
    ? 'Applies to every performance-test scenario dashboard, including scenarios added in later runs'
    : isDynatraceHostsProfileDashboard(option)
      ? 'Applies to every mapped Dynatrace host, including hosts mapped later'
      : isSplunkProfileDashboard(option)
        ? "Applies to the panel with this title on every workload's Splunk dashboards, including panels added later"
        : null;

interface DashboardSelectFieldProps {
  profileDashboards: ProfileDashboard[];
  selectedDashboard: ProfileDashboard | null;
  onSelect: (dashboard: ProfileDashboard | null) => void;
  loading: boolean;
  error?: string;
  /** Gates the Dynatrace hosts and Splunk pseudo-dashboards. */
  configuredIntegrations: ConfiguredIntegrations;
}

export function DashboardSelectField({
  profileDashboards,
  selectedDashboard,
  onSelect,
  loading,
  error,
  configuredIntegrations,
}: DashboardSelectFieldProps) {
  const pseudoDashboards = useMemo(
    () => availablePseudoDashboards(configuredIntegrations, selectedDashboard),
    [configuredIntegrations, selectedDashboard],
  );
  return (
    <Grid size={{ xs: 12 }}>
      <Autocomplete
        options={[...profileDashboards, ...pseudoDashboards]}
        getOptionLabel={(option) =>
          isPatternProfileDashboard(option) ? option.dashboardName : `${option.dashboardName} (${option.grafanaLabel})`
        }
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={selectedDashboard}
        onChange={(_, newValue) => onSelect(newValue)}
        loading={loading}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Profile Dashboard"
            variant="outlined"
            fullWidth
            required
            error={!!error}
            helperText={error || `Select dashboard from profile (${profileDashboards.length + pseudoDashboards.length} available)`}
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
            <Box component="li" key={key} {...otherProps}>
              <Box>
                <Typography variant="body1">{option.dashboardName}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {pseudoDashboardDescription(option) ?? `${option.grafanaLabel} • UID: ${option.dashboardUid}`}
                </Typography>
              </Box>
            </Box>
          );
        }}
      />
    </Grid>
  );
}
