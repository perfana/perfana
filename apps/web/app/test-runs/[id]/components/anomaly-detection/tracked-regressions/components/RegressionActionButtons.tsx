'use client';

import React from 'react';
import { Box, Button, ButtonGroup, Tooltip, Typography, CircularProgress } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface RegressionActionButtonsProps {
  regressionId: string;
  isOldest: boolean;
  resolving: boolean;
  onResolve: (resolution: 'accepted' | 'denied', id: string) => void;
}

export const RegressionActionButtons: React.FC<RegressionActionButtonsProps> = ({
  regressionId,
  isOldest,
  resolving,
  onResolve,
}) => {
  if (isOldest) {
    return (
      <ButtonGroup variant="outlined" size="small">
        <Tooltip title="Mark this as a real regression and exclude from baseline">
          <Button
            color="error"
            startIcon={resolving ? <CircularProgress size={16} /> : <BlockIcon />}
            onClick={() => onResolve('denied', regressionId)}
            disabled={resolving}
          >
            Mark as Regression
          </Button>
        </Tooltip>
        <Tooltip title="Accept this as normal variability and keep in baseline">
          <Button
            color="success"
            startIcon={resolving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
            onClick={() => onResolve('accepted', regressionId)}
            disabled={resolving}
          >
            Mark as Variability
          </Button>
        </Tooltip>
      </ButtonGroup>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        Waiting in queue
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
        Resolve oldest regression first
      </Typography>
    </Box>
  );
};
