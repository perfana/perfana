'use client';

import {
  TableCell,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import { SortField, SortOrder } from '../types/performance-analysis.types';

export interface TransactionsTableHeaderProps {
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
}

export function TransactionsTableHeader({
  sortField,
  sortOrder,
  onSort,
}: TransactionsTableHeaderProps) {
  return (
    <TableRow sx={{ backgroundColor: 'rgba(0, 0, 0, 0.04)' }}>
      <TableCell sx={{ width: 48, fontWeight: 700 }} />
      <TableCell sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'transaction_name'}
          direction={sortField === 'transaction_name' ? sortOrder : 'asc'}
          onClick={() => onSort('transaction_name')}
        >
          Transaction Name
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'avg_response_time'}
          direction={sortField === 'avg_response_time' ? sortOrder : 'asc'}
          onClick={() => onSort('avg_response_time')}
        >
          Avg Response (ms)
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'p95_response_time'}
          direction={sortField === 'p95_response_time' ? sortOrder : 'asc'}
          onClick={() => onSort('p95_response_time')}
        >
          95th Pct (ms)
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'p99_response_time'}
          direction={sortField === 'p99_response_time' ? sortOrder : 'asc'}
          onClick={() => onSort('p99_response_time')}
        >
          99th Pct (ms)
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'passed_count'}
          direction={sortField === 'passed_count' ? sortOrder : 'asc'}
          onClick={() => onSort('passed_count')}
        >
          Passed
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'failed_count'}
          direction={sortField === 'failed_count' ? sortOrder : 'asc'}
          onClick={() => onSort('failed_count')}
        >
          Failed
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'error_rate'}
          direction={sortField === 'error_rate' ? sortOrder : 'asc'}
          onClick={() => onSort('error_rate')}
        >
          Errors %
        </TableSortLabel>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        Apdex Threshold
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        <TableSortLabel
          active={sortField === 'apdex_score'}
          direction={sortField === 'apdex_score' ? sortOrder : 'asc'}
          onClick={() => onSort('apdex_score')}
        >
          Apdex Score
        </TableSortLabel>
      </TableCell>
      <TableCell align="center" sx={{ fontWeight: 700 }}>
        Actions
      </TableCell>
    </TableRow>
  );
}
