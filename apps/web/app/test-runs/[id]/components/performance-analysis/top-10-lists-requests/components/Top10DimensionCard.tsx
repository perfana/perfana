'use client';

import {
  Box,
  Paper,
  Typography,
  Divider,
  Table,
  TableBody,
  TableContainer,
  TableRow,
  TableCell,
} from '@mui/material';
import { Top10Item, Top10Dimension, Top10SortField, Top10SortOrder } from '../types';
import { Top10TableHeader } from './Top10TableHeader';
import { Top10TableRow } from './Top10TableRow';

export interface Top10DimensionCardProps {
  dimension: Top10Dimension;
  dimensionIndex: number;
  sortedData: Top10Item[];
  sortField?: Top10SortField;
  sortOrder?: Top10SortOrder;
  hasDrillDownOptions: boolean;
  onSort: (dimensionIndex: number, field: Top10SortField) => void;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10Item) => void;
}

export function Top10DimensionCard({
  dimension,
  dimensionIndex,
  sortedData,
  sortField,
  sortOrder,
  hasDrillDownOptions,
  onSort,
  onOpenActionMenu,
}: Top10DimensionCardProps) {
  return (
    <Paper
      elevation={2}
      sx={{
        p: 3,
        borderLeft: `4px solid ${dimension.color}`,
        backgroundColor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ color: dimension.color, display: 'flex', alignItems: 'center' }}>
          {dimension.icon}
        </Box>
        <Typography
          variant="h6"
          sx={{ fontWeight: 700, fontSize: '1rem' }}
          title={dimension.description}
        >
          {dimension.title}
        </Typography>
      </Box>

      <Divider sx={{ mb: 2 }} />

      <TableContainer>
        <Table size="small">
          <Top10TableHeader
            dimensionIndex={dimensionIndex}
            sortField={sortField}
            sortOrder={sortOrder}
            hasDrillDownOptions={hasDrillDownOptions}
            showErrorCount={dimension.showErrorCount}
            onSort={onSort}
          />
          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={(hasDrillDownOptions ? 6 : 5) + (dimension.showErrorCount ? 1 : 0)} sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    No data available
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item, idx) => (
                <Top10TableRow
                  key={idx}
                  item={item}
                  index={idx}
                  dimension={dimension}
                  hasDrillDownOptions={hasDrillDownOptions}
                  showErrorCount={dimension.showErrorCount}
                  onOpenActionMenu={onOpenActionMenu}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
