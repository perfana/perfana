'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  alpha,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';
import {
  PlayArrow,
  Delete
} from '@mui/icons-material';
import type { GraphPreset } from '@/lib/graph-presets';

interface GraphPresetsTableProps {
  presets: GraphPreset[];
  loading: boolean;
  currentUserId?: string;
  onSelectPreset: (preset: GraphPreset) => void;
  onDeletePreset: (presetId: string) => void;
  onDeleteAllPresets: () => void;
}

/**
 * GraphPresetsTable component displays saved graph presets in a table format
 *
 * Features:
 * - Table view with columns for name, description, series count, and creation date
 * - Load button to apply preset configuration
 * - Delete button (only for preset owner)
 * - Empty state with helpful message
 * - Loading state
 * - Confirmation dialog for deletions
 *
 * Design follows ComparePresetsTable pattern with Material-UI styling
 */
export default function GraphPresetsTable({
  presets,
  loading,
  currentUserId,
  onSelectPreset,
  onDeletePreset,
  onDeleteAllPresets
}: GraphPresetsTableProps) {
  const theme = useTheme();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<GraphPreset | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  const handleSelectPreset = (preset: GraphPreset) => {
    onSelectPreset(preset);
  };

  const handleDeleteClick = (preset: GraphPreset, event: React.MouseEvent) => {
    event.stopPropagation();
    setPresetToDelete(preset);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (presetToDelete) {
      onDeletePreset(presetToDelete.id);
      setDeleteDialogOpen(false);
      setPresetToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setPresetToDelete(null);
  };

  const handleDeleteAllClick = () => {
    setDeleteAllDialogOpen(true);
  };

  const handleDeleteAllConfirm = () => {
    onDeleteAllPresets();
    setDeleteAllDialogOpen(false);
  };

  const handleDeleteAllCancel = () => {
    setDeleteAllDialogOpen(false);
  };

  const canDelete = (preset: GraphPreset): boolean => {
    return preset.userId === currentUserId;
  };

  const userPresetsCount = presets.filter(p => p.userId === currentUserId).length;

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Loading presets...
        </Typography>
      </Box>
    );
  }

  if (presets.length === 0) {
    return (
      <Box sx={{
        p: 4,
        backgroundColor: 'rgba(25, 118, 210, 0.04)',
        borderRadius: 2,
        border: '1px solid rgba(25, 118, 210, 0.08)',
        textAlign: 'center'
      }}>
        <Box sx={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(30, 136, 229, 0.15) 100%)',
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          mx: 'auto',
          mb: 2,
          border: '1px solid rgba(25, 118, 210, 0.2)'
        }}>
          <span role="img" aria-label="Chart">📊</span>
        </Box>
        <Typography variant="h6" sx={{
          fontWeight: 600,
          color: 'text.primary',
          mb: 1
        }}>
          No Saved Graph Presets
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{
          lineHeight: 1.6,
          maxWidth: 400,
          mx: 'auto'
        }}>
          Create your first graph preset by adding metrics to your custom graph and clicking &quot;Save Preset&quot; to quickly reuse your graph configuration.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      {/* Delete All Button */}
      {userPresetsCount > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={handleDeleteAllClick}
            startIcon={<Delete />}
            sx={{
              '&:hover': {
                backgroundColor: 'error.alpha.8',
                borderColor: 'error.main'
              }
            }}
          >
            Delete All My Presets ({userPresetsCount})
          </Button>
        </Box>
      )}

      <Box sx={{
        mt: 2,
        p: 3,
        backgroundColor: 'rgba(25, 118, 210, 0.04)',
        borderRadius: 2,
        border: '1px solid rgba(25, 118, 210, 0.08)'
      }}>
        {/* Table Header */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '2fr 3fr 1fr 1fr 120px',
          gap: 2,
          p: 2,
          backgroundColor: 'action.hover',
          borderRadius: '4px 4px 0 0',
          border: '1px solid',
          borderColor: 'divider',
          borderBottom: 'none'
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Name</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Description</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Series Count</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Created</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Actions</Typography>
        </Box>

        {/* Table Rows */}
        {presets.map((preset) => (
          <Box
            key={preset.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: '2fr 3fr 1fr 1fr 120px',
              gap: 2,
              p: 2,
              mt: 0.75,
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.6),
              borderRadius: '4px',
              backgroundColor: 'background.paper',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                backgroundColor: 'action.hover',
                transform: 'translateY(-1px)',
                boxShadow: theme.palette.mode === 'dark' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.08)',
                borderColor: alpha(theme.palette.divider, 0.8)
              }
            }}
          >
            {/* Preset Name */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {preset.name}
              </Typography>
              {preset.isGlobal && (
                <Typography variant="caption" color="primary" sx={{ fontSize: '0.7rem', mt: 0.25, display: 'block' }}>
                  Global
                </Typography>
              )}
            </Box>

            {/* Description */}
            <Box>
              {preset.description ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                  {preset.description}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem', fontStyle: 'italic' }}>
                  No description
                </Typography>
              )}
            </Box>

            {/* Series Count */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                {(preset.seriesConfig || []).length} {(preset.seriesConfig || []).length === 1 ? 'series' : 'series'}
              </Typography>
            </Box>

            {/* Created Date */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                {formatDate(preset.createdAt)}
              </Typography>
            </Box>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Tooltip title="Load Preset">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectPreset(preset);
                  }}
                  sx={{
                    color: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.alpha.8',
                      color: 'primary.dark'
                    }
                  }}
                >
                  <PlayArrow fontSize="small" />
                </IconButton>
              </Tooltip>

              {canDelete(preset) && (
                <Tooltip title="Delete Preset">
                  <IconButton
                    size="small"
                    onClick={(e) => handleDeleteClick(preset, e)}
                    sx={{
                      color: 'text.secondary',
                      '&:hover': {
                        backgroundColor: 'error.alpha.8',
                        color: 'error.main'
                      }
                    }}
                  >
                    <Delete fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Graph Preset</DialogTitle>
        <DialogContent>
          <Typography>
            {`Are you sure you want to delete the preset "${presetToDelete?.name}"? This action cannot be undone.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={deleteAllDialogOpen} onClose={handleDeleteAllCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Delete All My Graph Presets</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Are you sure you want to delete all {userPresetsCount} of your graph preset{userPresetsCount === 1 ? '' : 's'}?
          </Typography>
          <Typography color="error" sx={{ fontWeight: 600, mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteAllCancel} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleDeleteAllConfirm} color="error" variant="contained">
            Delete All ({userPresetsCount})
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
