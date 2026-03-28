'use client';

import { useState } from 'react';
import { Box, Typography, Chip, Button, IconButton, Tooltip, useTheme } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SyncIcon from '@mui/icons-material/Sync';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { createSparseMetricExclusion } from '@/lib/api/sparse-metric-exclusions';
import { getEvaluationStatusConfig, hasEvaluationError } from '../utils/test-run-formatters';

function ResultChip({ hasError, isPassed }: { hasError: boolean; isPassed: boolean }) {
  const colors = useResultChipColors(hasError, isPassed);
  const label = hasError ? 'Invalid' : (isPassed ? 'Pass' : 'Fail');
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        height: '26px',
        backgroundColor: colors.bg,
        border: colors.border,
        color: colors.color,
        fontWeight: 600,
        fontSize: '0.8125rem',
      }}
    />
  );
}

function useResultChipColors(isInvalid: boolean, isPassed: boolean) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  if (isInvalid) return {
    bg: isDark ? 'rgba(255, 183, 77, 0.2)' : 'rgba(255, 152, 0, 0.08)',
    border: isDark ? '1px solid rgba(255, 183, 77, 0.5)' : '1px solid rgba(255, 152, 0, 0.3)',
    color: isDark ? '#ffcc80' : '#ff9800',
  };
  if (isPassed) return {
    bg: isDark ? 'rgba(102, 187, 106, 0.2)' : 'rgba(76, 175, 80, 0.08)',
    border: isDark ? '1px solid rgba(102, 187, 106, 0.5)' : '1px solid rgba(76, 175, 80, 0.3)',
    color: isDark ? '#a5d6a7' : '#4caf50',
  };
  return {
    bg: isDark ? 'rgba(239, 83, 80, 0.2)' : 'rgba(244, 67, 54, 0.08)',
    border: isDark ? '1px solid rgba(239, 83, 80, 0.5)' : '1px solid rgba(244, 67, 54, 0.3)',
    color: isDark ? '#ef9a9a' : '#f44336',
  };
}

interface EvaluationResultsSectionProps {
  testRun: TestRun;
  onRefreshTriggered?: () => void;
  showToast?: (message: string) => void;
}

export function EvaluationResultsSection({ testRun, onRefreshTriggered, showToast }: EvaluationResultsSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(33, 150, 243, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(33, 150, 243, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#64b5f6' : '#2196f3',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#90caf9' : '#1976d2',
      }
    }}>
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: isDark ? '#90caf9' : '#2196f3',
          mb: 2.5,
        }}
      >
        Evaluation Results
      </Typography>

      <Box sx={{ display: 'grid', gap: 3 }}>
        {/* Overall */}
        <OverallResultSubsection testRun={testRun} />

        {/* Service Level Objectives */}
        <ServiceLevelObjectivesSubsection testRun={testRun} />

        {/* Anomaly Detection */}
        <AnomalyDetectionSubsection testRun={testRun} />

        {/* Data Quality Errors */}
        {testRun.valid === false && testRun.reasons_not_valid && testRun.reasons_not_valid.length > 0 && (
          <DataQualitySubsection
            testRun={testRun}
            reasons={testRun.reasons_not_valid}
            severity="error"
            onRefreshTriggered={onRefreshTriggered}
            showToast={showToast}
          />
        )}

        {/* Data Quality Warnings (informational) */}
        {testRun.data_warnings && testRun.data_warnings.length > 0 && (
          <DataQualitySubsection
            testRun={testRun}
            reasons={testRun.data_warnings}
            severity="warning"
            onRefreshTriggered={onRefreshTriggered}
            showToast={showToast}
          />
        )}
      </Box>
    </Box>
  );
}

function OverallResultSubsection({ testRun }: { testRun: TestRun }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const hasError = hasEvaluationError(testRun);

  return (
    <Box sx={{
      p: 2.5,
      backgroundColor: isDark ? 'rgba(33, 150, 243, 0.04)' : 'rgba(33, 150, 243, 0.02)',
      borderRadius: 2,
      border: '1px solid rgba(33, 150, 243, 0.12)',
    }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.8rem',
          fontWeight: 600,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: isDark ? '#90caf9' : '#2196f3',
          mb: 2,
        }}
      >
        Overall
      </Typography>

      {testRun.consolidated_result ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Result:
          </Typography>
          <ResultChip
            hasError={hasError}
            isPassed={!hasError && !!(testRun.consolidated_result.passed || testRun.consolidated_result.overall)}
          />
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          No result available
        </Typography>
      )}
    </Box>
  );
}

