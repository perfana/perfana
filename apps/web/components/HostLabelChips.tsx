'use client';

import { Box, Chip, Typography } from '@mui/material';

interface HostLabelChipsProps {
  labels?: string[] | null;
  /** Shown when there are no labels. Omit to render nothing at all. */
  emptyText?: string;
  size?: 'small' | 'medium';
}

/**
 * One rendering of host labels, shared by the SUT config table, the test-run
 * hosts tab, the host detail header and the compare card, so a label looks the
 * same everywhere it appears.
 */
export default function HostLabelChips({ labels, emptyText, size = 'small' }: HostLabelChipsProps) {
  if (!labels || labels.length === 0) {
    return emptyText ? (
      <Typography variant="caption" color="text.secondary">
        {emptyText}
      </Typography>
    ) : null;
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {labels.map((label) => (
        <Chip key={label} label={label} size={size} variant="outlined" color="info" />
      ))}
    </Box>
  );
}
