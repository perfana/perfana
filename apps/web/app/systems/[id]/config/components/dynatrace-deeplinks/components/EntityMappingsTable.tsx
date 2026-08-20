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
  Checkbox,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { DynatraceEntityMapping } from '../types';
import { RequiresPermission } from '@/components/auth/RequiresPermission';
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
                {/* The button is the direct child: RequiresPermission clones it with
                    `disabled` and supplies its own tooltip when denied. Nesting a
                    MUI Tooltip in between would receive the `disabled` prop instead. */}
                <RequiresPermission
                  action="integration:dynatrace:delete"
                  orgId={mapping.organizationId}
                  resourcePermissions={mapping._permissions}
                  disabledReason="You do not have permission to delete this mapping"
                >
                  <IconButton
                    size="small"
                    title="Delete"
                    aria-label="Delete mapping"
                    onClick={() => onDelete(mapping)}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </RequiresPermission>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
