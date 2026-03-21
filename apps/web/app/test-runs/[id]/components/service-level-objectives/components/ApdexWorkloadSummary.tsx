'use client';

import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  InputAdornment,
  Chip,
  Tooltip,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
} from '@mui/icons-material';
import { BaselineWorkloadSummary, ApdexScope } from '../types/apdex-thresholds.types';
import { getThemedApdexColor } from '../utils/apdex-utils';

interface ApdexWorkloadSummaryProps {
  summary: BaselineWorkloadSummary;
  scope: ApdexScope;
  workloadThresholdOverride: number | null;
  onWorkloadThresholdOverride: (value: string) => void;
}

export function ApdexWorkloadSummary({
  summary,
  scope,
  workloadThresholdOverride,
  onWorkloadThresholdOverride,
}: ApdexWorkloadSummaryProps) {
  const theme = useTheme();

  return (
    <Card sx={{ mb: 3, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Workload Summary
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {/* Current Threshold */}
          <Box sx={{ minWidth: 130 }}>
            <Typography variant="body2" color="text.secondary">
              Current Threshold
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {summary.current_workload_threshold ?? 'N/A'}ms
            </Typography>
          </Box>

          {/* Calculated/Editable Threshold */}
          <Box sx={{ minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {scope === 'workload' ? 'Threshold (editable)' : 'Calculated Threshold'}
            </Typography>
            {scope === 'workload' ? (
              <Tooltip title="Edit to override calculated value" placement="top">
                <TextField
                  type="number"
                  size="small"
                  value={workloadThresholdOverride ?? summary.calculated_workload_threshold ?? ''}
                  onChange={(e) => onWorkloadThresholdOverride(e.target.value)}
                  InputProps={{
                    endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                  }}
                  inputProps={{ min: 1, max: 60000, step: 1 }}
                  sx={{
                    width: 120,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: workloadThresholdOverride !== null ? alpha(theme.palette.warning.light, 0.1) : undefined,
                    },
                  }}
                />
              </Tooltip>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" fontWeight={600} color="primary">
                  {summary.calculated_workload_threshold ?? 'N/A'}ms
                </Typography>
                {summary.calculated_workload_threshold !== null &&
                  summary.current_workload_threshold !== null && (
                    summary.calculated_workload_threshold > summary.current_workload_threshold ? (
                      <TrendingUpIcon color="warning" fontSize="small" />
                    ) : summary.calculated_workload_threshold < summary.current_workload_threshold ? (
                      <TrendingDownIcon color="success" fontSize="small" />
                    ) : null
                  )}
              </Box>
            )}
            {workloadThresholdOverride !== null && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                Modified (was: {summary.calculated_workload_threshold}ms)
              </Typography>
            )}
          </Box>

          {/* Transactions Count */}
          <Box sx={{ minWidth: 100 }}>
            <Typography variant="body2" color="text.secondary">
              Transactions
            </Typography>
            <Typography variant="body2">
              {summary.achievable_count} / {summary.total_transactions} achievable
            </Typography>
          </Box>

          {/* Current Apdex */}
          <Box sx={{ minWidth: 120 }}>
            <Typography variant="body2" color="text.secondary">
              Current Apdex
            </Typography>
            <Chip
              label={summary.current_workload_apdex?.toFixed(3) ?? 'N/A'}
              size="small"
              sx={{
                backgroundColor: getThemedApdexColor(summary.current_workload_apdex, theme),
                color: theme.palette.common.white,
                mt: 0.5,
              }}
            />
          </Box>

          {/* Projected Apdex */}
          <Box sx={{ minWidth: 120 }}>
            <Typography variant="body2" color="text.secondary">
              Projected Apdex
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip
                label={summary.projected_workload_apdex?.toFixed(3) ?? 'N/A'}
                size="small"
                sx={{
                  backgroundColor: getThemedApdexColor(summary.projected_workload_apdex, theme),
                  color: theme.palette.common.white,
                  mt: 0.5,
                }}
              />
              {summary.projected_workload_apdex !== null &&
                summary.current_workload_apdex !== null &&
                (summary.projected_workload_apdex > summary.current_workload_apdex ? (
                  <TrendingUpIcon color="success" fontSize="small" />
                ) : summary.projected_workload_apdex < summary.current_workload_apdex ? (
                  <TrendingDownIcon color="error" fontSize="small" />
                ) : null)}
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default ApdexWorkloadSummary;
