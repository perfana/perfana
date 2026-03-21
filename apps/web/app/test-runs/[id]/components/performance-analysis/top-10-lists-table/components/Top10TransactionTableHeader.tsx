'use client';

import {
  TableHead,
  TableRow,
  TableCell,
  TableSortLabel,
} from '@mui/material';
import { Top10TableSortField, Top10TableSortOrder } from '../types';

export interface Top10TransactionTableHeaderProps {
  dimensionIndex: number;
  sortField?: Top10TableSortField;
  sortOrder?: Top10TableSortOrder;
  hasDrillDownOptions: boolean;
  showErrorCount?: boolean;
  onSort: (dimensionIndex: number, field: Top10TableSortField) => void;
}

export function Top10TransactionTableHeader({
  dimensionIndex,
  sortField,
  sortOrder,
  hasDrillDownOptions,
  showErrorCount,
  onSort,
}: Top10TransactionTableHeaderProps) {
  return (
    <TableHead>
      <TableRow>
        <TableCell sx={{ fontWeight: 700, width: '5%', backgroundColor: 'action.hover' }}>
          #
        </TableCell>
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '20%' : '25%', backgroundColor: 'action.hover' }}>
          <TableSortLabel
            active={sortField === 'scenarioName'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'scenarioName')}
          >
            Scenario
          </TableSortLabel>
        </TableCell>
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '40%' : '45%', backgroundColor: 'action.hover' }}>
          <TableSortLabel
            active={sortField === 'transactionName'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'transactionName')}
          >
            Transaction
          </TableSortLabel>
        </TableCell>
        {showErrorCount && (
          <TableCell sx={{ fontWeight: 700, width: '10%', textAlign: 'right', backgroundColor: 'action.hover' }}>
            Errors
          </TableCell>
        )}
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '20%' : '25%', textAlign: 'right', backgroundColor: 'action.hover' }}>
          <TableSortLabel
            active={sortField === 'value'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'value')}
            sx={{
              flexDirection: 'row-reverse',
              '& .MuiTableSortLabel-icon': {
                marginLeft: 0,
                marginRight: '4px',
              },
            }}
          >
            Value
          </TableSortLabel>
        </TableCell>
        {hasDrillDownOptions && (
          <TableCell sx={{ fontWeight: 700, width: '5%', textAlign: 'center', backgroundColor: 'action.hover' }}>
            Actions
          </TableCell>
        )}
      </TableRow>
    </TableHead>
  );
}
