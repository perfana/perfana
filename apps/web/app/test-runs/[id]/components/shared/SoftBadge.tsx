import React from 'react';
import { Box, Typography, SxProps, Theme, useTheme } from '@mui/material';

type BadgeColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'neutral';

interface SoftBadgeProps {
  count?: number;
  label: string;
  color?: BadgeColor;
  onClick?: (e: React.MouseEvent) => void;
  sx?: SxProps<Theme>;
}

/**
 * Color definitions with opacity backgrounds and text
 */
const lightConfig: Record<BadgeColor, { bg: string; text: string }> = {
  blue: { bg: 'rgba(25, 118, 210, 0.1)', text: '#1565c0' },
  green: { bg: 'rgba(76, 175, 80, 0.1)', text: '#2e7d32' },
  red: { bg: 'rgba(244, 67, 54, 0.1)', text: '#c62828' },
  orange: { bg: 'rgba(255, 152, 0, 0.1)', text: '#e65100' },
  purple: { bg: 'rgba(156, 39, 176, 0.1)', text: '#7b1fa2' },
  neutral: { bg: 'rgba(0, 0, 0, 0.06)', text: '#616161' },
};

const darkConfig: Record<BadgeColor, { bg: string; text: string }> = {
  blue: { bg: 'rgba(56, 142, 232, 0.2)', text: '#90caf9' },
  green: { bg: 'rgba(102, 187, 106, 0.2)', text: '#a5d6a7' },
  red: { bg: 'rgba(239, 83, 80, 0.2)', text: '#ef9a9a' },
  orange: { bg: 'rgba(255, 183, 77, 0.2)', text: '#ffcc80' },
  purple: { bg: 'rgba(186, 104, 200, 0.2)', text: '#ce93d8' },
  neutral: { bg: 'rgba(255, 255, 255, 0.08)', text: '#b0bec5' },
};

/**
 * SoftBadge - A modern, soft-styled badge component
 */
export default function SoftBadge({
  count,
  label,
  color = 'neutral',
  onClick,
  sx,
}: SoftBadgeProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const config = isDark ? darkConfig[color] : lightConfig[color];

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        borderRadius: '20px',
        backgroundColor: config.bg,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        '&:hover': onClick
          ? {
              backgroundColor: config.bg.replace('0.2)', '0.3)').replace('0.1)', '0.15)'),
              transform: 'translateY(-1px)',
            }
          : {},
        ...sx,
      }}
    >
      {count !== undefined && (
        <Typography
          component="span"
          sx={{
            fontSize: '0.9rem',
            fontWeight: 700,
            color: config.text,
            lineHeight: 1,
          }}
        >
          {count}
        </Typography>
      )}
      <Typography
        component="span"
        sx={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: config.text,
          lineHeight: 1,
          opacity: count !== undefined ? 0.85 : 1,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
