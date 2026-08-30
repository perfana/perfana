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
import { PREVIOUS_RUN_BASELINE, PREVIOUS_SUCCESSFUL_RUN_BASELINE } from '@perfana/shared/types';

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

/**
 * The value stored when the baseline should follow the run being reported on.
 *
 * Re-exported from @perfana/shared/types so the builder and the API's comparisons renderer
 * cannot drift: a rename is now a compile error rather than a template that silently stops
 * resolving a previous run.
 */
export { PREVIOUS_RUN_BASELINE, PREVIOUS_SUCCESSFUL_RUN_BASELINE };

/**
 * The synthetic options, in the order the list offers them.
 *
 * A Map, not an object literal, because every lookup here is keyed by a `test_run_id` — a
 * CI-supplied string. On an object literal, a run genuinely named `constructor`, `toString`
 * or `hasOwnProperty` inherits a truthy value from `Object.prototype` and is mistaken for a
 * synthetic option: it renders as a blank dropdown row and, as a `value`, resolves to nothing
 * and silently clears the picker. `packages/shared/src/utils/report-variables.ts` guards the
 * same bug class with `Object.prototype.hasOwnProperty.call`; a Map has no prototype keys to
 * inherit, so it cannot regress the next time someone adds a lookup.
 *
 * `hint` is the single canonical wording of what each sentinel resolves to — it is the option's
 * secondary line AND the field's helper text, so the same fact is never phrased two ways.
 */
const SYNTHETIC = new Map<string, { label: string; hint: string }>([
  [
    PREVIOUS_RUN_BASELINE,
    {
      label: 'Previous run',
      hint: 'Each report compares against the run before it, so it never goes stale',
    },
  ],
  [
    PREVIOUS_SUCCESSFUL_RUN_BASELINE,
    {
      // Front-loaded: the control is size="small" in a narrow config column, so a trailing
      // qualifier is exactly what the collapsed input truncates away.
      label: 'Previous SLO-passing run',
      hint: 'Each report compares against the most recent earlier run that passed its SLOs',
    },
  ],
]);

/** Autocomplete group headers — the sentinels are a different kind of thing from a pinned run. */
const GROUP_SYNTHETIC = 'Resolved per report';
const GROUP_RUNS = 'Specific runs';

const getCandidateDisplayText = (c: BaselineCandidate): string =>
  // The synthetic entries have no run behind them, so they have no timestamp to format.
  SYNTHETIC.get(c.test_run_id)?.label ?? `${c.test_run_id} - ${formatCandidateTime(c)}`;

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

/**
 * The synthetic options come first, because pinning a specific run is the wrong default for a
 * template. A template is generated from for months; the run chosen today is stale tomorrow, and
 * every nightly report then compares against the same ageing baseline. These follow along.
 */
const SYNTHETIC_OPTIONS: BaselineCandidate[] = Array.from(SYNTHETIC.keys()).map(
  // The list renders these; a synthetic option has no real values to show.
  (test_run_id) => ({ test_run_id }) as BaselineCandidate,
);

interface BaselineRunSelectProps {
  candidates: BaselineCandidate[];
  value?: string; // baseline test_run_id
  onChange: (candidate: BaselineCandidate | null) => void;
  label?: string;
  helperText?: string;
}

export function BaselineRunSelect({ candidates, value, onChange, label = 'Baseline Test Run', helperText }: BaselineRunSelectProps) {
  const options = [...SYNTHETIC_OPTIONS, ...candidates];
  // One lookup for both the selected option and its helper text; an unknown id (a pinned run
  // that has since been deleted) resolves to nothing and leaves the picker empty.
  const selected = value ? (options.find((o) => o.test_run_id === value) ?? null) : null;
  const selectedSynthetic = value ? SYNTHETIC.get(value) : undefined;

  return (
    <Autocomplete
      options={options}
      getOptionLabel={getCandidateDisplayText}
      isOptionEqualToValue={(option, v) => option.test_run_id === v.test_run_id}
      groupBy={(option) => (SYNTHETIC.has(option.test_run_id) ? GROUP_SYNTHETIC : GROUP_RUNS)}
      value={selected}
      onChange={(_, newValue) => onChange(newValue)}
      size="small"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          variant="outlined"
          fullWidth
          helperText={
            // The sentinel's own hint is the single source of this copy — see SYNTHETIC.
            helperText ??
            selectedSynthetic?.hint ??
            (value
              ? `Comparing with: ${value}`
              : `Select from ${candidates.length} available test runs`)
          }
        />
      )}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        const synthetic = SYNTHETIC.get(option.test_run_id);
        if (synthetic) {
          return (
            <Box component="li" key={key} {...otherProps}>
              <Box sx={{ width: '100%' }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {synthetic.label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {synthetic.hint}
                </Typography>
              </Box>
            </Box>
          );
        }
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
