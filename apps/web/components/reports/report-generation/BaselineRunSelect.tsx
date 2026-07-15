'use client';

/**
 * Shared baseline test-run picker for report configuration.
 *
 * Used by the per-section comparisons config AND the template-level "set the
 * baseline once" control in GenerateReportDialog. Mirrors the compare card's
 * test-run Autocomplete: bold test_run_id + formatted timestamp as the label,
 * secondary line with env/workload (candidates span all environments of the
 * SUT), application release, and annotations.
 */

import { useState, useEffect } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

export interface BaselineCandidate {
  test_run_id: string;
  test_environment: string;
  workload: string;
  start_time?: string;
  created_at: string;
  application_release?: string;
  annotations?: string[];
}

const formatCandidateTime = (c: BaselineCandidate): string =>
  new Date(c.start_time || c.created_at).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getCandidateDisplayText = (c: BaselineCandidate): string =>
  `${c.test_run_id} - ${formatCandidateTime(c)}`;

const getCandidateSecondaryInfo = (c: BaselineCandidate): string => {
  const parts = [`${c.test_environment} / ${c.workload}`];
  if (c.application_release) parts.push(`Version: ${c.application_release}`);
  if (c.annotations && c.annotations.length > 0) parts.push(`Annotations: ${c.annotations.join(', ')}`);
  return parts.join(' • ');
};

/**
 * Fetch baseline candidates for a SUT (same-SUT scope, all environments/workloads).
 * excludeTestRunId keeps the run the report is generated FOR out of the list —
 * the API matches it against both the test_run_id string and the row UUID.
 */
export function useBaselineCandidates(
  systemUnderTestId?: string,
  excludeTestRunId?: string,
  enabled: boolean = true,
): BaselineCandidate[] {
  const [candidates, setCandidates] = useState<BaselineCandidate[]>([]);

  useEffect(() => {
    if (!enabled || !systemUnderTestId) {
      setCandidates([]);
      return;
    }
    const params = new URLSearchParams({ systemUnderTestId });
    if (excludeTestRunId) params.set('excludeTestRunId', excludeTestRunId);
    authenticatedFetch(`/test-runs/baseline-candidates?${params.toString()}`)
      .then((res) => {
        if (!res.ok) { setCandidates([]); return; }
        return res.json();
      })
      .then((data: BaselineCandidate[] | undefined) => { if (data) setCandidates(data); })
      .catch(() => setCandidates([]));
  }, [enabled, systemUnderTestId, excludeTestRunId]);

  return candidates;
}

interface BaselineRunSelectProps {
  candidates: BaselineCandidate[];
  value?: string; // baseline test_run_id
  onChange: (candidate: BaselineCandidate | null) => void;
  label?: string;
  helperText?: string;
}

export function BaselineRunSelect({ candidates, value, onChange, label = 'Baseline Test Run', helperText }: BaselineRunSelectProps) {
  return (
    <Autocomplete
      options={candidates}
      getOptionLabel={getCandidateDisplayText}
      isOptionEqualToValue={(option, v) => option.test_run_id === v.test_run_id}
      value={candidates.find((c) => c.test_run_id === value) ?? null}
      onChange={(_, newValue) => onChange(newValue)}
      size="small"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          variant="outlined"
          fullWidth
          helperText={
            helperText ??
            (value
              ? `Comparing with: ${value}`
              : `Select from ${candidates.length} available test runs`)
          }
        />
      )}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <Box component="li" key={key} {...otherProps}>
            <Box sx={{ width: '100%' }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {option.test_run_id}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatCandidateTime(option)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {getCandidateSecondaryInfo(option)}
              </Typography>
            </Box>
          </Box>
        );
      }}
    />
  );
}
