'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import { CompareArrows } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import {
  compareTraces,
  type TraceAnalysisResponse,
  type CompareTracesParams,
} from '@/lib/trace-analysis-api';
import TraceAnalysisReport from './TraceAnalysisReport';

interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  completed: boolean;
  application_release?: string;
  start_time?: string;
  end_time?: string;
  annotations?: string[];
}

interface TracesDiffTabProps {
  testRun: {
    id: string;
    test_run_id: string;
    system_under_test_id: string;
    start_time: string;
    end_time: string;
    test_environment: string;
    workload: string;
    systems_under_test?: {
      name: string;
    };
  };
  tracingInstanceId: string;
  serviceName: string;
  scenario: string;
  transaction: string;
  sampler: string | null;
  onSamplerChange?: (sampler: string | null) => void;
}

/**
 * TracesDiffTab component for comparing traces between test runs
 */
export default function TracesDiffTab({
  testRun,
  tracingInstanceId,
  serviceName,
  scenario,
  transaction,
  sampler,
  onSamplerChange,
}: TracesDiffTabProps) {
  // State
  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [selectedBaseline, setSelectedBaseline] = useState<RelatedTestRun | null>(null);
  const [fetchingBaselines, setFetchingBaselines] = useState(false);

  const [analysisResult, setAnalysisResult] = useState<TraceAnalysisResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if we should auto-compare after sampler change (drill-down)
  const [pendingDrillDown, setPendingDrillDown] = useState<string | null>(null);

  // Auto-trigger comparison when drill-down completes (sampler prop updated)
  useEffect(() => {
    if (pendingDrillDown && sampler === pendingDrillDown && selectedBaseline) {
      setPendingDrillDown(null);
      // Trigger comparison with the new sampler
      triggerCompare(pendingDrillDown);
    }
  }, [sampler, pendingDrillDown, selectedBaseline]);

  // Load related test runs on mount
  useEffect(() => {
    loadRelatedTestRuns();
  }, []);

  const loadRelatedTestRuns = async (): Promise<void> => {
    try {
      setFetchingBaselines(true);
      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRun.test_run_id}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({
          system,
          environment,
          workload,
        });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();

        // Filter to only include completed test runs with valid timestamps
        const validTestRuns = (data || []).filter(
          (tr: RelatedTestRun) => tr.completed && tr.start_time && tr.end_time
        );

        setRelatedTestRuns(validTestRuns);
      } else {
        console.warn('Failed to fetch related test runs');
        setRelatedTestRuns([]);
      }
    } catch (err) {
      console.error('Failed to fetch related test runs:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch related test runs'
      );
      setRelatedTestRuns([]);
    } finally {
      setFetchingBaselines(false);
    }
  };

  // Core comparison function that accepts sampler parameter
  const triggerCompare = async (samplerOverride?: string | null): Promise<void> => {
    if (!selectedBaseline || !selectedBaseline.start_time || !selectedBaseline.end_time) {
      setError('Please select a baseline test run with valid timestamps');
      return;
    }

    try {
      setAnalyzing(true);
      setError(null);
      setAnalysisResult(null);

      // Use override if provided, otherwise use prop
      const effectiveSampler = samplerOverride !== undefined ? samplerOverride : sampler;

      const params: CompareTracesParams = {
        currentTestRunId: testRun.test_run_id,
        baselineTestRunId: selectedBaseline.test_run_id,
        tracingInstanceId,
        serviceName,
        scenario,
        transaction,
        sampler: effectiveSampler || undefined,
        currentStartTime: testRun.start_time,
        currentEndTime: testRun.end_time,
        baselineStartTime: selectedBaseline.start_time,
        baselineEndTime: selectedBaseline.end_time,
      };

      const result = await compareTraces(params);
      setAnalysisResult(result);

      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      console.error('Trace comparison failed:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to compare traces'
      );
    } finally {
      setAnalyzing(false);
    }
  };

  // Handler for manual compare button
  const handleCompare = (): void => {
    triggerCompare();
  };

  // Helper function to format test run display text
  const getTestRunDisplayText = (testRun: RelatedTestRun): string => {
    const startTime = testRun.start_time || testRun.created_at;
    const formattedTime = new Date(startTime).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${testRun.test_run_id} - ${formattedTime}`;
  };

  // Helper function to get test run secondary info
  const getTestRunSecondaryInfo = (testRun: RelatedTestRun): string => {
    const parts = [];

    if (testRun.application_release) {
      parts.push(`Version: ${testRun.application_release}`);
    }

    if (testRun.annotations && testRun.annotations.length > 0) {
      parts.push(`Annotations: ${testRun.annotations.join(', ')}`);
    }

    return parts.join(' • ');
  };

  // Build request name display parts for better visibility
  const requestNameParts = [scenario, transaction];
  if (sampler) {
    requestNameParts.push(sampler);
  }

  // Handler for drilling down into a specific sampler
  const handleDrillDown = (samplerName: string): void => {
    if (onSamplerChange) {
      // Set pending state to trigger auto-compare after prop updates
      setPendingDrillDown(samplerName);
      onSamplerChange(samplerName);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Baseline selector */}
      <Box>
        <Autocomplete
          fullWidth
          size="small"
          options={relatedTestRuns}
          getOptionLabel={getTestRunDisplayText}
          value={selectedBaseline}
          onChange={(_event, newValue) => {
            setSelectedBaseline(newValue);
            setAnalysisResult(null);
          }}
          loading={fetchingBaselines}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Baseline Test Run"
              helperText={
                relatedTestRuns.length === 0
                  ? 'No related test runs with valid timestamps available'
                  : selectedBaseline
                  ? `Comparing with: ${selectedBaseline.test_run_id}`
                  : `Select from ${relatedTestRuns.length} available test runs`
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {fetchingBaselines ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box>
                  <Typography variant="body2">{getTestRunDisplayText(option)}</Typography>
                  {getTestRunSecondaryInfo(option) && (
                    <Typography variant="caption" color="text.secondary">
                      {getTestRunSecondaryInfo(option)}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }}
        />
      </Box>

      {/* Comparing info and button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            Comparing:
          </Typography>
          {requestNameParts.map((part, index) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center' }}>
              {index > 0 && (
                <Typography
                  variant="body2"
                  sx={{ mx: 0.5, color: 'text.disabled', fontWeight: 500 }}
                >
                  &gt;
                </Typography>
              )}
              <Chip
                label={part}
                size="small"
                color={index === requestNameParts.length - 1 && sampler ? 'primary' : 'default'}
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  height: 24,
                  '& .MuiChip-label': {
                    px: 1,
                  },
                }}
              />
            </Box>
          ))}
          {!sampler && (
            <Typography
              variant="caption"
              sx={{
                ml: 1,
                px: 1,
                py: 0.25,
                borderRadius: 1,
                backgroundColor: 'info.light',
                color: 'info.contrastText',
                fontSize: '0.65rem',
              }}
            >
              All Requests
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          startIcon={analyzing ? <CircularProgress size={18} color="inherit" /> : <CompareArrows />}
          onClick={handleCompare}
          disabled={!selectedBaseline || analyzing}
        >
          {analyzing ? 'Comparing...' : 'Compare Traces'}
        </Button>
      </Box>

      {/* Error display */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Loading state */}
      {analyzing && (
        <Box textAlign="center" py={4}>
          <CircularProgress size={48} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Fetching and analyzing traces...
          </Typography>
          <Typography variant="caption" color="text.secondary">
            This may take a few moments depending on trace volume
          </Typography>
        </Box>
      )}

      {/* Analysis results */}
      {!analyzing && analysisResult && !analysisResult.error && (
        <TraceAnalysisReport
          analysis={analysisResult}
          onDrillDown={onSamplerChange ? handleDrillDown : undefined}
        />
      )}

      {/* Empty state */}
      {!analyzing && !analysisResult && !error && (
        <Box
          sx={{
            textAlign: 'center',
            py: 6,
            color: 'text.secondary',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <CompareArrows sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
          <Typography variant="body1" sx={{ mb: 0.5 }}>
            Select a baseline test run and click "Compare Traces"
          </Typography>
          <Typography variant="body2">
            The analysis will compare traces for{' '}
            <strong style={{ fontFamily: 'monospace' }}>{requestNameParts.join(' > ')}</strong>
          </Typography>
        </Box>
      )}
    </Box>
  );
}
