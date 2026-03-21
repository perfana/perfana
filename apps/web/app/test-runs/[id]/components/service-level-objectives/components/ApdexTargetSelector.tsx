'use client';

import { Box, Typography, Slider, TextField, Chip } from '@mui/material';
import { getApdexColor, getApdexLabel } from '../utils/apdex-utils';

interface ApdexTargetSelectorProps {
  targetApdex: number;
  onTargetApdexChange: (value: number) => void;
  onPreviewDataClear: () => void;
}

export function ApdexTargetSelector({
  targetApdex,
  onTargetApdexChange,
  onPreviewDataClear,
}: ApdexTargetSelectorProps) {
  const handleSliderChange = (_: Event, value: number | number[]) => {
    onTargetApdexChange(value as number);
    onPreviewDataClear();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0 && val <= 1) {
      onTargetApdexChange(val);
      onPreviewDataClear();
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
            marks={[
              { value: 0, label: '0.0' },
              { value: 0.5, label: '0.5' },
              { value: 0.7, label: '0.7' },
              { value: 0.85, label: '0.85' },
              { value: 0.94, label: '0.94' },
              { value: 1, label: '1.0' },
            ]}
            valueLabelDisplay="auto"
            sx={{
              '& .MuiSlider-thumb': { backgroundColor: getApdexColor(targetApdex) },
              '& .MuiSlider-track': { backgroundColor: getApdexColor(targetApdex) },
              '& .MuiSlider-markLabel': { fontSize: '0.75rem' },
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TextField
            type="number"
            value={targetApdex.toFixed(2)}
            onChange={handleInputChange}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
            size="small"
            sx={{ width: 100 }}
          />
          <Chip
            label={getApdexLabel(targetApdex)}
            size="small"
            sx={{
              backgroundColor: getApdexColor(targetApdex),
              color: '#fff',
              fontWeight: 600,
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}

export default ApdexTargetSelector;
