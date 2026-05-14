'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Config } from 'plotly.js';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Alert,
  Typography,
  Box,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  ShowChart as ShowChartIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';

// Dynamically import Plot to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TimeSeriesDataPoint {
  time_bucket: string;
  avg_response_time: number | null;
  median_response_time: number | null;
  min_response_time: number | null;
  max_response_time: number | null;
  p90_response_time: number | null;
  p95_response_time: number | null;
  p99_response_time: number | null;
  total_count: number;
  passed_count: number;
  failed_count: number;
}

interface RequestTimeSeriesModalProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName: string;
  samplerName: string;
  showToast: (message: string) => void;
}

const AGGREGATION_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
];

type MetricType = 'avg_response_time' | 'median_response_time' | 'p90_response_time' | 'p95_response_time' | 'p99_response_time';

const METRIC_OPTIONS: { value: MetricType; label: string }[] = [
  { value: 'avg_response_time', label: 'Average' },
  { value: 'median_response_time', label: 'Median (P50)' },
  { value: 'p90_response_time', label: 'P90' },
  { value: 'p95_response_time', label: 'P95' },
  { value: 'p99_response_time', label: 'P99' },
];

export default function RequestTimeSeriesModal({
  open,
  onClose,
  testRunId,
  transactionName,
  samplerName,
  showToast,
}: RequestTimeSeriesModalProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TimeSeriesDataPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aggregationSeconds, setAggregationSeconds] = useState(5);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('avg_response_time');

  // Keyboard shortcut for Escape key
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (open) {
      window.addEventListener('keydown', handleKeyPress);
      return () => window.removeEventListener('keydown', handleKeyPress);
    }
  }, [open, onClose]);

  useEffect(() => {
    if (open && testRunId && transactionName && samplerName) {
      fetchTimeSeriesData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, testRunId, transactionName, samplerName, aggregationSeconds]);

  const fetchTimeSeriesData = async () => {
    setLoading(true);
    setError(null);

    try {
      const url = `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName)}/samplers/${encodeURIComponent(samplerName)}/timeseries?aggregationSeconds=${aggregationSeconds}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch time-series data');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load time-series data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAggregationChange = (event: SelectChangeEvent<number>) => {
    setAggregationSeconds(event.target.value as number);
  };

  const handleMetricChange = (event: SelectChangeEvent<string>) => {
    setSelectedMetric(event.target.value as MetricType);
  };

  const generatePlotlyData = () => {
    if (!data || data.length === 0) return [];

    const traces: Record<string, unknown>[] = [];

    // Response time trace
    traces.push({
      x: data.map(d => new Date(d.time_bucket)),
      y: data.map(d => d[selectedMetric]),
      name: 'Response Time',
      type: 'scatter',
      mode: 'lines+markers',
      line: {
        width: 2,
        color: 'rgb(31, 119, 180)',
      },
      marker: {
        size: 4,
        color: 'rgb(31, 119, 180)',
      },
      connectgaps: false,
      hovertemplate:
        '<b>Response Time</b><br>' +
        '<span style="font-size: 13px; font-weight: 600;">%{y:.2f} ms</span><br>' +
        '<span style="font-size: 11px; color: #666;">%{x|%H:%M:%S}</span><br>' +
        '<extra></extra>',
      yaxis: 'y',
    });

    // Passed requests rate (secondary Y-axis)
    traces.push({
      x: data.map(d => new Date(d.time_bucket)),
      y: data.map(d => d.passed_count / aggregationSeconds),
      name: 'Passed (req/s)',
      type: 'scatter',
      mode: 'lines',
      line: {
        width: 2,
        color: 'rgb(76, 175, 80)', // Green
      },
      hovertemplate:
        '<b>Passed</b><br>' +
        '<span style="font-size: 13px; font-weight: 600;">%{y:.3f} req/s</span><br>' +
        `<span style="font-size: 11px; color: #666;">(%{customdata} in ${aggregationSeconds}s)</span><br>` +
        '<extra></extra>',
      customdata: data.map(d => d.passed_count),
      yaxis: 'y2',
    });

    // Failed requests rate (secondary Y-axis)
    traces.push({
      x: data.map(d => new Date(d.time_bucket)),
      y: data.map(d => d.failed_count / aggregationSeconds),
      name: 'Failed (req/s)',
      type: 'scatter',
      mode: 'lines',
      line: {
        width: 2,
        color: 'rgb(244, 67, 54)', // Red
      },
      hovertemplate:
        '<b>Failed</b><br>' +
        '<span style="font-size: 13px; font-weight: 600;">%{y:.3f} req/s</span><br>' +
        `<span style="font-size: 11px; color: #666;">(%{customdata} in ${aggregationSeconds}s)</span><br>` +
        '<extra></extra>',
      customdata: data.map(d => d.failed_count),
      yaxis: 'y2',
    });

    return traces;
  };

  const selectedMetricLabel = METRIC_OPTIONS.find(m => m.value === selectedMetric)?.label || 'Average';

  const textColor = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0, 0, 0, 0.05)';
  const hoverBgColor = isDark ? '#1e293b' : 'white';

  const plotLayout = {
    title: {
      text: `${selectedMetricLabel} Response Time`,
      font: {
        size: 18,
        weight: 600,
        family: 'Roboto, sans-serif',
        color: textColor,
      },
      x: 0.05,
    },
    xaxis: {
      title: {
        text: 'Time',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      type: 'date' as const,
      gridcolor: gridColor,
      linecolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    yaxis: {
      title: {
        text: 'Response Time (ms)',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      gridcolor: gridColor,
      linecolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      color: textSecondary,
      tickfont: { color: textSecondary },
      side: 'left' as const,
    },
    yaxis2: {
      title: {
        text: 'Requests/s',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      overlaying: 'y' as const,
      side: 'right' as const,
      showgrid: false,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: hoverBgColor,
      bordercolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      font: { color: textColor },
    },
    showlegend: true,
    legend: {
      orientation: 'v' as const,
      x: 1.01,
      y: 1,
      font: { size: 12, color: textColor },
      bgcolor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      bordercolor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      borderwidth: 1,
    },
    margin: {
      l: 70,
      r: 180,
      t: 80,
      b: 70,
    },
    autosize: true,
    plot_bgcolor: isDark ? '#1e1e1e' : 'rgba(250, 250, 250, 1)',
    paper_bgcolor: isDark ? '#121212' : 'white',
    font: {
      color: textColor,
    },
  };

  const plotConfig = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `request_${samplerName}_${selectedMetricLabel.toLowerCase().replace(/\s+/g, '_')}`,
      width: 1920,
      height: 1080,
    },
    modeBarButtons: [
      [
        'toImage',
        {
          name: 'Copy to clipboard',
          icon: {
            width: 1792,
            height: 1792,
            path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
            transform: 'scale(0.8)'
          },
          click: function(gd: unknown) {
            // Convert plot to PNG blob and copy to clipboard
            const Plotly = (window as unknown as { Plotly?: { toImage: (gd: unknown, opts: Record<string, unknown>) => Promise<string> } }).Plotly;
            if (!Plotly) return;
            Plotly.toImage(gd, {
              format: 'png',
              width: (gd as { _fullLayout?: { width?: number } })._fullLayout?.width || 800,
              height: (gd as { _fullLayout?: { height?: number } })._fullLayout?.height || 400,
              scale: 2
            }).then((dataUrl: string) => {
              // Convert data URL to blob
              fetch(dataUrl)
                .then(res => res.blob())
                .then(blob => {
                  // Copy to clipboard using the modern Clipboard API
                  if (navigator.clipboard && 'write' in navigator.clipboard) {
                    return navigator.clipboard.write([
                      new ClipboardItem({
                        'image/png': blob
                      })
                    ]);
                  } else {
                    throw new Error('Clipboard API not supported');
                  }
                })
                .then(() => {
                  showToast('Graph copied to clipboard');
                })
                .catch((err: Error) => {
                  console.error('Failed to copy to clipboard:', err);
                  showToast('Failed to copy graph to clipboard');
                });
            });
          }
        }
      ]
    ],
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: { xs: '500px', md: '600px' },
          maxHeight: '90vh',
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
          pb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShowChartIcon color="primary" sx={{ fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.125rem' }}>
              Request Performance
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ ml: 4.5 }}>
            {samplerName}
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
              onChange={handleMetricChange}
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
              onChange={handleAggregationChange}
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
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '500px',
              gap: 2,
            }}
          >
            <CircularProgress size={48} thickness={4} />
            <Typography variant="body2" color="text.secondary">
              Loading performance data...
            </Typography>
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : !data || data.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <ShowChartIcon
              sx={{
                fontSize: 64,
                color: 'action.disabled',
                mb: 2,
              }}
            />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Data Available
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No time-series data found for this request
            </Typography>
          </Box>
        ) : (
          <Box sx={{ width: '100%', height: '550px' }}>
            <Plot
              data={generatePlotlyData() as unknown as import('plotly.js').Data[]}
              layout={plotLayout as unknown as import('plotly.js').Layout}
              config={plotConfig as Partial<Config>}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
