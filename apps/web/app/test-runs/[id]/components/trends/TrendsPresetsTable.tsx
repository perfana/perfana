import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Typography,
  Box,
  Tooltip,
  Skeleton
} from '@mui/material';
import { Delete, PlayArrow } from '@mui/icons-material';
import { TrendsPreset, PresetType } from '@/lib/trends-presets';

export type { TrendsPreset } from '@/lib/trends-presets';

interface TrendsPresetsTableProps {
  presets: TrendsPreset[];
  loading: boolean;
  currentUserId?: string;
  onSelectPreset: (preset: TrendsPreset) => void;
  onDeletePreset: (presetId: string) => void;
}

export default function TrendsPresetsTable({
  presets,
  loading,
  currentUserId,
  onSelectPreset,
  onDeletePreset
}: TrendsPresetsTableProps) {
  if (loading) {
    return (
      <Box>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" height={60} sx={{ mb: 1 }} />
        ))}
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
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Dashboard</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Metric</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
            <TableCell align="center" sx={{ fontWeight: 600 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {presets.map((preset) => (
            <TableRow
              key={preset.id}
              hover
              sx={{
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: 'action.hover'
                }
              }}
            >
              <TableCell onClick={() => onSelectPreset(preset)}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {preset.name}
                </Typography>
                {preset.description && (
                  <Typography variant="caption" color="text.secondary">
                    {preset.description}
                  </Typography>
                )}
              </TableCell>
              <TableCell onClick={() => onSelectPreset(preset)}>
                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                  {preset.dashboard_label || 'Any'}
                </Typography>
              </TableCell>
              <TableCell onClick={() => onSelectPreset(preset)}>
                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                  {preset.panel_title || 'Any'}
                </Typography>
              </TableCell>
              <TableCell onClick={() => onSelectPreset(preset)}>
                <Chip
                  label={preset.preset_type === PresetType.GENERIC ? 'Generic' : 'Specific'}
                  size="small"
                  variant="outlined"
                  sx={{
                    borderColor: preset.preset_type === PresetType.GENERIC ? 'primary.main' : 'secondary.main',
                    color: preset.preset_type === PresetType.GENERIC ? 'primary.main' : 'secondary.main'
                  }}
                />
              </TableCell>
              <TableCell align="center">
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
                  <Tooltip title="Apply preset">
                    <IconButton
                      size="small"
                      onClick={() => onSelectPreset(preset)}
                      color="primary"
                    >
                      <PlayArrow fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {(preset.created_by === currentUserId || preset.is_global) && (
                    <Tooltip title="Delete preset">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePreset(preset.id);
                        }}
                        color="error"
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}