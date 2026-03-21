import { Chip, ChipProps, SxProps, Theme, useTheme } from '@mui/material';

type ColorTheme = 'blue' | 'purple' | 'green' | 'red' | 'orange';

interface FancyChipProps extends Omit<ChipProps, 'sx'> {
  colorTheme?: ColorTheme;
  sx?: SxProps<Theme>;
}

const lightColors = {
  blue: {
    background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.2) 100%)',
    border: '1px solid rgba(25, 118, 210, 0.3)',
    color: 'primary.dark',
    hoverBorder: 'rgba(25, 118, 210, 0.4)',
    hoverShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
    iconColor: 'rgba(25, 118, 210, 0.7)',
    iconHoverColor: 'rgba(25, 118, 210, 1)'
  },
  purple: {
    background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.1) 0%, rgba(156, 39, 176, 0.2) 100%)',
    border: '1px solid rgba(156, 39, 176, 0.3)',
    color: 'secondary.dark',
    hoverBorder: 'rgba(156, 39, 176, 0.4)',
    hoverShadow: '0 4px 12px rgba(156, 39, 176, 0.2)',
    iconColor: 'rgba(156, 39, 176, 0.7)',
    iconHoverColor: 'rgba(156, 39, 176, 1)'
  },
  green: {
    background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(76, 175, 80, 0.2) 100%)',
    border: '1px solid rgba(76, 175, 80, 0.3)',
    color: 'success.dark',
    hoverBorder: 'rgba(76, 175, 80, 0.4)',
    hoverShadow: '0 4px 12px rgba(76, 175, 80, 0.2)',
    iconColor: 'rgba(76, 175, 80, 0.7)',
    iconHoverColor: 'rgba(76, 175, 80, 1)'
  },
  red: {
    background: 'linear-gradient(135deg, rgba(244, 67, 54, 0.1) 0%, rgba(244, 67, 54, 0.2) 100%)',
    border: '1px solid rgba(244, 67, 54, 0.3)',
    color: 'error.dark',
    hoverBorder: 'rgba(244, 67, 54, 0.4)',
    hoverShadow: '0 4px 12px rgba(244, 67, 54, 0.2)',
    iconColor: 'rgba(244, 67, 54, 0.7)',
    iconHoverColor: 'rgba(244, 67, 54, 1)'
  },
  orange: {
    background: 'linear-gradient(135deg, rgba(255, 152, 0, 0.1) 0%, rgba(255, 152, 0, 0.2) 100%)',
    border: '1px solid rgba(255, 152, 0, 0.3)',
    color: 'warning.dark',
    hoverBorder: 'rgba(255, 152, 0, 0.4)',
    hoverShadow: '0 4px 12px rgba(255, 152, 0, 0.2)',
    iconColor: 'rgba(255, 152, 0, 0.7)',
    iconHoverColor: 'rgba(255, 152, 0, 1)'
  }
};

const darkColors = {
  blue: {
    background: 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)',
    border: '1px solid rgba(56, 142, 232, 0.5)',
    color: '#90caf9',
    hoverBorder: 'rgba(56, 142, 232, 0.7)',
    hoverShadow: '0 4px 12px rgba(56, 142, 232, 0.3)',
    iconColor: 'rgba(144, 202, 249, 0.7)',
    iconHoverColor: '#90caf9'
  },
  purple: {
    background: 'linear-gradient(135deg, rgba(186, 104, 200, 0.18) 0%, rgba(186, 104, 200, 0.28) 100%)',
    border: '1px solid rgba(186, 104, 200, 0.5)',
    color: '#ce93d8',
    hoverBorder: 'rgba(186, 104, 200, 0.7)',
    hoverShadow: '0 4px 12px rgba(186, 104, 200, 0.3)',
    iconColor: 'rgba(206, 147, 216, 0.7)',
    iconHoverColor: '#ce93d8'
  },
  green: {
    background: 'linear-gradient(135deg, rgba(102, 187, 106, 0.18) 0%, rgba(102, 187, 106, 0.28) 100%)',
    border: '1px solid rgba(102, 187, 106, 0.5)',
    color: '#a5d6a7',
    hoverBorder: 'rgba(102, 187, 106, 0.7)',
    hoverShadow: '0 4px 12px rgba(102, 187, 106, 0.3)',
    iconColor: 'rgba(165, 214, 167, 0.7)',
    iconHoverColor: '#a5d6a7'
  },
  red: {
    background: 'linear-gradient(135deg, rgba(239, 83, 80, 0.18) 0%, rgba(239, 83, 80, 0.28) 100%)',
    border: '1px solid rgba(239, 83, 80, 0.5)',
    color: '#ef9a9a',
    hoverBorder: 'rgba(239, 83, 80, 0.7)',
    hoverShadow: '0 4px 12px rgba(239, 83, 80, 0.3)',
    iconColor: 'rgba(239, 154, 154, 0.7)',
    iconHoverColor: '#ef9a9a'
  },
  orange: {
    background: 'linear-gradient(135deg, rgba(255, 183, 77, 0.18) 0%, rgba(255, 183, 77, 0.28) 100%)',
    border: '1px solid rgba(255, 183, 77, 0.5)',
    color: '#ffcc80',
    hoverBorder: 'rgba(255, 183, 77, 0.7)',
    hoverShadow: '0 4px 12px rgba(255, 183, 77, 0.3)',
    iconColor: 'rgba(255, 204, 128, 0.7)',
    iconHoverColor: '#ffcc80'
  }
};

export default function FancyChip({ colorTheme = 'blue', sx, ...props }: FancyChipProps) {
  const muiTheme = useTheme();
  const isDark = muiTheme.palette.mode === 'dark';
  const colors = isDark ? darkColors[colorTheme] : lightColors[colorTheme];

  return (
    <Chip
      {...props}
      size="small"
      sx={{
        height: '32px',
        background: colors.background,
        border: colors.border,
        color: colors.color,
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s ease',
        '& .MuiChip-icon': {
          color: colors.iconColor,
          marginLeft: '4px'
        },
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: colors.hoverShadow,
          borderColor: colors.hoverBorder,
          '& .MuiChip-icon': {
            color: colors.iconHoverColor
          }
        },
        '& .MuiChip-label': {
          px: 1.5,
          py: 0,
          fontSize: '0.8rem'
        },
        ...sx
      }}
    />
  );
}
