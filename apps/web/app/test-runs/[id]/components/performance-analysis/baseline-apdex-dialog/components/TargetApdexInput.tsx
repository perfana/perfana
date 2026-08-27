'use client';

import React from 'react';
import { Box, Typography, Slider, TextField, Chip, Tooltip } from '@mui/material';
import { getApdexColor, getApdexLabel, APDEX_SLIDER_MARKS, DEFAULT_MIN_SAMPLES } from '../types';

interface TargetApdexInputProps {
  targetApdex: number;
  onTargetApdexChange: (value: number) => void;
  minSamples: number;
  onMinSamplesChange: (value: number) => void;
}

export function TargetApdexInput({
  targetApdex,
  onTargetApdexChange,
  minSamples,
  onMinSamplesChange,
}: TargetApdexInputProps) {
  const handleSliderChange = (_: Event, value: number | number[]) => {
    onTargetApdexChange(value as number);
  };

  const handleMinSamplesInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 1000) {
      onMinSamplesChange(val);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0 && val <= 1) {
      onTargetApdexChange(val);
    }
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Target Apdex Score
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Set the desired Apdex score. The system will calculate thresholds needed to reach this target.
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 300, px: 1 }}>
          <Slider
            value={targetApdex}
            onChange={handleSliderChange}
            min={0}
            max={1}
            step={0.01}
            marks={APDEX_SLIDER_MARKS as unknown as { value: number; label: string }[]}
            valueLabelDisplay="auto"
            sx={{
              '& .MuiSlider-thumb': {
                backgroundColor: getApdexColor(targetApdex),
              },
              '& .MuiSlider-track': {
                backgroundColor: getApdexColor(targetApdex),
              },
              '& .MuiSlider-markLabel': {
                fontSize: '0.75rem',
              },
            }}
          />
        </Box>

        <Box sx={{ width: 100 }}>
          <TextField
            type="number"
            value={targetApdex.toFixed(2)}
            onChange={handleInputChange}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
            size="small"
            fullWidth
          />
        </Box>

        <Box sx={{ width: 120 }}>
          <Chip
            label={getApdexLabel(targetApdex)}
            sx={{
              backgroundColor: getApdexColor(targetApdex),
              color: '#fff',
              fontWeight: 600,
              width: '100%',
            }}
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 3 }}>
        <Tooltip title="Transactions with fewer successful samples than this are skipped. Lower it to get a ballpark threshold for rare transactions — with n samples the Apdex moves in steps of 0.5/n, so one slow outlier shifts the result.">
          <Box sx={{ width: 140 }}>
            <TextField
              label="Min samples"
              type="number"
              value={minSamples}
              onChange={handleMinSamplesInputChange}
              inputProps={{ min: 1, max: 1000, step: 1 }}
              size="small"
              fullWidth
            />
          </Box>
        </Tooltip>
        {minSamples < DEFAULT_MIN_SAMPLES && (
          <Typography variant="caption" color="warning.main">
            Below {DEFAULT_MIN_SAMPLES} samples the calculated thresholds are ballpark figures.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
