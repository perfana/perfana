'use client';

import {
  Box,
  Typography,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
} from '@mui/material';
import {
  Close as CloseIcon,
  ShowChart as ShowChartIcon,
} from '@mui/icons-material';
import type { MetricType } from '../types';
import { AGGREGATION_OPTIONS, METRIC_OPTIONS } from '../utils';

interface ModalHeaderProps {
  selectedMetric: MetricType;
  aggregationSeconds: number;
  onMetricChange: (event: SelectChangeEvent<string>) => void;
  onAggregationChange: (event: SelectChangeEvent<number>) => void;
  onClose: () => void;
}

export function ModalHeader({
  selectedMetric,
  aggregationSeconds,
  onMetricChange,
  onAggregationChange,
  onClose,
}: ModalHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', sm: 'center' },
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ShowChartIcon color="primary" sx={{ fontSize: 28 }} />
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.125rem' }}>
          Transaction Performance
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="metric-select-label">Metric Type</InputLabel>
          <Select
            labelId="metric-select-label"
            id="metric-select"
            value={selectedMetric}
            label="Metric Type"
            onChange={onMetricChange}
            aria-describedby="metric-helper-text"
          >
            {METRIC_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="aggregation-select-label">Aggregation</InputLabel>
          <Select
            labelId="aggregation-select-label"
            id="aggregation-select"
            value={aggregationSeconds}
            label="Aggregation"
            onChange={onAggregationChange}
          >
            {AGGREGATION_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            ml: 1,
            '&:hover': { bgcolor: 'action.hover' }
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
