'use client';

import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tooltip,
  Checkbox,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { DynatraceEntityMapping } from '../types';
import { getLevelDisplayName, getLevelColor } from '../utils';

interface EntityMappingsTableProps {
  mappings: DynatraceEntityMapping[];
  selectedMappingIds: Set<string>;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
  onDelete: (mapping: DynatraceEntityMapping) => void;
}

export function EntityMappingsTable({
  mappings,
  selectedMappingIds,
  onSelectAll,
  onSelectOne,
  onDelete,
}: EntityMappingsTableProps) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={selectedMappingIds.size > 0 && selectedMappingIds.size === mappings.length}
                indeterminate={selectedMappingIds.size > 0 && selectedMappingIds.size < mappings.length}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all entities' }}
              />
            </TableCell>
            <TableCell>Entity Name</TableCell>
            <TableCell>Entity Type</TableCell>
            <TableCell>Dynatrace Instance</TableCell>
            <TableCell>Level</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mappings.map((mapping) => (
            <TableRow key={mapping.id} hover selected={selectedMappingIds.has(mapping.id)}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedMappingIds.has(mapping.id)}
                  onChange={() => onSelectOne(mapping.id)}
                  inputProps={{ 'aria-label': `Select entity ${mapping.entityDisplayName}` }}
                />
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinkIcon color="primary" fontSize="small" />
                  <Typography variant="body2" fontWeight="medium">
                    {mapping.entityDisplayName}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  ID: {mapping.entityId}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  label={mapping.entityType}
                  size="small"
                  sx={{
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                    border: '1px solid rgba(156, 39, 176, 0.3)',
                    color: 'secondary.dark',
                  }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {mapping.dynatraceLabel || 'Unknown'}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  label={getLevelDisplayName(mapping.level)}
                  size="small"
                  color={getLevelColor(mapping.level)}
                  sx={{ fontWeight: 600 }}
                />
              </TableCell>
              <TableCell>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    onClick={() => onDelete(mapping)}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
