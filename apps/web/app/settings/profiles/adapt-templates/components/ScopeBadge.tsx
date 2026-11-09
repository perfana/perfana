'use client';

import { Chip, Tooltip } from '@mui/material';
import { Business, Public, Tune } from '@mui/icons-material';
import type { CompareTemplateScopeKind } from '@/lib/compare-templates';

const KINDS: Record<
  CompareTemplateScopeKind,
  { label: string; tooltip: string; color: 'success' | 'primary' | 'secondary'; icon: React.ReactElement }
> = {
  profile: {
    label: 'Profile',
    tooltip: "Profile: applies to runs whose tags match the profile, in the profile's organization",
    color: 'success',
    icon: <Tune fontSize="small" />,
  },
  organization: {
    label: 'Organization',
    tooltip: 'Organization: applies to every run in this organization',
    color: 'primary',
    icon: <Business fontSize="small" />,
  },
  install: {
    label: 'Install-wide',
    tooltip: 'Install-wide: applies to every run on this install, in every organization',
    color: 'secondary',
    icon: <Public fontSize="small" />,
  },
};

/**
 * Tells the three kinds of template apart wherever templates are listed.
 *
 * An outlined chip draws its label in `<color>.main`, and `success.main` is 3.3:1 on white, below
 * AA at this size; label, border and icon take the mode-aware `readable.<color>` shade instead.
 */
export function ScopeBadge({ kind }: { kind: CompareTemplateScopeKind }) {
  const k = KINDS[kind];
  const ink = `readable.${k.color}`;
  return (
    <Tooltip title={k.tooltip}>
      <Chip
        size="small"
        variant="outlined"
        color={k.color}
        icon={k.icon}
        label={k.label}
        sx={{ fontWeight: 600, color: ink, borderColor: ink, '& .MuiChip-icon': { color: 'inherit' } }}
      />
    </Tooltip>
  );
}
