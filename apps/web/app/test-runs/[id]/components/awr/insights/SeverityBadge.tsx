'use client';

/**
 * Severity Badge Component
 *
 * A compact badge component that displays the severity level of an AWR insight
 * with appropriate colors and optional label text.
 *
 * Features:
 * - Visual severity indicator with color-coded styling
 * - Optional label text display
 * - Three size variants (small, medium, large)
 * - Accessible with proper ARIA labels
 *
 * @example
 * ```tsx
 * <SeverityBadge severity="critical" showLabel size="medium" />
 * <SeverityBadge severity="warning" />
 * <SeverityBadge severity="info" showLabel={false} size="small" />
 * ```
 */

import { Box, Chip, alpha } from '@mui/material';
import {
  Error as CriticalIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import type { SeverityBadgeProps, InsightSeverity } from '../types';

// ==================== Constants ====================

/**
 * Size configurations for the badge
 */
interface SizeConfig {
  chipHeight: number;
  iconSize: number;
  fontSize: string;
  padding: string;
  dotSize: number;
}

const SIZE_CONFIGS: Record<'small' | 'medium' | 'large', SizeConfig> = {
  small: {
    chipHeight: 20,
    iconSize: 12,
    fontSize: '0.7rem',
    padding: '0 6px',
    dotSize: 6,
  },
  medium: {
    chipHeight: 24,
    iconSize: 16,
    fontSize: '0.75rem',
    padding: '0 8px',
    dotSize: 8,
  },
  large: {
    chipHeight: 32,
    iconSize: 20,
    fontSize: '0.875rem',
    padding: '0 12px',
    dotSize: 10,
  },
};

/**
 * Severity color configurations
 */
interface SeverityConfig {
  color: string;
  backgroundColor: string;
  borderColor: string;
  label: string;
  icon: React.ComponentType<{ sx?: object }>;
}

const SEVERITY_CONFIGS: Record<InsightSeverity, SeverityConfig> = {
  critical: {
    color: '#d32f2f',
    backgroundColor: 'rgba(211, 47, 47, 0.08)',
    borderColor: 'rgba(211, 47, 47, 0.3)',
    label: 'Critical',
    icon: CriticalIcon,
  },
  warning: {
    color: '#ed6c02',
    backgroundColor: 'rgba(237, 108, 2, 0.08)',
    borderColor: 'rgba(237, 108, 2, 0.3)',
    label: 'Warning',
    icon: WarningIcon,
  },
  info: {
    color: '#0288d1',
    backgroundColor: 'rgba(2, 136, 209, 0.08)',
    borderColor: 'rgba(2, 136, 209, 0.3)',
    label: 'Info',
    icon: InfoIcon,
  },
};

/**
 * Get severity configuration with fallback
 */
function getSeverityConfig(severity: InsightSeverity): SeverityConfig {
  return SEVERITY_CONFIGS[severity] || SEVERITY_CONFIGS.info;
}

// ==================== Component ====================

/**
 * Severity Badge Component
 *
 * Displays a compact badge indicating the severity level of an insight.
 */
export function SeverityBadge({
  severity,
  showLabel = true,
  size = 'medium',
  className,
}: SeverityBadgeProps): JSX.Element {
  const config = getSeverityConfig(severity);
  const sizeConfig = SIZE_CONFIGS[size] || SIZE_CONFIGS.medium;
  const IconComponent = config.icon;

  // If not showing label, render a simple dot indicator
  if (!showLabel) {
    return (
      <Box
        className={className}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: sizeConfig.dotSize * 2,
          height: sizeConfig.dotSize * 2,
          borderRadius: '50%',
          backgroundColor: alpha(config.color, 0.15),
        }}
        role="status"
        aria-label={`Severity: ${config.label}`}
        title={config.label}
      >
        <Box
          sx={{
            width: sizeConfig.dotSize,
            height: sizeConfig.dotSize,
            borderRadius: '50%',
            backgroundColor: config.color,
          }}
        />
      </Box>
    );
  }

  // Render full chip with icon and label
  return (
    <Chip
      className={className}
      icon={
        <IconComponent
          sx={{
            fontSize: sizeConfig.iconSize,
            color: `${config.color} !important`,
          }}
        />
      }
      label={config.label}
      size="small"
      aria-label={`Severity: ${config.label}`}
      sx={{
        height: sizeConfig.chipHeight,
        backgroundColor: config.backgroundColor,
        border: `1px solid ${config.borderColor}`,
        color: config.color,
        fontWeight: 600,
        fontSize: sizeConfig.fontSize,
        padding: sizeConfig.padding,
        '& .MuiChip-icon': {
          marginLeft: '4px',
          marginRight: '-4px',
        },
        '& .MuiChip-label': {
          paddingLeft: '8px',
          paddingRight: '4px',
        },
      }}
    />
  );
}

// Default export
export default SeverityBadge;
