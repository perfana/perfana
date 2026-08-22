'use client';

import {
  Box,
  Typography,
  Button,
  IconButton,
  Autocomplete,
  TextField,
  Tooltip,
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
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="overline" color="text.secondary">
          Series ({addedSeries.length})
        </Typography>
        <Button size="small" color="error" onClick={onClearAllSeries} sx={{ textTransform: 'none' }}>
          Remove all
        </Button>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        {addedSeries.map((series, index) => (
          <Box
            key={series.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1.5,
              py: 0.75,
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'divider',
              '&:hover': { backgroundColor: 'action.hover' },
            }}
          >
            {/* Series colour — matches the chart trace */}
            <Box
              aria-hidden="true"
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: getSeriesColor(index),
                flexShrink: 0,
              }}
            />

            <Typography
              variant="body2"
              sx={{ fontWeight: 600, flex: '1 1 40%', minWidth: 0 }}
              noWrap
              title={series.metricName}
            >
              {series.metricName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flex: '1 1 30%', minWidth: 0, display: { xs: 'none', md: 'block' } }}
              noWrap
              title={`${series.dashboardLabel} / ${series.panelTitle}`}
            >
              {series.dashboardLabel} / {series.panelTitle}
            </Typography>

            {/* ponytail: unit picker inline — no helper text, the empty value says it */}
            <Autocomplete
              options={[...GRAFANA_UNITS]}
              getOptionLabel={(option) => option.label}
              value={GRAFANA_UNITS.find(u => u.value === series.yAxisFormat) || null}
              onChange={(_, newValue) => onUpdateSeriesUnit(series.id, newValue?.value || null)}
              size="small"
              sx={{ width: 220, flexShrink: 0 }}
              renderInput={(params) => (
                <TextField {...params} placeholder="No unit" variant="standard" size="small" />
              )}
            />

            <Tooltip title="Remove series">
              <IconButton
                size="small"
                aria-label={`Remove ${series.metricName}`}
                onClick={() => onRemoveSeries(series.id)}
                sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
              >
                <Close fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
