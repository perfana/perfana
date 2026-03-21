'use client';

import {
  Box,
  Typography,
  Button,
  IconButton,
  Autocomplete,
  TextField,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { TrendsSeries, GRAFANA_UNITS } from '../types';
import { getSeriesColor } from '../utils';

interface TrendsAddedSeriesListProps {
  addedSeries: TrendsSeries[];
  onRemoveSeries: (seriesId: string) => void;
  onClearAllSeries: () => void;
  onUpdateSeriesUnit: (seriesId: string, newUnit: string | null) => void;
}

export function TrendsAddedSeriesList({
  addedSeries,
  onRemoveSeries,
  onClearAllSeries,
  onUpdateSeriesUnit
}: TrendsAddedSeriesListProps) {
  if (addedSeries.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Added Series ({addedSeries.length})
        </Typography>
        <Button
          size="small"
          color="error"
          onClick={onClearAllSeries}
          sx={{ textTransform: 'none' }}
        >
          Clear All
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {addedSeries.map((series, index) => (
          <Box
            key={series.id}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              backgroundColor: 'background.paper',
              transition: 'all 0.2s ease',
              '&:hover': {
                borderColor: 'primary.main',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
              }
            }}
          >
            {/* Color Indicator */}
            <Box
              sx={{
                width: 4,
                height: '100%',
                minHeight: 40,
                backgroundColor: getSeriesColor(index),
                borderRadius: 1,
                flexShrink: 0
              }}
            />

            {/* Series Info and Unit Selector */}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {series.metricName}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {series.dashboardLabel} / {series.panelTitle}
                </Typography>
              </Box>

              {/* Unit Selection Dropdown */}
              <Autocomplete
                options={[...GRAFANA_UNITS]}
                getOptionLabel={(option) => option.label}
                value={GRAFANA_UNITS.find(u => u.value === series.yAxisFormat) || null}
                onChange={(_, newValue) => onUpdateSeriesUnit(series.id, newValue?.value || null)}
                size="small"
                sx={{ maxWidth: 300 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Unit"
                    variant="outlined"
                    size="small"
                    helperText={
                      series.yAxisFormat
                        ? `Current: ${GRAFANA_UNITS.find(u => u.value === series.yAxisFormat)?.label || series.yAxisFormat}`
                        : 'No unit set - select to format values'
                    }
                  />
                )}
              />
            </Box>

            {/* Remove Button */}
            <IconButton
              size="small"
              onClick={() => onRemoveSeries(series.id)}
              sx={{
                color: 'error.main',
                '&:hover': {
                  backgroundColor: 'error.light',
                  color: 'error.dark'
                }
              }}
            >
              <Close fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