function ServiceLevelObjectivesSubsection({ testRun }: { testRun: TestRun }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isError = testRun.status?.evaluatingChecks === 'ERROR' || testRun.status?.evaluatingChecks === 'FAILED';

  return (
    <Box sx={{
      p: 2.5,
      backgroundColor: isDark ? 'rgba(103, 58, 183, 0.06)' : 'rgba(103, 58, 183, 0.02)',
      borderRadius: 2,
      border: '1px solid rgba(103, 58, 183, 0.12)',
    }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.8rem',
          fontWeight: 600,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: isDark ? '#ce93d8' : '#673ab7',
          mb: 2,
        }}
      >
        Service Level Objectives
      </Typography>

      {(testRun.consolidated_result?.meetsRequirement !== undefined || testRun.status?.evaluatingChecks) ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {testRun.consolidated_result?.meetsRequirement !== undefined && (
            <>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Result:
              </Typography>
              <ResultChip
                hasError={isError}
                isPassed={!isError && !!testRun.consolidated_result!.meetsRequirement}
              />
            </>
          )}

          {testRun.status?.evaluatingChecks && (
            <>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  ml: testRun.consolidated_result?.meetsRequirement !== undefined ? 2 : 0,
                }}
              >
                Status:
              </Typography>
              {(() => {
                const config = getEvaluationStatusConfig(testRun.status.evaluatingChecks, isDark);
                const Icon = config.icon;
                return (
                  <Chip
                    icon={<Icon sx={{ fontSize: '0.9rem' }} />}
                    label={config.label}
                    size="small"
                    sx={{
                      height: '26px',
                      backgroundColor: config.bgColor,
                      border: `1px solid ${config.borderColor}`,
                      color: config.color,
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      '& .MuiChip-icon': {
                        ml: 0.5,
                        color: config.color,
                      }
                    }}
                  />
                );
              })()}
            </>
          )}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          No data available
        </Typography>
      )}
    </Box>
  );
}

function AnomalyDetectionSubsection({ testRun }: { testRun: TestRun }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isError = testRun.status?.evaluatingAdapt === 'ERROR' || testRun.status?.evaluatingAdapt === 'FAILED';
  const sectionColor = isDark ? '#ffcc80' : '#ff9800';

  if (testRun.status?.evaluatingAdapt === 'NO_BASELINES_FOUND') {
    return (
      <Box sx={{
        p: 2.5,
        backgroundColor: isDark ? 'rgba(255, 152, 0, 0.04)' : 'rgba(255, 152, 0, 0.02)',
        borderRadius: 2,
        border: '1px solid rgba(255, 152, 0, 0.12)',
      }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.8rem',
            fontWeight: 600,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
            color: sectionColor,
            mb: 2,
          }}
        >
          Anomaly Detection
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          No previous results to compare with
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      p: 2.5,
      backgroundColor: isDark ? 'rgba(255, 152, 0, 0.04)' : 'rgba(255, 152, 0, 0.02)',
      borderRadius: 2,
      border: '1px solid rgba(255, 152, 0, 0.12)',
    }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.8rem',
          fontWeight: 600,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: sectionColor,
          mb: 2,
        }}
      >
        Anomaly Detection
      </Typography>

      {(testRun.consolidated_result?.adaptTestRunOK !== undefined || testRun.status?.evaluatingAdapt) ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {testRun.consolidated_result?.adaptTestRunOK !== undefined && (
            <>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Result:
              </Typography>
              <ResultChip
                hasError={isError}
                isPassed={!isError && !!testRun.consolidated_result!.adaptTestRunOK}
              />
            </>
          )}

          {testRun.status?.evaluatingAdapt && (
            <>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  ml: testRun.consolidated_result?.adaptTestRunOK !== undefined ? 2 : 0,
                }}
              >
                Status:
              </Typography>
              {(() => {
                const config = getEvaluationStatusConfig(testRun.status.evaluatingAdapt, isDark);
                const Icon = config.icon;
                return (
                  <Chip
                    icon={<Icon sx={{ fontSize: '0.9rem' }} />}
                    label={config.label}
                    size="small"
                    sx={{
                      height: '26px',
                      backgroundColor: config.bgColor,
                      border: `1px solid ${config.borderColor}`,
                      color: config.color,
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      '& .MuiChip-icon': {
                        ml: 0.5,
                        color: config.color,
                      }
                    }}
                  />
                );
              })()}
            </>
          )}

          {/* User Feedback Chip - show when results pass due to user marking as variability */}
          {testRun.consolidated_result?.adaptTestRunOK && testRun.adapt_config?.differencesAccepted === 'ACCEPTED' && (
            <Chip
              label="Accepted as variability"
              size="small"
              sx={{
                height: '26px',
                ml: 2,
                background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(102, 187, 106, 0.15) 100%)',
                border: '1px solid rgba(76, 175, 80, 0.3)',
                color: 'success.dark',
                fontWeight: 600,
                fontSize: '0.8125rem',
              }}
            />
          )}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          No data available
        </Typography>
      )}
    </Box>
  );
}

