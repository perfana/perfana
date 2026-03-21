'use client';

import React from 'react';
import { Box, Typography, Chip, IconButton } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import NumbersIcon from '@mui/icons-material/Numbers';
import { TrackedRegression } from '../types';

interface RegressionHeaderProps {
  regression: TrackedRegression;
  expanded: boolean;
  onToggle: () => void;
  isOldest: boolean;
  position: number;
  totalCount: number;
}

export const RegressionHeader: React.FC<RegressionHeaderProps> = ({
  regression,
  expanded,
  onToggle,
  isOldest,
  position,
  totalCount,
}) => {
  const severityColor = Math.abs(regression.percentageChange) > 10 ? 'error' : 'warning';

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TrendingUpIcon color={severityColor} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {regression.metricName}
        </Typography>

        <Chip
          label={`#${position} of ${totalCount}`}
          size="small"
          color={isOldest ? 'success' : 'default'}
          variant={isOldest ? 'filled' : 'outlined'}
          sx={{
            fontSize: '0.7rem',
            height: '20px',
            fontWeight: isOldest ? 700 : 400
          }}
        />

        {isOldest && (
          <Chip
            label="NEXT TO RESOLVE"
            size="small"
            color="success"
            sx={{
              fontSize: '0.65rem',
              height: '20px',
              fontWeight: 700,
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.7 },
                '100%': { opacity: 1 }
              }
            }}
          />
        )}

        <IconButton size="small" onClick={onToggle}>
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {regression.dashboardLabel} / {regression.panelTitle}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={`First detected: ${new Date(regression.firstDetected).toLocaleDateString()}`}
          size="small"
          variant="outlined"
          icon={<CalendarTodayIcon />}
        />
        <Chip
          label={`${regression.testRunsAffected} test runs affected`}
          size="small"
          color="warning"
          icon={<NumbersIcon />}
        />
        <Chip
          label={`${regression.percentageChange > 0 ? '+' : ''}${regression.percentageChange.toFixed(1)}%`}
          size="small"
          color={severityColor}
          icon={<TrendingUpIcon />}
        />
        {regression.conclusion && (
          <Chip
            label={`Confidence: ${(regression.conclusion.confidence * 100).toFixed(0)}%`}
            size="small"
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
};
