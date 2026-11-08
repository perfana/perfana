'use client';

import { Chip, Tooltip } from '@mui/material';
import { Business, Public } from '@mui/icons-material';

/**
 * Tells an organization template from an install-wide one wherever templates are listed. The design
 * adds a third kind, profile templates, in a later PR.
 */
export function ScopeBadge({ kind }: { kind: 'organization' | 'install' }) {
  const install = kind === 'install';
  return (
    <Tooltip
      title={
        install
          ? 'Install-wide: applies to every run on this install, in every organization'
          : 'Organization: applies to every run in this organization'
      }
    >
      <Chip
        size="small"
        variant="outlined"
        color={install ? 'secondary' : 'primary'}
        icon={install ? <Public fontSize="small" /> : <Business fontSize="small" />}
        label={install ? 'Install-wide' : 'Organization'}
        sx={{ fontWeight: 600 }}
      />
    </Tooltip>
  );
}
