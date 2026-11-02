'use client';

import { FormControl, InputLabel, Select, MenuItem, Chip, Box, Tooltip, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { REFRESH_OPTIONS } from '../hooks/usePerformanceAnalysisData';

export interface WindowOption {
  label: string;
  value: number | null; // null = complete test
}

/**
 * Returns which time window options are available based on how many minutes
 * the test has been running. Short tests shouldn't offer "last 30m" etc.
 */
export function buildWindowOptions(elapsedMinutes: number): WindowOption[] {
  const all: WindowOption[] = [
    { label: 'Last 1 minute', value: 1 },
    { label: 'Last 5 minutes', value: 5 },
    { label: 'Last 15 minutes', value: 15 },
    { label: 'Last 30 minutes', value: 30 },
    { label: 'Complete test', value: null },
  ];

  return all.filter(
    (opt) => opt.value === null || opt.value <= Math.max(elapsedMinutes, 1),
  );
}

// 'paused' = a period is picked but the last fetch took ≥5 s, so no timer runs.
export type RefreshState = 'on' | 'off' | 'paused';

const LIVE_TOOLTIP: Record<RefreshState, string> = {
  on: 'Test is running — metrics refresh automatically',
  off: 'Test is running — auto-refresh is off',
  paused: 'Test is running — auto-refresh paused (last fetch took >5s)',
};

interface LiveWindowSelectorProps {
  elapsedMinutes: number;
  sinceMinutes: number | null;
  onChange: (value: number | null) => void;
  refreshIntervalMs: number;
  onRefreshIntervalChange: (value: number) => void;
  refreshState: RefreshState;
  lastUpdatedAt: Date | null;
}

export function LiveWindowSelector({
  elapsedMinutes,
  sinceMinutes,
  onChange,
  refreshIntervalMs,
  onRefreshIntervalChange,
  refreshState,
  lastUpdatedAt,
}: LiveWindowSelectorProps) {
  const options = buildWindowOptions(elapsedMinutes);
  // Visible text, not just the chip's hover tooltip, so the paused and off states
  // reach keyboard and screen-reader users too.
  const caption = [
    lastUpdatedAt && `Updated ${lastUpdatedAt.toLocaleTimeString()}`,
    refreshState !== 'on' && `auto-refresh ${refreshState}`,
  ].filter(Boolean).join(' · ');

  // If the currently selected window is no longer valid (test just started),
  // the Select will show a blank — that's fine, it'll auto-correct on next change.

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
      <Tooltip title={LIVE_TOOLTIP[refreshState]}>
        <Chip
          icon={<FiberManualRecordIcon sx={{ fontSize: 10, color: '#f44336 !important', animation: 'pulse 1.5s infinite' }} />}
          label="LIVE"
          size="small"
          variant="outlined"
          sx={{
            borderColor: '#f44336',
            color: '#f44336',
            fontWeight: 700,
            fontSize: '0.65rem',
            letterSpacing: 1,
            height: 24,
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.3 },
            },
          }}
        />
      </Tooltip>

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="live-window-label" sx={{ fontSize: '0.8rem' }}>
          Time window
        </InputLabel>
        <Select
          labelId="live-window-label"
          value={sinceMinutes ?? 'complete'}
          label="Time window"
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === 'complete' ? null : Number(raw));
          }}
          sx={{ fontSize: '0.8rem' }}
        >
          {options.map((opt) => (
            <MenuItem key={opt.value ?? 'complete'} value={opt.value ?? 'complete'} sx={{ fontSize: '0.8rem' }}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 90 }}>
        <InputLabel id="live-refresh-label" sx={{ fontSize: '0.8rem' }}>
          Refresh
        </InputLabel>
        <Select
          labelId="live-refresh-label"
          value={refreshIntervalMs}
          label="Refresh"
          onChange={(e) => onRefreshIntervalChange(Number(e.target.value))}
          sx={{ fontSize: '0.8rem' }}
        >
          {REFRESH_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              value={opt.value}
              // Select fires onChange only for a different value; re-picking the shown
              // period must still resume a slow-fetch pause.
              onClick={() => {
                if (opt.value === refreshIntervalMs) onRefreshIntervalChange(opt.value);
              }}
              sx={{ fontSize: '0.8rem' }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Shows each refresh even when the figures did not change. Announced only when
          refresh is manual (off or paused): on every timer tick it would be noise. */}
      {caption && (
        <Typography
          variant="caption"
          color="text.secondary"
          // Tabular digits: the time changes on every refresh and must not nudge its neighbours.
          sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          {...(refreshState !== 'on' && { role: 'status', 'aria-live': 'polite' })}
        >
          {caption}
        </Typography>
      )}
    </Box>
  );
}
