'use client';

import { FormControl, InputLabel, Select, MenuItem, Chip, Box, Tooltip } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';

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

interface LiveWindowSelectorProps {
  elapsedMinutes: number;
  sinceMinutes: number | null;
  onChange: (value: number | null) => void;
}

export function LiveWindowSelector({ elapsedMinutes, sinceMinutes, onChange }: LiveWindowSelectorProps) {
  const options = buildWindowOptions(elapsedMinutes);

  // If the currently selected window is no longer valid (test just started),
  // the Select will show a blank — that's fine, it'll auto-correct on next change.

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title="Test is running — Apdex scores refresh automatically">
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
    </Box>
  );
}