interface DataQualitySubsectionProps {
  testRun: TestRun;
  reasons: string[];
  severity?: 'error' | 'warning';
  onRefreshTriggered?: () => void;
  showToast?: (message: string) => void;
}

/**
 * Parse sparse data metrics from a reason string.
 * Format: "Sparse data: N metric(s) have fewer than M data points — Label / Name: X points (Ys timestep); ..."
 */
function parseSparseMetrics(reason: string): Array<{ dashboardLabel: string; metricName: string; detail: string }> {
  const dashIdx = reason.indexOf('—');
  if (dashIdx === -1) return [];

  const metricsStr = reason.slice(dashIdx + 1).trim();
  // Remove "and N more" suffix
  const cleaned = metricsStr.replace(/\s+and\s+\d+\s+more$/, '');
  const parts = cleaned.split(';').map(s => s.trim()).filter(Boolean);

  return parts.map(part => {
    // Format: "DashboardLabel / MetricName: X points (Ys timestep)"
    const slashIdx = part.indexOf(' / ');
    if (slashIdx === -1) return null;
    const dashboardLabel = part.slice(0, slashIdx).trim();
    const rest = part.slice(slashIdx + 3).trim();
    const colonIdx = rest.indexOf(':');
    const metricName = colonIdx !== -1 ? rest.slice(0, colonIdx).trim() : rest;
    const detail = colonIdx !== -1 ? rest.slice(colonIdx + 1).trim() : '';
    return { dashboardLabel, metricName, detail };
  }).filter((m): m is { dashboardLabel: string; metricName: string; detail: string } => m !== null);
}

