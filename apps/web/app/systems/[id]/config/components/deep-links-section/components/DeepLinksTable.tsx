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
} from '@mui/icons-material';
import { DeepLinksTableProps } from '../types';

export function DeepLinksTable({
  deepLinks,
  selectedDeepLinkIds,
  onSelectAll,
  onSelectOne,
  onEdit,
  onDelete,
}: DeepLinksTableProps) {
  const isAllSelected = selectedDeepLinkIds.size > 0 && selectedDeepLinkIds.size === deepLinks.length;
  const isIndeterminate = selectedDeepLinkIds.size > 0 && selectedDeepLinkIds.size < deepLinks.length;

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={isAllSelected}
                indeterminate={isIndeterminate}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all deep links' }}
              />
            </TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Tags</TableCell>
            <TableCell>URL</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {deepLinks.map((deepLink) => (
            <TableRow
              key={deepLink.id}
              hover
              selected={selectedDeepLinkIds.has(deepLink.id)}
            >
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedDeepLinkIds.has(deepLink.id)}
                  onChange={() => onSelectOne(deepLink.id)}
                  inputProps={{ 'aria-label': `Select deep link ${deepLink.name}` }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {deepLink.name}
                </Typography>
                {deepLink.templateDeepLinkId && (
                  <Chip
                    label="Template"
                    sx={{
                      mt: 0.5,
                      height: '24px',
                      fontWeight: 600,
                      backdropFilter: 'blur(8px)',
                      transition: 'all 0.2s ease',
                      background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                      border: '1px solid rgba(156, 39, 176, 0.3)',
                      color: '#9c27b0',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(156, 39, 176, 0.2)',
                        border: '1px solid rgba(156, 39, 176, 0.5)',
                      },
                      '& .MuiChip-label': {
                        px: 1,
                        py: 0,
                        fontSize: '0.75rem'
                      }
                    }}
                  />
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 200 }}>
                  {(deepLink.tags ?? []).map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        background: 'linear-gradient(135deg, rgba(25,118,210,0.08) 0%, rgba(30,136,229,0.12) 100%)',
                        border: '1px solid rgba(25,118,210,0.3)',
                        color: 'primary.dark',
                        '& .MuiChip-label': { px: 0.75 },
                      }}
                    />
                  ))}
                </Box>
              </TableCell>
              <TableCell>
                <Typography
                  variant="body2"
                  sx={{
                    maxWidth: 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                  }}
                >
                  {deepLink.url}
                </Typography>
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      onClick={() => onEdit(deepLink)}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={() => onDelete(deepLink)}
                      color="error"
                    >
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
