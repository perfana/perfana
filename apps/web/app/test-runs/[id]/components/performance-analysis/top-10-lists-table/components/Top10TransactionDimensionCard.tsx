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
import { Top10TransactionItem, Top10TableDimension, Top10TableSortField, Top10TableSortOrder } from '../types';
import { Top10TransactionTableHeader } from './Top10TransactionTableHeader';
import { Top10TransactionTableRow } from './Top10TransactionTableRow';

export interface Top10TransactionDimensionCardProps {
  dimension: Top10TableDimension;
  dimensionIndex: number;
  sortedData: Top10TransactionItem[];
  sortField?: Top10TableSortField;
  sortOrder?: Top10TableSortOrder;
  hasDrillDownOptions: boolean;
  onSort: (dimensionIndex: number, field: Top10TableSortField) => void;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10TransactionItem) => void;
}

export function Top10TransactionDimensionCard({
  dimension,
  dimensionIndex,
  sortedData,
  sortField,
  sortOrder,
  hasDrillDownOptions,
  onSort,
  onOpenActionMenu,
}: Top10TransactionDimensionCardProps) {
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

      <TableContainer sx={{ maxHeight: 500 }}>
        <Table stickyHeader size="small">
          <Top10TransactionTableHeader
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
                <TableCell colSpan={(hasDrillDownOptions ? 5 : 4) + (dimension.showErrorCount ? 1 : 0)} sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    No data available
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item, idx) => (
                <Top10TransactionTableRow
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
