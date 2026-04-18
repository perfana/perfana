import { Chip, Tooltip, keyframes, useTheme } from '@mui/material';
import {
  CheckCircle,
  Error,
  Warning,
  Autorenew,
  Schedule,
} from '@mui/icons-material';

export type StatusType = 'success' | 'failure' | 'warning' | 'running' | 'neutral';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'small' | 'medium';
  showTooltip?: boolean;
}

const _pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;

const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const lightStatusConfig = {
  success: {
    color: '#2e7d32',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderColor: '#4caf50',
  },
  failure: {
    color: '#c62828',
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    borderColor: '#f44336',
  },
  warning: {
    color: '#e65100',
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderColor: '#ff9800',
  },
  running: {
    color: '#1565c0',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderColor: '#2196f3',
  },
  neutral: {
    color: '#616161',
    backgroundColor: 'rgba(158, 158, 158, 0.1)',
    borderColor: '#9e9e9e',
  },
};

const darkStatusConfig = {
  success: {
    color: '#a5d6a7',
    backgroundColor: 'rgba(102, 187, 106, 0.2)',
    borderColor: 'rgba(102, 187, 106, 0.5)',
  },
  failure: {
    color: '#ef9a9a',
    backgroundColor: 'rgba(239, 83, 80, 0.2)',
    borderColor: 'rgba(239, 83, 80, 0.5)',
  },
  warning: {
    color: '#ffcc80',
    backgroundColor: 'rgba(255, 183, 77, 0.2)',
    borderColor: 'rgba(255, 183, 77, 0.5)',
  },
  running: {
    color: '#90caf9',
    backgroundColor: 'rgba(56, 142, 232, 0.2)',
    borderColor: 'rgba(56, 142, 232, 0.5)',
  },
  neutral: {
    color: '#b0bec5',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
};

const iconMap = {
  success: CheckCircle,
  failure: Error,
  warning: Warning,
  running: Autorenew,
  neutral: Schedule,
};

const defaultLabels = {
  success: 'Passed',
  failure: 'Failed',
  warning: 'Warning',
  running: 'Running',
  neutral: 'Pending',
};

export default function StatusBadge({
  status,
  label,
  size = 'medium',
  showTooltip = true,
}: StatusBadgeProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const config = isDark ? darkStatusConfig[status] : lightStatusConfig[status];
  const IconComponent = iconMap[status];
  const displayLabel = label || defaultLabels[status];

  const badge = (
    <Chip
      icon={
        <IconComponent
          sx={{
            fontSize: size === 'small' ? '14px' : '16px',
            color: config.color,
            ...(status === 'running' && {
              animation: `${rotate} 2s linear infinite`,
            }),
          }}
        />
      }
      label={displayLabel}
      size={size}
      sx={{
        backgroundColor: config.backgroundColor,
        border: `1px solid ${config.borderColor}`,
        color: config.color,
        fontWeight: 600,
        fontSize: size === 'small' ? '0.7rem' : '0.75rem',
        height: size === 'small' ? '24px' : '28px',
        borderRadius: '16px',
        padding: size === 'small' ? '4px 8px' : '4px 12px',
        '& .MuiChip-label': {
          padding: size === 'small' ? '0 6px' : '0 8px',
          lineHeight: 1,
        },
        '& .MuiChip-icon': {
          marginLeft: size === 'small' ? '4px' : '6px',
          marginRight: size === 'small' ? '-4px' : '-2px',
        },
      }}
    />
  );

  if (showTooltip) {
    return (
      <Tooltip
        title={`Status: ${displayLabel}`}
        arrow
        placement="top"
      >
        {badge}
      </Tooltip>
    );
  }

  return badge;
}
