import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';

type ColorVariant = 'primary' | 'success' | 'error' | 'warning' | 'neutral';

interface KPIDisplayProps {
  value: string | number | React.ReactNode;
  label: string;
  unit?: string;
  color?: ColorVariant;
  loading?: boolean;
  size?: 'medium' | 'large';
  valueSize?: string;
  labelSize?: string;
  monospace?: boolean;
}

const colorMap: Record<ColorVariant, { value: string; label: string }> = {
  primary: { value: '#1976d2', label: 'text.secondary' },
  success: { value: '#2e7d32', label: 'text.secondary' },
  error: { value: '#c62828', label: 'text.secondary' },
  warning: { value: '#e65100', label: 'text.secondary' },
  neutral: { value: 'text.primary', label: 'text.secondary' },
};

/**
 * KPIDisplay - Displays a key performance indicator with visual hierarchy
 *
 * Design principle: The most important number should be 3x larger than labels
 * so users can scan numbers first, labels second.
 */
export default function KPIDisplay({
  value,
  label,
  unit,
  color = 'neutral',
  loading = false,
  size = 'large',
  valueSize: customValueSize,
  labelSize: customLabelSize,
  monospace = false,
}: KPIDisplayProps) {
  const colors = colorMap[color];
  const valueSize = customValueSize || (size === 'large' ? '2.5rem' : '1.75rem');
  const labelSize = customLabelSize || '0.75rem';

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 2,
        }}
      >
        <CircularProgress size={32} />
        <Typography
          variant="caption"
          sx={{
            mt: 1,
            color: 'text.secondary',
            fontSize: '0.75rem',
          }}
        >
          {label}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {/* Large KPI Value - 3x larger than labels */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 0.5, width: '100%' }}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Typography
            sx={{
              fontSize: valueSize,
              fontWeight: 700,
              color: colors.value,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              fontFamily: monospace ? 'monospace' : 'inherit',
              wordBreak: 'break-word',
              textAlign: 'center',
              width: '100%',
            }}
          >
            {value}
          </Typography>
        ) : (
          value
        )}
        {unit && (
          <Typography
            sx={{
              fontSize: size === 'large' ? '1rem' : '0.875rem',
              fontWeight: 500,
              color: 'text.secondary',
              ml: 0.25,
            }}
          >
            {unit}
          </Typography>
        )}
      </Box>

      {/* Small label below */}
      <Typography
        sx={{
          fontSize: labelSize,
          color: colors.label,
          fontWeight: 500,
          mt: 0.5,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
