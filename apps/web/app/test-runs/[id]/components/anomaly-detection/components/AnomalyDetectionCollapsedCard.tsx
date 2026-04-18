import React, { useRef } from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  IconButton,
  Tooltip,
  _CircularProgress,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  ExpandMore,
  _WarningAmber,
  Delete,
  _CheckCircle,
  Error as _ErrorIcon,
} from '@mui/icons-material';
import { AnomalyData } from '../types';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';

interface AnomalyDetectionCollapsedCardProps {
  data: AnomalyData[];
  loading: boolean;
  _conclusionFilter: string;
  setConclusionFilter: (value: string) => void;
  onExpand: (tabIndex?: number) => void;
  onDelete?: () => void;
  testRun: any | null;
  dsAdaptConclusion?: unknown;
}

export default function AnomalyDetectionCollapsedCard({
  data: anomalyData,
  loading,
  _conclusionFilter,
  setConclusionFilter,
  onExpand,
  onDelete,
  testRun,
  dsAdaptConclusion
}: AnomalyDetectionCollapsedCardProps) {
  const theme = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const _pendingConclusionRef = useRef<string | null>(null);

  const handleAnomalyExpand = () => {
    const wasCollapsed = true;
    onExpand();

    // Auto-focus the card after expansion (only when expanding)
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="anomaly-detection-section-expanded"]');
        if (expandedCard) {
          expandedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };


  const hasAnyData = !loading && anomalyData.length > 0;
  const hasRegressions = hasAnyData && anomalyData.some(item => item.conclusion_label === 'regression');
  const hasStaleResults = hasAnyData && anomalyData.some(item => item.is_stale === true);
  const staleCount = hasAnyData ? anomalyData.filter(item => item.is_stale === true).length : 0;

  // Check for unresolved tracked regressions
  const hasTrackedRegressions = dsAdaptConclusion?.tracked_regressions?.length > 0;
  const trackedRegressionsCount = dsAdaptConclusion?.tracked_regressions?.length || 0;

  // Get unique conclusions that have data (exclude partial, incomparable, and no difference)
  const collapsedConclusions = hasAnyData
    ? [...new Set(anomalyData
        .map(item => item.conclusion_label)
        .filter(label => label &&
          !label.toLowerCase().startsWith('partial') &&
          label.toLowerCase() !== 'incomparable' &&
          label.toLowerCase() !== 'no difference'))]
    : [];

  // Get feedback state (supports both object and string formats)
  const feedbackState = (() => {
    // Primary condition: If meetsRequirement is false, don't show feedback chip
    if (testRun?.consolidated_result?.meetsRequirement === false) {
      return null;
    }

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
  })();

  // Calculate accent color based on anomaly detection result
  const getAccentColor = () => {
    const adaptResult = testRun?.consolidated_result?.adaptTestRunOK;
    if (adaptResult === false) return theme.palette.error.main;
    if (adaptResult === true) return theme.palette.success.main;
    if (!testRun?.completed) return theme.palette.warning.main;
    return theme.palette.primary.main;
  };

  // Check if card should be expandable
  const isExpandable = testRun?.status?.evaluatingAdapt !== 'NO_BASELINES_FOUND';

  const accentColor = getAccentColor();

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      data-testid="anomaly-detection-section-collapsed"
      elevation={0}
      sx={{
        cursor: isExpandable ? 'pointer' : 'default',
        height: '293px',
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: 'none',
        // Thin accent line at top only
        borderTop: `3px solid ${accentColor}`,
        // Subtle shadow for depth - stronger in dark mode
        boxShadow: (theme) => theme.palette.mode === 'dark'
          ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
          : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': isExpandable ? {
          transform: 'translateY(-4px)',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
        } : {}
      }}
      onClick={isExpandable ? handleAnomalyExpand : undefined}
    >
      <CardContent sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        p: 3,
        '&:last-child': { pb: 3 }
      }}>
        {/* SECTION 1: Header - Clean, minimal */}
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          mb={2}
          position="relative"
        >
          <Typography
            variant="subtitle1"
            component="h2"
            sx={{
              fontWeight: 600,
              color: 'text.secondary',
              fontSize: '0.875rem',
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            Anomaly Detection
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, position: 'absolute', right: 0 }}>
            {onDelete && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                size="small"
                sx={{
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.error.main, 0.1),
                    color: 'error.main',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <Delete fontSize="small" />
              </IconButton>
            )}
            {isExpandable && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleAnomalyExpand();
                }}
                size="small"
                sx={{
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: `${accentColor}15`,
                    color: accentColor,
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
            )}
          </Box>
        </Box>

        {/* SECTION 2: Primary KPI - Large numbers for visual hierarchy */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {testRun?.status?.evaluatingAdapt === 'NO_BASELINES_FOUND' ? (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <Typography
                sx={{
                  fontSize: '0.875rem',
                  color: 'text.secondary',
                }}
              >
                No previous results to compare with
              </Typography>
            </Box>
          ) : (
            <Box sx={{ py: 1 }}>
              <KPIDisplay
                value={loading ? '—' : anomalyData.filter(item => item.conclusion_label === 'regression').length}
                label="Regressions Detected"
                color={hasRegressions ? 'error' : 'success'}
                loading={loading}
              />
            </Box>
          )}

          {/* SECTION 3: Secondary Content - Soft Badges */}
          <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'center'
          }}>
            {hasAnyData && collapsedConclusions.length > 0 ? collapsedConclusions.map((conclusion) => {
              const conclusionCount = anomalyData.filter(item => item.conclusion_label === conclusion).length;
              const badgeColor = conclusion === 'regression' ? 'red' : conclusion === 'improvement' ? 'green' : 'blue';

              return (
                <SoftBadge
                  key={conclusion}
                  count={conclusionCount}
                  label={conclusion}
                  color={badgeColor}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConclusionFilter(conclusion);
                  }}
                />
              );
            }) : !hasAnyData && testRun?.status?.evaluatingAdapt !== 'NO_BASELINES_FOUND' ? (
              <>
                <SoftBadge label="Statistical Analysis" color="blue" />
                <SoftBadge label="Control Group Comparison" color="purple" />
              </>
            ) : null}

            {/* Stale Results Badge */}
            {hasStaleResults && (
              <Tooltip
                title={`${staleCount} outdated result${staleCount > 1 ? 's' : ''} - configuration changed since last analysis`}
                arrow
                placement="top"
              >
                <Box>
                  <SoftBadge
                    count={staleCount}
                    label="outdated"
                    color="orange"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAnomalyExpand();
                    }}
                  />
                </Box>
              </Tooltip>
            )}

            {/* Feedback Status Badges */}
            {feedbackState === 'tbd' && (
              <SoftBadge
                label="Feedback required"
                color="orange"
                onClick={(e) => {
                  e.stopPropagation();
                  setConclusionFilter('regression');
                }}
              />
            )}
            {feedbackState === 'accepted' && (
              <SoftBadge
                label="Accepted"
                color="green"
                onClick={(e) => {
                  e.stopPropagation();
                  setConclusionFilter('regression');
                }}
              />
            )}
            {feedbackState === 'denied' && (
              <SoftBadge
                label="Confirmed regression"
                color="red"
                onClick={(e) => {
                  e.stopPropagation();
                  setConclusionFilter('regression');
                }}
              />
            )}

            {/* Baseline Mode Badge */}
            {testRun?.adapt_config?.mode === 'BASELINE' && (
              <SoftBadge
                label="Baseline mode"
                color="blue"
              />
            )}

            {/* Changepoint Badge */}
            {testRun?.is_changepoint && (
              <SoftBadge
                label="Changepoint"
                color="blue"
              />
            )}

            {/* Unresolved Tracked Regressions Badge */}
            {hasTrackedRegressions && (
              <SoftBadge
                count={trackedRegressionsCount}
                label={`unresolved${trackedRegressionsCount > 1 ? '' : ''}`}
                color="red"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand(1);
                }}
              />
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}