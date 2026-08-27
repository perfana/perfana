'use client';

import { Paper, Toolbar, Typography, IconButton, Tooltip } from '@mui/material';
import {
  Delete as DeleteIcon,
  Close as CloseIcon,
  Block as BlockIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { QueriesToolbarProps } from '../types';

export function QueriesToolbar({
  selectedCount,
  onBatchDelete,
  onBatchSetEnabled,
  onClearSelection,
}: QueriesToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <Paper sx={{ mb: 2 }}>
      <Toolbar
        sx={{
          pl: { sm: 2 },
          pr: { xs: 1, sm: 1 },
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(56, 142, 232, 0.15)' : 'rgba(25, 118, 210, 0.08)',
        }}
      >
        <Typography
          sx={{ flex: '1 1 100%' }}
          color="primary"
          variant="subtitle1"
          component="div"
        >
          {selectedCount} quer{selectedCount > 1 ? 'ies' : 'y'} selected
        </Typography>
        <Tooltip title="Enable selected">
          <IconButton onClick={() => onBatchSetEnabled(true)} aria-label="Enable selected">
            <PlayArrowIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Disable selected">
          <IconButton onClick={() => onBatchSetEnabled(false)} aria-label="Disable selected">
            <BlockIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete selected">
          <IconButton onClick={onBatchDelete} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Clear selection">
          <IconButton onClick={onClearSelection}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </Paper>
  );
}
