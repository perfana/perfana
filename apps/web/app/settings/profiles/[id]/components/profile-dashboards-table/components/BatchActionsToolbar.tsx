'use client';

import { Paper, Toolbar, Typography, Tooltip, IconButton } from '@mui/material';
import { Delete as DeleteIcon, Close as CloseIcon } from '@mui/icons-material';

interface BatchActionsToolbarProps {
  selectedCount: number;
  onBatchDelete: () => void;
  onClearSelection: () => void;
}

/**
 * Toolbar displayed when dashboards are selected for batch operations
 */
export function BatchActionsToolbar({
  selectedCount,
  onBatchDelete,
  onClearSelection,
}: BatchActionsToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <Paper sx={{ mb: 2 }}>
      <Toolbar
        sx={{
          pl: { sm: 2 },
          pr: { xs: 1, sm: 1 },
          bgcolor: 'rgba(25, 118, 210, 0.08)',
        }}
      >
        <Typography
          sx={{ flex: '1 1 100%' }}
          color="primary"
          variant="subtitle1"
          component="div"
        >
          {selectedCount} dashboard{selectedCount > 1 ? 's' : ''} selected
        </Typography>
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
