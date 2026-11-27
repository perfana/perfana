'use client';

/**
 * The baseline picker shared by the Compare and Loki cards: the run's control group first (the
 * runs anomaly detection judges it against, pooled), when it has one, then the comparable runs of
 * the same workload (`GET /test-runs/:id/related`). Both cards store the same sentinel for the
 * group, `CONTROL_GROUP_BASELINE`, riding in a `RelatedTestRun` (`controlGroupOption`).
 */

import React from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import type { RelatedTestRun } from '../compare/types';
import {
  controlGroupOption,
  getTestRunDisplayText,
  getTestRunSecondaryInfo,
  isControlGroupOption,
} from '../compare/utils/compare-utils';
import {
  controlGroupRunCount,
  formatRunCount,
  summariseControlGroupRuns,
  type ControlGroup,
} from '@/lib/control-group-baseline';

/** A bad timestamp renders as the literal string "Invalid Date", which survives filter(Boolean). */
export function formatStartedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** Autocomplete group headers — the control group is a different kind of thing from a run. */
const GROUP_CONTROL = 'Anomaly detection baseline';
const GROUP_RUNS = 'Test runs';

/** What the "Control group" option says about itself, in the list and under the field. */
export function controlGroupHint(group: ControlGroup): string {
  return `Pooled statistics of the ${formatRunCount(controlGroupRunCount(group))} anomaly detection compares this run with — the control values on the Anomaly Detection card`;
}

/** One caption line: a run with a dozen annotations would otherwise wrap into the row above. */
export function summariseAnnotations(annotations: string[] | null | undefined): string | null {
  if (!annotations?.length) return null;
  const [first, ...rest] = annotations;
  return rest.length > 0 ? `${first} (+${rest.length} more)` : first;
}

/** The caption under the picker naming what is selected. */
export function baselineCaption(selected: RelatedTestRun): string {
  return isControlGroupOption(selected)
    ? [
        'Baseline: control group',
        selected.control_group ? formatRunCount(controlGroupRunCount(selected.control_group)) : null,
        selected.control_group ? summariseControlGroupRuns(selected.control_group.test_runs) : null,
      ].filter(Boolean).join('  ·  ')
    : [
        `Baseline: ${selected.test_run_id}`,
        formatStartedAt(selected.start_time || selected.created_at),
        selected.application_release,
        summariseAnnotations(selected.annotations),
      ].filter(Boolean).join('  ·  ');
}

interface BaselineTestRunSelectProps {
  relatedTestRuns: RelatedTestRun[];
  /** The run's control group, offered as the first option. Null when it has none. */
  controlGroup?: ControlGroup | null;
  value: RelatedTestRun | null;
  onChange: (testRun: RelatedTestRun | null) => void;
  label?: string;
  size?: 'small' | 'medium';
  /** Replaces the default "N comparable runs" helper text; null shows none. */
  helperText?: string | null;
  /** False hides the caption naming the selected baseline. */
  showCaption?: boolean;
  disableClearable?: boolean;
}

export function BaselineTestRunSelect({
  relatedTestRuns,
  controlGroup = null,
  value,
  onChange,
  label = 'Select Test Run for Comparison',
  size = 'medium',
  helperText,
  showCaption = true,
  disableClearable = false,
}: BaselineTestRunSelectProps) {
  const options = controlGroup ? [controlGroupOption(controlGroup), ...relatedTestRuns] : relatedTestRuns;
  const runCount = `${relatedTestRuns.length} comparable run${relatedTestRuns.length === 1 ? '' : 's'}`;

  return (
    <>
      <Autocomplete
        options={options}
        getOptionLabel={getTestRunDisplayText}
        // The option objects are rebuilt per render; identity is the id.
        isOptionEqualToValue={(option, v) => option.test_run_id === v.test_run_id}
        groupBy={controlGroup ? (option) => (isControlGroupOption(option) ? GROUP_CONTROL : GROUP_RUNS) : undefined}
        value={value}
        onChange={(_, newValue) => onChange(newValue)}
        size={size}
        disableClearable={disableClearable as false}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            variant="outlined"
            fullWidth
            helperText={helperText === null ? undefined : helperText ?? (controlGroup ? `${runCount}, or the control group` : runCount)}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          if (isControlGroupOption(option) && option.control_group) {
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box sx={{ width: '100%' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    Control group
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {controlGroupHint(option.control_group)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getTestRunSecondaryInfo(option)}
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
                  {new Date(option.start_time || option.created_at).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getTestRunSecondaryInfo(option)}
                </Typography>
              </Box>
            </Box>
          );
        }}
      />

      {showCaption && value && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
          {baselineCaption(value)}
        </Typography>
      )}
    </>
  );
}
