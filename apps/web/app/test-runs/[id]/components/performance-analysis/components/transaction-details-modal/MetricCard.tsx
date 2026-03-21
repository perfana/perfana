'use client';

import { Box, Typography } from '@mui/material';
import { SxProps, Theme } from '@mui/material/styles';

export interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  borderColor?: string;
  hoverEffect?: boolean;
  sx?: SxProps<Theme>;
}

export function MetricCard({
  label,
  value,
  unit,
  color = 'text.primary',
  borderColor = 'rgba(0, 0, 0, 0.15)',
  hoverEffect = false,
  sx,
}: MetricCardProps) {
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        background: 'rgba(255, 255, 255, 0.7)',
        border: `1px solid ${borderColor}`,
        textAlign: 'center',
        transition: hoverEffect ? 'all 0.2s' : undefined,
        '&:hover': hoverEffect
          ? {
              transform: 'translateY(-2px)',
              boxShadow: `0 4px 8px ${borderColor}`,
            }
          : undefined,
        ...sx,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          fontSize: '0.7rem',
          display: 'block',
          mb: 1,
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="h5"
        sx={{
          fontFamily: 'monospace',
          fontWeight: 700,
          color,
          mb: unit ? 0.5 : 0,
        }}
      >
        {value}
      </Typography>
      {unit && (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          {unit}
        </Typography>
      )}
    </Box>
  );
}
