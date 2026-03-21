'use client';

import {
  Box,
  Autocomplete,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import { RelatedTestRun } from '../types';
import {
  getTestRunDisplayText,
  getTestRunSecondaryInfo,
} from '../utils/pyroscope-formatters';

interface PyroscopeBaselineSelectorProps {
  relatedTestRuns: RelatedTestRun[];
  selectedBaseline: RelatedTestRun | null;
  onBaselineChange: (baseline: RelatedTestRun | null) => void;
  loading: boolean;
}

export function PyroscopeBaselineSelector({
  relatedTestRuns,
  selectedBaseline,
  onBaselineChange,
  loading,
}: PyroscopeBaselineSelectorProps) {
  const getHelperText = () => {
    if (relatedTestRuns.length === 0) {
      return 'No related test runs with valid timestamps available';
    }
    if (selectedBaseline) {
      return `Comparing with: ${selectedBaseline.test_run_id}`;
    }
    return `Select from ${relatedTestRuns.length} available test runs`;
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr' },
        gap: 2,
        mb: 3,
      }}
    >
      <Autocomplete
        fullWidth
        size="small"
        options={relatedTestRuns}
        getOptionLabel={getTestRunDisplayText}
        value={selectedBaseline}
        onChange={(_event, newValue) => onBaselineChange(newValue)}
        loading={loading}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Baseline Test Run"
            helperText={getHelperText()}
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
          const secondaryInfo = getTestRunSecondaryInfo(option);
          return (
            <Box component="li" key={key} {...otherProps}>
              <Box>
                <Typography variant="body2">
                  {getTestRunDisplayText(option)}
                </Typography>
                {secondaryInfo && (
                  <Typography variant="caption" color="text.secondary">
                    {secondaryInfo}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
}
