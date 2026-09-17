'use client';

import { useEffect, useState } from 'react';
import { TextField, type SxProps, type Theme } from '@mui/material';

export const APDEX_MIN_SAMPLES_DEFAULT = 50;
/** Postgres int4; the API rejects anything above it. */
const APDEX_MIN_SAMPLES_MAX = 2147483647;

/** Integer in [1, int4 max], or null when the text is not one (empty, "abc", 0, -5, 2.7, 1e21). */
export function parseMinSamples(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= APDEX_MIN_SAMPLES_MAX ? n : null;
}

interface ApdexMinSamplesFieldProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * "Minimum samples per transaction" for the two Apdex SLO dialogs. Holds a text draft so
 * the field can be cleared while typing; the parent only sees valid integers, and an
 * invalid draft snaps back to the last valid value on blur.
 */
export function ApdexMinSamplesField({ value, onChange, disabled, sx }: ApdexMinSamplesFieldProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const invalid = parseMinSamples(draft) === null;

  return (
    <TextField
      label="Minimum samples per transaction"
      type="number"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseMinSamples(e.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => { if (invalid) setDraft(String(value)); }}
      error={invalid}
      size="small"
      inputProps={{ min: 1, max: APDEX_MIN_SAMPLES_MAX, step: 1 }}
      helperText="Transactions with fewer samples are shown but cannot fail the SLO"
      sx={{ mt: 2, width: '100%', maxWidth: 320, ...sx }}
      disabled={disabled}
    />
  );
}
