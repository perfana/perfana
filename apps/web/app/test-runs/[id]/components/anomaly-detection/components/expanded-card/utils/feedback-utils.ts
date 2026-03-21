/**
 * Utility functions for feedback state management
 */

import { TestRun } from '@/types/test-runs';
import { alpha, type Theme } from '@mui/material/styles';
import { AnomalyData } from '../../../types';
import type { FeedbackState } from '../types';

/**
 * Calculates the feedback state based on test run and anomaly data.
 * Supports both object and string formats for adapt_config.
 */
export function calculateFeedbackState(
  testRun: TestRun | null,
  anomalyData: AnomalyData[],
  loading: boolean
): FeedbackState {
  // Primary condition: If meetsRequirement is false, don't show feedback banner
  if (testRun?.consolidated_result?.meetsRequirement === false) {
    return null;
  }

  const hasAnyData = !loading && anomalyData.length > 0;
  const hasRegressions = hasAnyData && anomalyData.some(item => item.conclusion_label === 'regression');

  // Check for adapt_config object structure (new format)
  const differencesAccepted = testRun?.adapt_config?.differencesAccepted;
  if (differencesAccepted) {
    if (differencesAccepted === 'TBD' && hasRegressions) return 'tbd';
    if (differencesAccepted === 'ACCEPTED') return 'accepted';
    if (differencesAccepted === 'DENIED') return 'denied';
  }

  // Fallback to default behavior when no config exists
  if (!testRun?.adapt_config || (typeof testRun.adapt_config === 'object' && !differencesAccepted)) {
    // If no adapt_config is set and we have anomaly data (especially regressions),
    // default to showing TBD (feedback required)
    const shouldShowTbd = hasAnyData && hasRegressions;
    return shouldShowTbd ? 'tbd' : null;
  }

  // Legacy string format support
  if (typeof testRun.adapt_config === 'string') {
    const adaptConfig = testRun.adapt_config;
    if (adaptConfig === 'TBD' && hasRegressions) return 'tbd';
    if (adaptConfig === 'ACCEPTED') return 'accepted';
    if (adaptConfig === 'DENIED') return 'denied';
  }

  return null;
}

/**
 * Styles for the TBD feedback chip (theme-aware)
 */
export const tbdChipStyles = (theme: Theme) => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.light, 0.15)} 100%)`,
  border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
  color: 'warning.dark',
  fontWeight: 600,
  cursor: 'pointer',
  '&:hover': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.15)} 0%, ${alpha(theme.palette.warning.light, 0.2)} 100%)`,
    border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
    transform: 'translateY(-1px)',
    boxShadow: `0 4px 12px ${alpha(theme.palette.warning.main, 0.15)}`
  },
  transition: 'all 0.2s ease-in-out'
});

/**
 * Styles for the accepted feedback chip (theme-aware)
 */
export const acceptedChipStyles = (theme: Theme) => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.light, 0.15)} 100%)`,
  border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
  color: 'success.dark',
  fontWeight: 600,
});

/**
 * Styles for the denied feedback chip (theme-aware)
 */
export const deniedChipStyles = (theme: Theme) => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.error.light, 0.15)} 100%)`,
  border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
  color: 'error.dark',
  fontWeight: 600,
});

/**
 * Alert styles for different feedback states (theme-aware)
 */
export const alertStyles = {
  base: {
    mt: 2,
    mb: 3,
    '& .MuiAlert-message': {
      width: '100%'
    },
    '& .MuiAlert-icon': {
      alignSelf: 'center'
    }
  },
  accepted: (theme: Theme) => ({
    backgroundColor: alpha(theme.palette.success.main, 0.1),
  }),
  denied: (theme: Theme) => ({
    backgroundColor: alpha(theme.palette.error.main, 0.1),
  })
};
