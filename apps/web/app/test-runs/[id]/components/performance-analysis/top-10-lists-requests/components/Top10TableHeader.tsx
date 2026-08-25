'use client';

import {
  TableHead,
  TableRow,
  TableCell,
  TableSortLabel,
} from '@mui/material';
import { Top10SortField, Top10SortOrder } from '../types';

export interface Top10TableHeaderProps {
  /**
   * Header over the value column. Defaults to 'Value'; each dimension names its
   * own unit, because an unlabelled bare number (the impact score) reads as ms.
   */
  valueHeader?: string;
  dimensionIndex: number;
  sortField?: Top10SortField;
  sortOrder?: Top10SortOrder;
  hasDrillDownOptions: boolean;
  showErrorCount?: boolean;
  onSort: (dimensionIndex: number, field: Top10SortField) => void;
}

export function Top10TableHeader({
  dimensionIndex,
  sortField,
  sortOrder,
  hasDrillDownOptions,
  showErrorCount,
  onSort,
  valueHeader = 'Value',
}: Top10TableHeaderProps) {
  return (
    <TableHead>
      <TableRow>
        <TableCell sx={{ fontWeight: 700, width: '5%' }}>#</TableCell>
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '12%' : '15%' }}>
          <TableSortLabel
            active={sortField === 'scenarioName'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'scenarioName')}
          >
            Scenario
          </TableSortLabel>
        </TableCell>
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '12%' : '15%' }}>
          <TableSortLabel
            active={sortField === 'transactionName'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'transactionName')}
          >
            Transaction
          </TableSortLabel>
        </TableCell>
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '40%' : '45%' }}>
          <TableSortLabel
            active={sortField === 'requestName'}
            direction={sortOrder || 'asc'}
            onClick={() => onSort(dimensionIndex, 'requestName')}
          >
            Request
          </TableSortLabel>
        </TableCell>
        {showErrorCount && (
          <TableCell sx={{ fontWeight: 700, width: '10%', textAlign: 'right' }}>
            Errors
          </TableCell>
        )}
        <TableCell sx={{ fontWeight: 700, width: hasDrillDownOptions ? '15%' : '20%', textAlign: 'right' }}>
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
            {valueHeader}
          </TableSortLabel>
        </TableCell>
        {hasDrillDownOptions && (
          <TableCell sx={{ fontWeight: 700, width: '5%', textAlign: 'center' }}>
            Actions
          </TableCell>
        )}
      </TableRow>
    </TableHead>
  );
}
