'use client';

import {
  TableRow,
  TableCell,
  Box,
  Typography,
  Chip,
  Tooltip,
  IconButton,
  Checkbox,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { ProfileDashboard } from '@/lib/profiles';
import { filterSystemTags, READ_ONLY_CHIP_SX } from '../utils';
import {
  SeparateDashboardChip,
  HardcodedVariablesChips,
  RegexRulesChips,
  TagsChips,
} from './VariableChips';

interface DashboardTableRowProps {
  dashboard: ProfileDashboard;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (dashboard: ProfileDashboard) => void;
  onDelete: (dashboard: ProfileDashboard) => void;
}

/**
 * Single row component for the dashboards table
 */
export function DashboardTableRow({
  dashboard,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: DashboardTableRowProps) {
  const filteredTags = filterSystemTags(dashboard.tags);

  return (
    <TableRow hover selected={isSelected}>
      <TableCell padding="checkbox">
        <Checkbox
          checked={isSelected}
          onChange={() => onSelect(dashboard.id)}
          inputProps={{ 'aria-label': `Select dashboard ${dashboard.dashboardName}` }}
        />
      </TableCell>
      <TableCell>
        <Box>
          <Typography variant="body2" fontWeight="medium">
            {dashboard.dashboardName}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ fontFamily: 'monospace' }}
          >
            UID: {dashboard.dashboardUid}
          </Typography>
          {dashboard.readOnly && (
            <Chip label="Read-only" size="small" sx={READ_ONLY_CHIP_SX} />
          )}
        </Box>
      </TableCell>
      <TableCell>
        <Typography variant="body2" color="text.secondary">
          {dashboard.grafanaLabel}
        </Typography>
      </TableCell>
      <TableCell>
        <TagsChips tags={filteredTags} />
      </TableCell>
      <TableCell>
        <SeparateDashboardChip value={dashboard.createSeparateDashboardForVariable} />
      </TableCell>
      <TableCell>
        <HardcodedVariablesChips variables={dashboard.setHardcodedValueForVariables} />
      </TableCell>
      <TableCell>
        <RegexRulesChips rules={dashboard.matchRegexForVariables} />
      </TableCell>
      <TableCell align="center">
        <Box display="flex" gap={0.5} justifyContent="center">
          <Tooltip title="Edit dashboard configuration">
            <IconButton
              size="small"
              onClick={() => onEdit(dashboard)}
              sx={{
                color: 'primary.main',
                '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.08)' },
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete dashboard association">
            <IconButton
              size="small"
              onClick={() => onDelete(dashboard)}
              sx={{
                color: 'error.main',
                '&:hover': { backgroundColor: 'rgba(244, 67, 54, 0.08)' },
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </TableCell>
    </TableRow>
  );
}
