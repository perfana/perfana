import { SxProps, Theme } from '@mui/material';

/**
 * Base chip styles shared across all dashboard table chips
 */
const BASE_CHIP_SX = {
  height: '24px',
  fontWeight: 600,
  backdropFilter: 'blur(8px)',
  transition: 'all 0.2s ease',
  '& .MuiChip-label': {
    px: 1,
    py: 0,
    fontSize: '0.75rem',
  },
} as const;

/**
 * Purple gradient chip style - used for "Separate Dashboard For" column
 * Uses theme-aware colors for dark mode contrast
 */
export const PURPLE_CHIP_SX: SxProps<Theme> = {
  ...BASE_CHIP_SX,
  background: (theme) =>
    theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(206, 147, 216, 0.15) 0%, rgba(186, 104, 200, 0.20) 100%)'
      : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
  border: (theme) =>
    theme.palette.mode === 'dark'
      ? '1px solid rgba(206, 147, 216, 0.4)'
      : '1px solid rgba(156, 39, 176, 0.3)',
  color: (theme) =>
    theme.palette.mode === 'dark' ? '#ce93d8' : '#9c27b0',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(156, 39, 176, 0.2)',
    border: (theme: Theme) =>
      theme.palette.mode === 'dark'
        ? '1px solid rgba(206, 147, 216, 0.6)'
        : '1px solid rgba(156, 39, 176, 0.5)',
  },
};

/**
 * Blue gradient chip style - used for variables and tags
 * Uses theme-aware colors for dark mode contrast
 */
export const BLUE_CHIP_SX: SxProps<Theme> = {
  ...BASE_CHIP_SX,
  background: (theme) =>
    theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.15) 0%, rgba(66, 165, 245, 0.20) 100%)'
      : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
  border: (theme) =>
    theme.palette.mode === 'dark'
      ? '1px solid rgba(100, 181, 246, 0.4)'
      : '1px solid rgba(25, 118, 210, 0.3)',
  color: (theme) =>
    theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
    border: (theme: Theme) =>
      theme.palette.mode === 'dark'
        ? '1px solid rgba(100, 181, 246, 0.6)'
        : '1px solid rgba(25, 118, 210, 0.5)',
  },
};

/**
 * Green gradient chip style - used for regex rules
 * Uses theme-aware colors for dark mode contrast
 */
export const GREEN_CHIP_SX: SxProps<Theme> = {
  ...BASE_CHIP_SX,
  background: (theme) =>
    theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(129, 199, 132, 0.15) 0%, rgba(102, 187, 106, 0.20) 100%)'
      : 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(102, 187, 106, 0.12) 100%)',
  border: (theme) =>
    theme.palette.mode === 'dark'
      ? '1px solid rgba(129, 199, 132, 0.4)'
      : '1px solid rgba(76, 175, 80, 0.3)',
  color: (theme) =>
    theme.palette.mode === 'dark' ? '#81c784' : '#4caf50',
  fontFamily: 'monospace',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(76, 175, 80, 0.2)',
    border: (theme: Theme) =>
      theme.palette.mode === 'dark'
        ? '1px solid rgba(129, 199, 132, 0.6)'
        : '1px solid rgba(76, 175, 80, 0.5)',
  },
  '& .MuiChip-label': {
    px: 1,
    py: 0,
    fontSize: '0.7rem',
  },
};

/**
 * Yellow/amber chip style - used for read-only indicator
 */
export const READ_ONLY_CHIP_SX: SxProps<Theme> = {
  mt: 0.5,
  height: '20px',
  fontSize: '0.65rem',
  background: (theme) =>
    theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(255, 213, 79, 0.15) 0%, rgba(255, 193, 7, 0.20) 100%)'
      : 'linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.2) 100%)',
  border: (theme) =>
    theme.palette.mode === 'dark'
      ? '1px solid rgba(255, 213, 79, 0.4)'
      : '1px solid rgba(255, 193, 7, 0.3)',
  color: (theme) =>
    theme.palette.mode === 'dark' ? '#ffd54f' : '#f57f17',
};
