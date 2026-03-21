'use client';

import {
  Box,
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
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Dashboard as DashboardIcon,
} from '@mui/icons-material';
import { QueriesTableProps } from '../types';

export function QueriesTable({
  queries,
  selectedQueryIds,
  onSelectAll,
  onSelectOne,
  onEditQuery,
  onDeleteQuery,
}: QueriesTableProps) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={selectedQueryIds.size > 0 && selectedQueryIds.size === queries.length}
                indeterminate={selectedQueryIds.size > 0 && selectedQueryIds.size < queries.length}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all queries' }}
              />
            </TableCell>
            <TableCell>Dynatrace Instance</TableCell>
            <TableCell>Dashboard</TableCell>
            <TableCell>Panel Title</TableCell>
            <TableCell>Variables</TableCell>
            <TableCell>Variable Values</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {queries.map((query) => (
            <TableRow key={query.id} hover selected={selectedQueryIds.has(query.id)}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedQueryIds.has(query.id)}
                  onChange={() => onSelectOne(query.id)}
                  inputProps={{ 'aria-label': `Select query ${query.panelTitle}` }}
                />
              </TableCell>
              <TableCell>
                <Chip
                  label={query.dynatraceConfigLabel || 'Unknown'}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DashboardIcon color="primary" fontSize="small" />
                  <Typography variant="body2" fontWeight="medium">
                    {query.dashboardLabel}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {query.panelTitle}
                </Typography>
                {query.matchMetricPattern && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Pattern: {query.matchMetricPattern}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                {query.templateVariables && Object.keys(query.templateVariables).length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {Object.keys(query.templateVariables).map((key) => (
                      <Chip
                        key={key}
                        label={key}
                        sx={{
                          height: '24px',
                          fontWeight: 600,
                          backdropFilter: 'blur(8px)',
                          transition: 'all 0.2s ease',
                          background: (theme) => theme.palette.mode === 'dark'
                            ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                            : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                          border: (theme) => theme.palette.mode === 'dark'
                            ? '1px solid rgba(56, 142, 232, 0.5)'
                            : '1px solid rgba(25, 118, 210, 0.3)',
                          color: 'primary.main',
                          '&:hover': {
                            transform: 'translateY(-1px)',
                            boxShadow: (theme) => theme.palette.mode === 'dark'
                              ? '0 4px 12px rgba(56, 142, 232, 0.3)'
                              : '0 4px 12px rgba(25, 118, 210, 0.2)',
                            border: (theme) => theme.palette.mode === 'dark'
                              ? '1px solid rgba(56, 142, 232, 0.7)'
                              : '1px solid rgba(25, 118, 210, 0.5)',
                          },
                          '& .MuiChip-label': {
                            px: 1,
                            py: 0,
                            fontSize: '0.75rem',
                          },
                        }}
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No variables
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                {query.templateVariables && Object.keys(query.templateVariables).length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {Object.entries(query.templateVariables).map(([key, value]) => (
                      <Typography key={key} variant="caption">
                        <strong>{key}:</strong> {value}
                      </Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    -
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => onEditQuery(query)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => onDeleteQuery(query)} color="error">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
