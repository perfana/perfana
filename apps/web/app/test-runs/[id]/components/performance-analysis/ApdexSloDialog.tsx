'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Switch,
  FormControlLabel,
  Slider,
  TextField,
} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

interface TestRunDetails {
  system_under_test_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
}

interface ExistingSlo {
  id: string;
  min_apdex_score: number;
  include_failed_requests: boolean;
  exclude_ramp_up_time: boolean;
  enabled: boolean;
  apdex_threshold_ms?: number;
}

interface ApdexSloDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  currentThreshold: number; // Current threshold for the workload
  onSuccess: () => void;
}

/**
 * Dialog for configuring Apdex SLO (Service Level Objective) at workload level.
 * Extracted from the combined ApdexConfigDialog for single-purpose use.
 */
export default function ApdexSloDialog({
  open,
  onClose,
  testRunId,
  currentThreshold,
  onSuccess,
}: ApdexSloDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // SLO-related state
  const [enableSlo, setEnableSlo] = useState(false);
  const [minApdexScore, setMinApdexScore] = useState<number>(0.85);
  const [includeFailedRequests, setIncludeFailedRequests] = useState(false);
  const [excludeRampUpTime, setExcludeRampUpTime] = useState(true);
  const [testRunDetails, setTestRunDetails] = useState<TestRunDetails | null>(null);
  const [loadingTestRun, setLoadingTestRun] = useState(false);
  const [existingSlo, setExistingSlo] = useState<ExistingSlo | null>(null);
  const [loadingSlo, setLoadingSlo] = useState(false);

  // Fetch test run details when dialog opens
  useEffect(() => {
    if (open) {
      // Reset state when dialog opens
      setError(null);
      setSuccess(false);
      setEnableSlo(false);
      setMinApdexScore(0.85);
      setIncludeFailedRequests(false);
      setExcludeRampUpTime(true);
      setTestRunDetails(null);
      setExistingSlo(null);

      // Fetch test run details for SLO creation
      fetchTestRunDetails();
    }
  }, [open, testRunId]);

  // When we have test run details, check for existing SLO
  useEffect(() => {
    if (testRunDetails && open) {
      checkExistingSlo();
    }
  }, [testRunDetails, open]);

  const fetchTestRunDetails = async () => {
    try {
      setLoadingTestRun(true);
      const response = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (response.ok) {
        const data = await response.json();
        setTestRunDetails({
          system_under_test_id: data.system_under_test_id,
          system_name: data.system_name || data.systems_under_test?.name || data.system_under_test_id,
          test_environment: data.test_environment,
          workload: data.workload,
        });
      }
    } catch (err) {
      console.error('Error fetching test run details:', err);
    } finally {
      setLoadingTestRun(false);
    }
  };

  const checkExistingSlo = async () => {
    if (!testRunDetails) return;

    try {
      setLoadingSlo(true);
      // Query benchmarks to find existing Apdex SLO for this configuration
      const params = new URLSearchParams({
        systemUnderTestId: testRunDetails.system_under_test_id,
        testEnvironment: testRunDetails.test_environment,
        workload: testRunDetails.workload,
        benchmarkType: 'apdex',
      });

      const response = await authenticatedFetch(`/benchmarks?${params}`);
      if (response.ok) {
        const benchmarks = await response.json();
        // Find workload-level SLO (no transaction_name)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchingSlo = benchmarks.find((b: any) => !b.transaction_name);

        if (matchingSlo) {
          setExistingSlo({
            id: matchingSlo.id,
            min_apdex_score: matchingSlo.min_apdex_score || 0.85,
            include_failed_requests: matchingSlo.include_failed_requests || false,
            exclude_ramp_up_time: matchingSlo.exclude_ramp_up_time !== false,
            enabled: matchingSlo.enabled !== false,
            apdex_threshold_ms: matchingSlo.apdex_threshold_ms,
          });
          setEnableSlo(matchingSlo.enabled !== false);
          setMinApdexScore(matchingSlo.min_apdex_score || 0.85);
          setIncludeFailedRequests(matchingSlo.include_failed_requests || false);
          setExcludeRampUpTime(matchingSlo.exclude_ramp_up_time !== false);
        }
      }
    } catch (err) {
      console.error('Error checking existing SLO:', err);
    } finally {
      setLoadingSlo(false);
    }
  };

  const handleSave = async () => {
    // Validate SLO score
    if (enableSlo && (minApdexScore < 0 || minApdexScore > 1)) {
      setError('Minimum Apdex score must be between 0 and 1');
      return;
    }

    if (!testRunDetails) {
      setError('Test run details not loaded');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (enableSlo) {
        if (existingSlo) {
          // Update existing SLO
          const updateResponse = await authenticatedFetch(`/benchmarks/apdex/${existingSlo.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              minApdexScore: minApdexScore,
              apdexThresholdMs: currentThreshold,
              includeFailedRequests: includeFailedRequests,
              excludeRampUpTime: excludeRampUpTime,
              enabled: true,
            }),
          });

          if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(errorData.message || 'Failed to update Apdex SLO');
          }
        } else {
          // Create new SLO (workload level only)
          const createResponse = await authenticatedFetch('/benchmarks/apdex', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              systemUnderTestId: testRunDetails.system_under_test_id,
              testEnvironment: testRunDetails.test_environment,
              workload: testRunDetails.workload,
              minApdexScore: minApdexScore,
              apdexThresholdMs: currentThreshold,
              includeFailedRequests: includeFailedRequests,
              excludeRampUpTime: excludeRampUpTime,
            }),
          });

          if (!createResponse.ok) {
            const errorData = await createResponse.json();
            throw new Error(errorData.message || 'Failed to create Apdex SLO');
          }
        }
      } else if (existingSlo) {
        // Disable existing SLO when toggle is off, preserving any
        // excludeRampUpTime edit the user made in the same save.
        const updateResponse = await authenticatedFetch(`/benchmarks/apdex/${existingSlo.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            enabled: false,
            excludeRampUpTime,
          }),
        });

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json();
          throw new Error(errorData.message || 'Failed to disable Apdex SLO');
        }
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Error saving SLO configuration:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to save SLO configuration'
      );
    } finally {
      setLoading(false);
    }
  };

  const getApdexScoreLabel = (score: number): string => {
    if (score >= 0.94) return 'Excellent';
    if (score >= 0.85) return 'Good';
    if (score >= 0.7) return 'Fair';
    if (score >= 0.5) return 'Poor';
    return 'Unacceptable';
  };

  const getApdexScoreColor = (score: number): string => {
    if (score >= 0.94) return '#2e8b57';
    if (score >= 0.85) return '#4caf50';
    if (score >= 0.7) return '#ff9800';
    if (score >= 0.5) return '#ff5722';
    return '#f44336';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Set Apdex SLO</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Loading state */}
          {(loadingTestRun || loadingSlo) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Loading configuration...
              </Typography>
            </Box>
          )}

          {/* Info section */}
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Apdex SLO</strong> creates a pass/fail check for test runs based on Apdex score.
              All transactions in the workload must meet the minimum score for the SLO to pass.
            </Typography>
          </Alert>

          {/* Current threshold info */}
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              Current Apdex threshold: <strong>{currentThreshold}ms</strong>
            </Typography>
          </Alert>

          {/* Enable SLO toggle */}
          <FormControlLabel
            control={
              <Switch
                checked={enableSlo}
                onChange={(e) => setEnableSlo(e.target.checked)}
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
            sx={{ mb: 2 }}
          />

          {/* SLO Configuration (shown when enabled) */}
          {enableSlo && (
            <Box sx={{ pl: 2, borderLeft: '3px solid', borderColor: 'primary.main' }}>
              {/* Min Apdex Score */}
              <Typography variant="body2" gutterBottom>
                Minimum Apdex Score Required
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Slider
                  value={minApdexScore}
                  onChange={(_, value) => setMinApdexScore(value as number)}
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
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 1) {
                      setMinApdexScore(val);
                    }
                  }}
                  size="small"
                  inputProps={{ min: 0, max: 1, step: 0.01 }}
                  sx={{ width: 100 }}
                  disabled={loading}
                />
              </Box>
              <Typography
                variant="caption"
                sx={{ color: getApdexScoreColor(minApdexScore), fontWeight: 'medium', display: 'block', mb: 2 }}
              >
                {getApdexScoreLabel(minApdexScore)} ({minApdexScore.toFixed(2)})
              </Typography>

              {/* Include Failed Requests */}
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={includeFailedRequests}
                    onChange={(e) => setIncludeFailedRequests(e.target.checked)}
                    disabled={loading}
                  />
                }
                label={
                  <Typography variant="body2">
                    Include failed requests in calculation
                  </Typography>
                }
                sx={{ mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mb: 2 }}>
                When disabled, only successful requests count toward the Apdex score
              </Typography>

              {/* Exclude Ramp-Up Time */}
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={excludeRampUpTime}
                    onChange={(e) => setExcludeRampUpTime(e.target.checked)}
                    disabled={loading}
                  />
                }
                label={
                  <Typography variant="body2">
                    Exclude ramp-up period from calculation
                  </Typography>
                }
                sx={{ mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mb: 2 }}>
                When enabled, requests issued during the ramp-up phase are ignored
              </Typography>

              {/* Scope info */}
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
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              SLO configuration saved successfully!
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading || success || loadingTestRun || !testRunDetails}
          startIcon={loading && <CircularProgress size={16} />}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
