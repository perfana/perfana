import React, { forwardRef } from 'react';
import { Card, CardContent, Box, Typography, IconButton, SxProps, Theme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ExpandMore } from '@mui/icons-material';

type AccentColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'neutral';

interface CollapsedCardProps {
  title: string;
  accentColor?: AccentColor;
  onExpand: () => void;
  children: React.ReactNode;
  testId?: string;
  sx?: SxProps<Theme>;
  disabled?: boolean;
}

const accentColorMap: Record<AccentColor, string> = {
  blue: '#1976d2',
  green: '#4caf50',
  red: '#f44336',
  orange: '#ff9800',
  purple: '#9c27b0',
  neutral: '#9e9e9e',
};

/**
 * CollapsedCard - A modern, clean card component for collapsed states
 *
 * Design principles:
 * 1. No heavy borders - uses subtle shadows and thin top accent line
 * 2. Clean white background with subtle depth
 * 3. Smooth hover interactions
 */
const CollapsedCard = forwardRef<HTMLDivElement, CollapsedCardProps>(({
  title,
  accentColor = 'blue',
  onExpand,
  children,
  testId,
  sx,
  disabled = false,
}, ref) => {
  const accent = accentColorMap[accentColor];

  return (
    <Card
      ref={ref}
      tabIndex={-1}
      data-testid={testId}
      elevation={0}
      sx={[
        (theme) => ({
          cursor: disabled ? 'default' : 'pointer',
          height: '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          // Thin accent line at top only
          borderTop: `3px solid ${accent}`,
          // Subtle shadow for depth - stronger in dark mode
          boxShadow: theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: 'hidden',
          '&:hover': disabled ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
          },
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      onClick={disabled ? undefined : onExpand}
    >
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 3,
          '&:last-child': { pb: 3 },
        }}
      >
        {/* Header with title and expand button */}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="flex-start"
          mb={2}
        >
          <Typography
            variant="subtitle1"
            component="h2"
            sx={{
              fontWeight: 600,
              color: 'text.secondary',
              fontSize: '0.875rem',
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
            }}
          >
            {title}
          </Typography>
          {!disabled && (
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              size="small"
              sx={{
                width: 32,
                height: 32,
                backgroundColor: 'transparent',
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: alpha(accent, 0.08),
                  color: accent,
                },
                transition: 'all 0.2s ease',
              }}
            >
              <ExpandMore />
            </IconButton>
          )}
        </Box>

        {/* Content area */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      </CardContent>
    </Card>
  );
});

CollapsedCard.displayName = 'CollapsedCard';

export default CollapsedCard;
