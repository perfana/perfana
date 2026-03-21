'use client';

import {
  Box,
  Typography,
  CircularProgress,
  Switch,
  FormControlLabel,
  Collapse,
  Slider,
  TextField,
  Alert,
  Divider,
} from '@mui/material';
import { TestRunDetails, ExistingSlo } from '../types/apdex-config.types';
import { getApdexScoreLabel, getApdexScoreColor } from '../utils/apdex.utils';

interface SloConfigSectionProps {
  enableSlo: boolean;
  onEnableSloChange: (enabled: boolean) => void;
  minApdexScore: number;
  onMinApdexScoreChange: (score: number) => void;
  includeFailedRequests: boolean;
  onIncludeFailedRequestsChange: (include: boolean) => void;
  testRunDetails: TestRunDetails | null;
  existingSlo: ExistingSlo | null;
  loading: boolean;
  loadingTestRun: boolean;
  loadingSlo: boolean;
}

export function SloConfigSection({
  enableSlo,
  onEnableSloChange,
  minApdexScore,
  onMinApdexScoreChange,
  includeFailedRequests,
  onIncludeFailedRequestsChange,
  testRunDetails,
  existingSlo,
  loading,
  loadingTestRun,
  loadingSlo,
}: SloConfigSectionProps) {
  const handleSliderChange = (_: Event, value: number | number[]) => {
    onMinApdexScoreChange(value as number);
  };

  const handleTextFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0 && val <= 1) {
      onMinApdexScoreChange(val);
    }
  };

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            Apdex SLO (Service Level Objective)
          </Typography>
          {loadingSlo && <CircularProgress size={16} />}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Enable to create a pass/fail check for test runs based on Apdex score.
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={enableSlo}
              onChange={(e) => onEnableSloChange(e.target.checked)}
              disabled={loading || loadingTestRun || !testRunDetails}
            />
          }
          label={
            <Box>
              <Typography variant="body2">
                {existingSlo ? 'Enable Apdex SLO' : 'Create Apdex SLO'}
              </Typography>
              {existingSlo && (
                <Typography variant="caption" color="text.secondary">
                  SLO exists (min score: {existingSlo.min_apdex_score.toFixed(2)})
                </Typography>
              )}
            </Box>
          }
        />

        <Collapse in={enableSlo}>
          <Box sx={{ mt: 2, pl: 2, borderLeft: '3px solid', borderColor: 'primary.main' }}>
            <Typography variant="body2" gutterBottom>
              Minimum Apdex Score Required
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Slider
                value={minApdexScore}
                onChange={handleSliderChange}
                min={0}
                max={1}
                step={0.01}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => v.toFixed(2)}
                disabled={loading}
                sx={{ flex: 1 }}
              />
              <TextField
                type="number"
                value={minApdexScore}
                onChange={handleTextFieldChange}
                size="small"
                inputProps={{ min: 0, max: 1, step: 0.01 }}
                sx={{ width: 100 }}
                disabled={loading}
              />
            </Box>
            <Typography
              variant="caption"
              sx={{ color: getApdexScoreColor(minApdexScore), fontWeight: 'medium' }}
            >
              {getApdexScoreLabel(minApdexScore)} ({minApdexScore.toFixed(2)})
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={includeFailedRequests}
                  onChange={(e) => onIncludeFailedRequestsChange(e.target.checked)}
                  disabled={loading}
                />
              }
              label={
                <Typography variant="body2">
                  Include failed requests in calculation
                </Typography>
              }
              sx={{ mt: 2 }}
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
              When disabled, only successful requests count toward the Apdex score
            </Typography>

            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="caption">
                This SLO will apply to all future test runs with matching:
                <br />
                • System: {testRunDetails?.system_name || '...'}
                <br />
                • Environment: {testRunDetails?.test_environment || '...'}
                <br />
                • Workload: {testRunDetails?.workload || '...'}
              </Typography>
            </Alert>
          </Box>
        </Collapse>
      </Box>
    </>
  );
}
