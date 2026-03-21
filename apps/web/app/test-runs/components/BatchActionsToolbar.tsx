'use client';

import {
  Card,
  Toolbar,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Sync,
  Flag,
  Delete as DeleteIcon,
  PlaylistAddCheck,
  Close as CloseIcon,
} from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';

interface BatchActionsToolbarProps {
  selectedCount: number;
  selectedTestRuns: TestRun[];
  onReEvaluate: () => void;
  onRefresh: () => void;
  onMarkChangepoint: () => void;
  onRemoveChangepoint: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

const tooltipStyles = {
  '& .MuiTooltip-tooltip': {
    backgroundColor: 'rgba(33, 33, 33, 0.95)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
    maxWidth: 280,
  },
  '& .MuiTooltip-arrow': {
    color: 'rgba(33, 33, 33, 0.95)',
  }
};

export function BatchActionsToolbar({
  selectedCount,
  selectedTestRuns,
  onReEvaluate,
  onRefresh,
  onMarkChangepoint,
  onRemoveChangepoint,
  onDelete,
  onClearSelection,
}: BatchActionsToolbarProps) {
  const selectedRun = selectedCount === 1 ? selectedTestRuns[0] : null;
  const isChangepoint = selectedRun?.is_changepoint;

  return (
    <Card sx={{ mb: 2, flexShrink: 0 }}>
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
          {selectedCount} test run{selectedCount > 1 ? 's' : ''} selected
        </Typography>

        <Tooltip title="Re-evaluate" arrow placement="top" sx={tooltipStyles}>
          <IconButton onClick={onReEvaluate}>
            <PlaylistAddCheck />
          </IconButton>
        </Tooltip>

        <Tooltip title="Fetch missing data and re-evaluate" arrow placement="top" sx={tooltipStyles}>
          <IconButton onClick={onRefresh}>
            <Sync />
          </IconButton>
        </Tooltip>

        {selectedCount === 1 && (
          isChangepoint ? (
            <Tooltip title="Remove changepoint" arrow placement="top" sx={tooltipStyles}>
              <IconButton onClick={onRemoveChangepoint}>
                <Flag />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Mark as changepoint" arrow placement="top" sx={tooltipStyles}>
              <IconButton onClick={onMarkChangepoint}>
                <Flag />
              </IconButton>
            </Tooltip>
          )
        )}

        <Tooltip title="Delete" arrow placement="top" sx={tooltipStyles}>
          <IconButton onClick={onDelete} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear selection" arrow placement="top" sx={tooltipStyles}>
          <IconButton onClick={onClearSelection}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </Card>
  );
}
