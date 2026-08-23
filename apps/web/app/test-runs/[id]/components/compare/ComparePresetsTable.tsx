'use client';

import type { CompareSeriesConfig } from '@/lib/compare-presets';
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

export interface ComparePreset {
  id: string;
  name: string;
  description?: string;
  preset_type: 'generic' | 'specific';
  series_search_text?: string;
  show_percentiles: boolean;
  series_config?: CompareSeriesConfig[];
  display_config?: {
    warningThreshold: number;
    regressionThreshold: number;
    minAbsolute: number;
    percentiles: { p90: boolean; p95: boolean; p99: boolean };
  };
  application_dashboard_id?: string;
  dashboard_label?: string;
  panel_id?: number;
  panel_title?: string;
  baseline_test_run_id?: string;
  baseline_application_release?: string;
  baseline_annotations?: string[];
  is_global: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ComparePresetsTableProps {
  presets: ComparePreset[];
  loading: boolean;
  currentUserId?: string;
  onSelectPreset: (preset: ComparePreset) => void;
  onDeletePreset: (presetId: string) => void;
}

export default function ComparePresetsTable({
  presets,
  loading,
  currentUserId,
  onSelectPreset,
  onDeletePreset
}: ComparePresetsTableProps) {
  const theme = useTheme();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<ComparePreset | null>(null);

  const handleSelectPreset = (preset: ComparePreset) => {
    onSelectPreset(preset);
  };

  const handleDeleteClick = (preset: ComparePreset, event: React.MouseEvent) => {
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



  const canDelete = (preset: ComparePreset): boolean => {
    return preset.created_by === currentUserId;
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
        p: 3,
        textAlign: 'center',
        backgroundColor: 'action.hover',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider'
      }}>
        <Typography variant="body2" color="text.secondary">
          No saved presets yet. Configure filters and save them as presets for quick access.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{
        mt: 2,
        p: 3,
        backgroundColor: 'action.hover',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider'
      }}>
        {/* Table Header - matching SLO table styling */}
        <Box sx={{ 
          display: 'grid',
          gridTemplateColumns: '1fr 2.5fr 1fr 120px',
          gap: 2,
          p: 2,
          backgroundColor: 'action.hover',
          borderRadius: '4px 4px 0 0',
          border: '1px solid',
          borderColor: 'divider',
          borderBottom: 'none'
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Preset Name</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Description</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Baseline</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Actions</Typography>
        </Box>

        {/* Table Rows */}
        {presets.map((preset) => (
          <Box
            key={preset.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 2.5fr 1fr 120px',
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
            
            {/* Baseline */}
            <Box>
              {preset.preset_type === 'specific' && preset.baseline_test_run_id ? (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.3, fontSize: '0.8rem' }}>
                    <strong>Locked to:</strong> {preset.baseline_test_run_id}
                  </Typography>
                  {preset.baseline_application_release && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.3, fontSize: '0.8rem' }}>
                      <strong>Version:</strong> {preset.baseline_application_release}
                    </Typography>
                  )}
                  {preset.baseline_annotations && preset.baseline_annotations.length > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                      <strong>Annotations:</strong> {preset.baseline_annotations.join(', ')}
                    </Typography>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                  -
                </Typography>
              )}
            </Box>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Tooltip title="Apply Preset">
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
        <DialogTitle>Delete Preset</DialogTitle>
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
    </>
  );
}