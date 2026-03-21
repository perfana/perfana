'use client';

import React from 'react';
import { Box, Typography, Alert, Button, Chip } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import type { FeedbackBannerProps, FeedbackState } from '../types';
import {
  tbdChipStyles,
  acceptedChipStyles,
  deniedChipStyles,
  alertStyles,
} from '../utils';

interface FeedbackConfig {
  severity: 'warning' | 'success' | 'error';
  chipLabel: string;
  chipStylesFn: (theme: Theme) => object;
  message: string;
  alertBgFn?: (theme: Theme) => object;
  showRegressionButton: boolean;
  showVariabilityButton: boolean;
  showChangepointButton: boolean;
  chipClickable?: boolean;
}

const feedbackConfigs: Record<Exclude<FeedbackState, null>, FeedbackConfig> = {
  tbd: {
    severity: 'warning',
    chipLabel: 'User feedback required',
    chipStylesFn: tbdChipStyles,
    message: 'Without feedback this test will be added to the control group',
    showRegressionButton: true,
    showVariabilityButton: true,
    showChangepointButton: true,
    chipClickable: true,
  },
  accepted: {
    severity: 'success',
    chipLabel: 'Accepted as variability',
    chipStylesFn: acceptedChipStyles,
    message: 'The test run will be included in the control group',
    alertBgFn: alertStyles.accepted,
    showRegressionButton: true,
    showVariabilityButton: false,
    showChangepointButton: true,
  },
  denied: {
    severity: 'error',
    chipLabel: 'Confirmed as regression',
    chipStylesFn: deniedChipStyles,
    message: 'The test run will be excluded from the control group',
    alertBgFn: alertStyles.denied,
    showRegressionButton: false,
    showVariabilityButton: true,
    showChangepointButton: true,
    chipClickable: true,
  },
};

/**
 * Feedback banner component that displays different states
 * (TBD, accepted, denied) with appropriate styling and actions.
 */
export function FeedbackBanner({
  feedbackState,
  onMarkAsRegression,
  onMarkAsVariability,
  onMarkAsChangepoint,
}: FeedbackBannerProps) {
  const theme = useTheme();

  if (!feedbackState) {
    return null;
  }

  const config = feedbackConfigs[feedbackState];

  return (
    <Alert
      severity={config.severity}
      sx={{
        ...alertStyles.base,
        ...(config.alertBgFn && config.alertBgFn(theme)),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={config.chipLabel}
            size="small"
            onClick={config.chipClickable ? (e) => e.stopPropagation() : undefined}
            sx={config.chipStylesFn(theme)}
          />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {config.message}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
          {config.showRegressionButton && (
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={onMarkAsRegression}
            >
              Mark as Regression
            </Button>
          )}
          {config.showVariabilityButton && (
            <Button
              variant="outlined"
              size="small"
              color="success"
              onClick={onMarkAsVariability}
            >
              Mark as Variability
            </Button>
          )}
          {config.showChangepointButton && (
            <Button
              variant="outlined"
              size="small"
              color="info"
              onClick={onMarkAsChangepoint}
            >
              Mark as Changepoint
            </Button>
          )}
        </Box>
      </Box>
    </Alert>
  );
}
