'use client';

import { FC, useState } from 'react';
import { TimePeriod, CustomTimeRange } from '@/hooks/useDashboardData';
import { Autocomplete, TextField, Box, Typography, Button, Alert } from '@mui/material';
import { Check } from '@mui/icons-material';

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  customTimeRange?: CustomTimeRange;
  onCustomTimeRangeChange?: (range: CustomTimeRange) => void;
  onApplyCustomRange?: () => void;
  loading?: boolean;
}

// Time range options matching TrendsCard
const timeRangeOptions = [
  { label: 'Last day', value: '24h' as TimePeriod },
  { label: 'Last week', value: '7d' as TimePeriod },
  { label: 'Last month', value: '30d' as TimePeriod },
  { label: 'All Time', value: 'all' as TimePeriod },
  { label: 'Custom', value: 'custom' as TimePeriod },
];

export const TimePeriodSelector: FC<TimePeriodSelectorProps> = ({
  value,
  onChange,
  customTimeRange,
  onCustomTimeRangeChange,
  onApplyCustomRange,
  loading
}) => {
  const selectedOption = timeRangeOptions.find(option => option.value === value) || timeRangeOptions[1];
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  const handleCustomTimeRangeChange = (field: 'from' | 'to', date: Date | null) => {
    if (!date || !onCustomTimeRangeChange || !customTimeRange) return;

    onCustomTimeRangeChange({
      ...customTimeRange,
      [field]: date
    });
    setShowSuccessMessage(false);
  };

  const handleApply = async () => {
    if (onApplyCustomRange) {
      setShowSuccessMessage(false);
      await onApplyCustomRange();
      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 3000);
    }
  };

  return (
    <Box>
      <Autocomplete
        options={timeRangeOptions}
        getOptionLabel={(option) => option.label}
        value={selectedOption}
        onChange={(_, newValue) => {
          newValue && onChange(newValue.value);
          setShowSuccessMessage(false);
        }}
        isOptionEqualToValue={(option, value) => option.value === value.value}
        sx={{ minWidth: 192 }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Time Range"
            variant="outlined"
            size="small"
          />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box component="li" key={key} {...otherProps}>
              <Typography variant="body1">{option.label}</Typography>
            </Box>
          );
        }}
      />

      {/* Custom Time Range Pickers */}
      {value === 'custom' && customTimeRange && onCustomTimeRangeChange && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="From"
              type="datetime-local"
              value={customTimeRange.from.toISOString().slice(0, 16)}
              onChange={(e) => handleCustomTimeRangeChange('from', new Date(e.target.value))}
              variant="outlined"
              size="small"
              fullWidth
              InputLabelProps={{
                shrink: true,
              }}
            />
            <TextField
              label="To"
              type="datetime-local"
              value={customTimeRange.to.toISOString().slice(0, 16)}
              onChange={(e) => handleCustomTimeRangeChange('to', new Date(e.target.value))}
              variant="outlined"
              size="small"
              fullWidth
              InputLabelProps={{
                shrink: true,
              }}
            />
          </Box>

          {onApplyCustomRange && (
            <Button
              variant="contained"
              size="small"
              startIcon={<Check />}
              onClick={handleApply}
              disabled={loading}
              sx={{
                mt: 1,
                width: '100%',
                textTransform: 'none',
              }}
            >
              {loading ? 'Refreshing...' : 'Refresh Data'}
            </Button>
          )}

          {showSuccessMessage && (
            <Alert severity="success" sx={{ mt: 1, py: 0 }}>
              <Typography variant="caption">
                Data refreshed successfully
              </Typography>
            </Alert>
          )}
        </Box>
      )}
    </Box>
  );
};