function DataQualitySubsection({ testRun, reasons, severity = 'error', onRefreshTriggered, showToast }: DataQualitySubsectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isWarning = severity === 'warning';
  const sectionColor = isWarning
    ? (isDark ? '#90caf9' : '#42a5f5')
    : (isDark ? '#ffcc80' : '#ff9800');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dismissedMetrics, setDismissedMetrics] = useState<Set<string>>(new Set());
  const [reevaluateTriggered, setReevaluateTriggered] = useState(false);

  const systemName = testRun.systems_under_test?.name || testRun.system_under_test?.name;

  // Compute visible reasons — filter out sparse reasons where all metrics are dismissed
  const visibleReasons = reasons.filter(reason => {
    if (!reason.startsWith('Sparse data:')) return true;
    const metrics = parseSparseMetrics(reason);
    if (metrics.length === 0) return true; // unparseable, keep as-is
    return metrics.some(m => !dismissedMetrics.has(`${m.dashboardLabel}::${m.metricName}`));
  });

  const triggerReevaluate = async () => {
    if (reevaluateTriggered) return;
    setReevaluateTriggered(true);
    try {
      await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRunIds: [testRun.test_run_id] }),
      });
      // JobProgressIndicator will pick up the job and call refreshTestRun on completion
    } catch {
      // Non-critical — the user can still click "re-evaluate" manually
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      const response = await authenticatedFetch('/data/refresh/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testRunIds: [testRun.test_run_id],
          sources: { grafana: true, dynatrace: true, performanceMetrics: true },
        }),
      });

      if (response.status === 409) {
        const errorData = await response.json();
        showToast?.(errorData.message || 'Another job is already running for this test run');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to start refresh');
      }

      showToast?.('Fetch missing data and re-evaluate started');
      onRefreshTriggered?.();
    } catch {
      showToast?.('Failed to start refresh');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDismissMetric = async (dashboardLabel: string, metricName: string) => {
    if (!systemName) {
      showToast?.('Cannot dismiss: system name not available');
      return;
    }

    const key = `${dashboardLabel}::${metricName}`;

    try {
      await createSparseMetricExclusion({
        system: systemName,
        systemUnderTestId: testRun.system_under_test_id,
        environment: testRun.test_environment,
        workload: testRun.workload,
        dashboardLabel,
        metricName,
        reason: 'Dismissed from UI',
      });

      // Optimistically hide this metric after successful save
      setDismissedMetrics(prev => new Set(prev).add(key));
      showToast?.(`Excluded "${metricName}" from sparse data checks`);

      // Check if this was the last visible reason — if so, auto-trigger re-evaluate
      // We need to check what the state will be AFTER adding this key
      const nextDismissed = new Set(dismissedMetrics).add(key);
      const remainingReasons = reasons.filter(reason => {
        if (!reason.startsWith('Sparse data:')) return true;
        const metrics = parseSparseMetrics(reason);
        if (metrics.length === 0) return true;
        return metrics.some(m => !nextDismissed.has(`${m.dashboardLabel}::${m.metricName}`));
      });

      if (remainingReasons.length === 0) {
        showToast?.('All issues resolved — re-evaluating...');
        await triggerReevaluate();
      }
    } catch {
      showToast?.('Failed to exclude metric');
    }
  };

  // All reasons dismissed — hide the entire card
  if (visibleReasons.length === 0) return null;

  return (
    <Box sx={{
      p: 2.5,
      backgroundColor: isWarning
        ? (isDark ? 'rgba(33, 150, 243, 0.04)' : 'rgba(33, 150, 243, 0.02)')
        : (isDark ? 'rgba(255, 152, 0, 0.06)' : 'rgba(255, 152, 0, 0.03)'),
      borderRadius: 2,
      border: isWarning
        ? '1px solid rgba(33, 150, 243, 0.15)'
        : '1px solid rgba(255, 152, 0, 0.2)',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isWarning
            ? <InfoOutlinedIcon sx={{ fontSize: '1rem', color: sectionColor }} />
            : <WarningAmberRoundedIcon sx={{ fontSize: '1rem', color: sectionColor }} />
          }
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.8rem',
              fontWeight: 600,
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
              color: sectionColor,
            }}
          >
            {isWarning ? 'Data Notices' : 'Data Quality Issues'}
          </Typography>
        </Box>

        {!isWarning && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<SyncIcon sx={{ fontSize: '0.9rem !important' }} />}
          disabled={isRefreshing}
          onClick={handleRefresh}
          sx={{
            textTransform: 'none',
            fontSize: '0.75rem',
            fontWeight: 600,
            borderColor: isDark ? 'rgba(255, 183, 77, 0.4)' : 'rgba(255, 152, 0, 0.4)',
            color: sectionColor,
            py: 0.5,
            px: 1.5,
            '&:hover': {
              borderColor: sectionColor,
              backgroundColor: isDark ? 'rgba(255, 183, 77, 0.1)' : 'rgba(255, 152, 0, 0.08)',
            },
          }}
        >
          {isRefreshing ? 'Starting...' : 'Fetch missing data and re-evaluate'}
        </Button>
        )}
      </Box>

      <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {visibleReasons.map((reason, index) => {
          const isSparseReason = reason.startsWith('Sparse data:');
          const sparseMetrics = isSparseReason ? parseSparseMetrics(reason) : [];

          if (isSparseReason && sparseMetrics.length > 0) {
            const visibleMetrics = sparseMetrics.filter(
              m => !dismissedMetrics.has(`${m.dashboardLabel}::${m.metricName}`)
            );

            // Extract the prefix text (before the dash)
            const dashIdx = reason.indexOf('—');
            const prefix = dashIdx !== -1 ? reason.slice(0, dashIdx).trim() : reason;
            const hasMore = /and\s+\d+\s+more$/.test(reason);
            const moreMatch = reason.match(/and\s+(\d+)\s+more$/);

            return (
              <Box component="li" key={index} sx={{
                fontSize: '0.8125rem',
                color: 'text.secondary',
                lineHeight: 1.5,
                '&::marker': { color: sectionColor },
              }}>
                <Box>{prefix}</Box>
                <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {visibleMetrics.map((m) => {
                    const key = `${m.dashboardLabel}::${m.metricName}`;
                    return (
                      <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1 }}>
                        <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
                          {m.dashboardLabel} / {m.metricName}{m.detail ? `: ${m.detail}` : ''}
                        </Typography>
                        {systemName && (
                          <Tooltip title="Exclude this metric from sparse data checks for future test runs">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => handleDismissMetric(m.dashboardLabel, m.metricName)}
                                sx={{
                                  p: 0.25,
                                  color: isDark ? 'rgba(255, 183, 77, 0.6)' : 'rgba(255, 152, 0, 0.5)',
                                  '&:hover': {
                                    color: sectionColor,
                                    backgroundColor: isDark ? 'rgba(255, 183, 77, 0.1)' : 'rgba(255, 152, 0, 0.08)',
                                  },
                                }}
                              >
                                <VisibilityOffIcon sx={{ fontSize: '0.875rem' }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </Box>
                    );
                  })}
                  {hasMore && moreMatch && (
                    <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'text.secondary', pl: 1 }}>
                      and {moreMatch[1]} more
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }

          return (
            <Box
              component="li"
              key={index}
              sx={{
                fontSize: '0.8125rem',
                color: 'text.secondary',
                lineHeight: 1.5,
                '&::marker': { color: sectionColor },
              }}
            >
              {reason}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
