'use client';

import React from 'react';
import {
  Grid,
  TextField,
  Autocomplete,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { ProfileDashboard } from '@/lib/profiles';

interface DashboardSelectFieldProps {
  profileDashboards: ProfileDashboard[];
  selectedDashboard: ProfileDashboard | null;
  onSelect: (dashboard: ProfileDashboard | null) => void;
  loading: boolean;
  error?: string;
}

export function DashboardSelectField({
  profileDashboards,
  selectedDashboard,
  onSelect,
  loading,
  error,
}: DashboardSelectFieldProps) {
  return (
    <Grid size={{ xs: 12 }}>
      <Autocomplete
        options={profileDashboards}
        getOptionLabel={(option) => `${option.dashboardName} (${option.grafanaLabel})`}
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
            helperText={error || `Select dashboard from profile (${profileDashboards.length} available)`}
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
                  {option.grafanaLabel} • UID: {option.dashboardUid}
                </Typography>
              </Box>
            </Box>
          );
        }}
      />
    </Grid>
  );
}
