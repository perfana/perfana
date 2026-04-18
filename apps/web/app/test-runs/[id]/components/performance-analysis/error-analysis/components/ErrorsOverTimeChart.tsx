'use client';

import { Box, Typography, Paper, Grid, useTheme } from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ErrorOverTime, ErrorOverTimeByCode } from '../types';
import { getColorForErrorCode, formatTimeBucket } from '../utils/error-formatters';
import ErrorsByCodeTable from './ErrorsByCodeTable';
import { ErrorByCode } from '../types';

interface ErrorsOverTimeChartProps {
  errorsOverTime: ErrorOverTime[];
  errorsOverTimeByCode: ErrorOverTimeByCode[];
  errorsByCode: ErrorByCode[];
}

export function ErrorsOverTimeChart({
  errorsOverTime,
  errorsOverTimeByCode,
  errorsByCode,
}: ErrorsOverTimeChartProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  // Extract unique response codes from the data
  const getResponseCodes = (): string[] => {
    const responseCodes = new Set<string>();
    errorsOverTimeByCode.forEach((dataPoint) => {
      Object.keys(dataPoint).forEach((key) => {
        if (key !== 'timeBucket') {
          responseCodes.add(key);
        }
      });
    });
    return Array.from(responseCodes).sort();
  };

  const hasGroupedData = errorsOverTimeByCode.length > 0;
  const chartData = hasGroupedData ? errorsOverTimeByCode : errorsOverTime;

  return (
    <Grid container spacing={2} sx={{ mb: 3, width: '100%' }}>
      {/* Errors Over Time Chart */}
      <Grid size={{ xs: 12, md: 9.6 }} sx={{ flex: { md: '1 1 80%' }, minWidth: 0 }}>
        <Paper
          sx={{
            p: 3,
            borderRadius: 3,
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ErrorIcon sx={{ mr: 1.5, color: 'error.main', fontSize: 28 }} />
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
              }}
            >
              Errors Over Time by Response Code
            </Typography>
          </Box>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'} />
              <XAxis
                dataKey="timeBucket"
                tickFormatter={formatTimeBucket}
                style={{ fontSize: '0.75rem' }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis
                style={{ fontSize: '0.75rem' }}
                label={{ value: 'Errors', angle: -90, position: 'insideLeft', style: { fontSize: '0.75rem' } }}
              />
              <RechartsTooltip
                labelFormatter={(value) => new Date(value as string).toLocaleString()}
                contentStyle={{
                  backgroundColor: isDark ? '#1e293b' : 'rgba(255, 255, 255, 0.98)',
                  border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(244, 67, 54, 0.3)'}`,
                  borderRadius: '8px',
                  boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.15)',
                  color: theme.palette.text.primary,
                }}
                labelStyle={{ color: theme.palette.text.primary }}
                itemStyle={{ color: theme.palette.text.secondary }}
              />
              <Legend />
              {hasGroupedData ? (
                // Display multiple lines, one per error code
                getResponseCodes().map((code) => {
                  const color = getColorForErrorCode(code);
                  return (
                    <Line
                      key={code}
                      type="monotone"
                      dataKey={code}
                      stroke={color}
                      strokeWidth={2.5}
                      name={`Error ${code}`}
                      dot={{ fill: color, strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  );
                })
              ) : (
                // Fallback to single line if grouped data not available
                <Line
                  type="monotone"
                  dataKey="errorsPerMinute"
                  stroke="rgba(244, 67, 54, 1)"
                  strokeWidth={3}
                  name="Total Errors per Minute"
                  dot={{ fill: 'rgba(244, 67, 54, 1)', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      </Grid>

      {/* Errors by Code */}
      <Grid size={{ xs: 12, md: 2.4 }} sx={{ flex: { md: '1 1 20%' }, minWidth: 0 }}>
        <ErrorsByCodeTable errorsByCode={errorsByCode} />
      </Grid>
    </Grid>
  );
}

export default ErrorsOverTimeChart;
