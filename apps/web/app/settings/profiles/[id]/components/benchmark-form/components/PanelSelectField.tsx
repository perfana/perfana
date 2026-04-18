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
import { GrafanaPanel } from '../types';

interface PanelSelectFieldProps {
  panels: GrafanaPanel[];
  selectedPanel: GrafanaPanel | null;
  onSelect: (panel: GrafanaPanel | null) => void;
  loading: boolean;
  error?: string;
  dashboardName?: string;
}

export function PanelSelectField({
  panels,
  selectedPanel,
  onSelect,
  loading,
  error,
  dashboardName,
}: PanelSelectFieldProps) {
  return (
    <Grid size={{ xs: 12 }}>
      <Autocomplete
        options={panels}
        getOptionLabel={(option) => option.title}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={selectedPanel}
        onChange={(_, newValue) => onSelect(newValue)}
        loading={loading}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Metric"
            variant="outlined"
            fullWidth
            required
            error={!!error}
            helperText={
              error ||
              (loading ? 'Loading metrics...' : `Select metric from ${dashboardName || 'dashboard'}`)
            }
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
                <Typography variant="body1">{option.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Type: {option.type} • ID: {option.id}
                </Typography>
              </Box>
            </Box>
          );
        }}
      />
    </Grid>
  );
}
