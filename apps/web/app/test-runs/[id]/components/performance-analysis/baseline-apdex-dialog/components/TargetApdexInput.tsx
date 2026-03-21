'use client';

import React from 'react';
import { Box, Typography, Slider, TextField, Chip } from '@mui/material';
import { getApdexColor, getApdexLabel, APDEX_SLIDER_MARKS } from '../types';

interface TargetApdexInputProps {
  targetApdex: number;
  onTargetApdexChange: (value: number) => void;
}

export function TargetApdexInput({
  targetApdex,
  onTargetApdexChange,
}: TargetApdexInputProps) {
  const handleSliderChange = (_: Event, value: number | number[]) => {
    onTargetApdexChange(value as number);
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
    </Box>
  );
}
