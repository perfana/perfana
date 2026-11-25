'use client';

import { useEffect, useState } from 'react';
import { Box, Slider, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

/** Offsets in seconds from the run's start. */
export type SecondRange = [number, number];
export interface RunWindows {
  baseline: SecondRange;
  current: SecondRange;
}
export type CompareMode = 'run' | 'within';

export function runDurationSeconds(startTime: string, endTime?: string | null): number {
  const start = Date.parse(startTime);
  const end = endTime ? Date.parse(endTime) : Date.now();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

/** First third against last third: the usual "did it degrade over the run" question. */
export function defaultRunWindows(durationSeconds: number): RunWindows {
  const third = Math.floor(durationSeconds / 3);
  return { baseline: [0, third], current: [durationSeconds - third, durationSeconds] };
}

export function windowToIso(startTime: string, [from, to]: SecondRange): { start: string; end: string } {
  const startMs = Date.parse(startTime);
  return {
    start: new Date(startMs + from * 1000).toISOString(),
    end: new Date(startMs + to * 1000).toISOString(),
  };
}

function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function clock(startTime: string, offset: number): string {
  return new Date(Date.parse(startTime) + offset * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface Props {
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  startTime: string;
  endTime?: string | null;
  value: RunWindows;
  /** Fires when a drag ends, not on every pixel, so callers can refetch on it. */
  onChange: (value: RunWindows) => void;
}

/**
 * Compare-against toggle (another run / two windows of this run) plus, in "within" mode,
 * one range slider per window.
 */
export function WithinRunWindowsPicker({ mode, onModeChange, startTime, endTime, value, onChange }: Props) {
  const duration = runDurationSeconds(startTime, endTime);
  // Local copy so dragging stays smooth while the parent only hears about committed values.
  const [draft, setDraft] = useState<RunWindows>(value);
  useEffect(() => setDraft(value), [value]);

  const step = Math.max(1, Math.round(duration / 500));
  const slider = (key: keyof RunWindows, label: string, color: 'primary' | 'secondary') => {
    const [from, to] = draft[key];
    return (
      <Box>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {label}: <strong>{formatOffset(from)} – {formatOffset(to)}</strong>{' '}
          <Typography component="span" variant="caption" color="text.secondary">
            ({clock(startTime, from)} – {clock(startTime, to)})
          </Typography>
        </Typography>
        <Slider
          size="small"
          color={color}
          min={0}
          max={duration}
          step={step}
          disableSwap
          value={draft[key]}
          valueLabelDisplay="auto"
          valueLabelFormat={formatOffset}
          onChange={(_e, v) => setDraft({ ...draft, [key]: v as SecondRange })}
          onChangeCommitted={(_e, v) => onChange({ ...draft, [key]: v as SecondRange })}
          aria-label={label}
        />
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={mode}
        onChange={(_e, m: CompareMode | null) => m && onModeChange(m)}
        aria-label="Compare against"
      >
        <ToggleButton value="run">Another test run</ToggleButton>
        <ToggleButton value="within" disabled={duration === 0}>
          Two time ranges in this run
        </ToggleButton>
      </ToggleButtonGroup>
      {mode === 'within' && (
        <Box sx={{ px: 1 }}>
          {slider('baseline', 'Baseline range', 'secondary')}
          {slider('current', 'Compare range', 'primary')}
        </Box>
      )}
    </Box>
  );
}
