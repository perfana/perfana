'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  BaselinePreviewItem,
  SortColumn,
  SortDirection,
  getApdexColor,
  DEFAULT_MIN_SAMPLES,
} from '../types';

interface TransactionPreviewTableProps {
  scenarioNames: string[];
  groupedItems: Record<string, BaselinePreviewItem[]>;
  sortBy: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}

export function TransactionPreviewTable({
  scenarioNames,
  groupedItems,
  sortBy,
  sortDirection,
  onSort,
}: TransactionPreviewTableProps) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Transaction Thresholds Preview
      </Typography>

      {scenarioNames.map((scenarioName) => {
        const items = groupedItems[scenarioName] || [];
        const achievableCount = items.filter((i) => i.achievable).length;
        const displayName = scenarioName === 'default' ? 'Default Scenario' : scenarioName;

        return (
          <Accordion key={scenarioName} defaultExpanded sx={{ mb: 1 }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ bgcolor: 'rgba(0, 0, 0, 0.02)' }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                <Typography variant="subtitle1" fontWeight={500}>
                  {displayName}
                </Typography>
                <Chip
                  label={`${items.length} transactions`}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={`${achievableCount} achievable`}
                  size="small"
                  color={achievableCount === items.length ? 'success' : 'warning'}
                />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        <TableSortLabel
                          active={sortBy === 'transaction_name'}
                          direction={sortBy === 'transaction_name' ? sortDirection : 'asc'}
                          onClick={() => onSort('transaction_name')}
                        >
                          Transaction
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'current_threshold'}
                          direction={sortBy === 'current_threshold' ? sortDirection : 'asc'}
                          onClick={() => onSort('current_threshold')}
                        >
                          Current (ms)
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'calculated_threshold'}
                          direction={sortBy === 'calculated_threshold' ? sortDirection : 'asc'}
                          onClick={() => onSort('calculated_threshold')}
                        >
                          Calculated (ms)
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'sample_count'}
                          direction={sortBy === 'sample_count' ? sortDirection : 'asc'}
                          onClick={() => onSort('sample_count')}
                        >
                          Samples
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">Current Apdex</TableCell>
                      <TableCell align="center">Projected Apdex</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow
                        key={`${item.transaction_name}-${index}`}
                        hover
                        sx={{
                          bgcolor: item.achievable ? 'inherit' : 'rgba(244, 67, 54, 0.05)',
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {item.transaction_name}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontFamily="monospace">
                            {item.current_threshold ?? 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            fontFamily="monospace"
                            sx={{
                              fontWeight:
                                item.calculated_threshold !== item.current_threshold ? 600 : 400,
                              color:
                                item.calculated_threshold !== item.current_threshold
                                  ? 'primary.main'
                                  : 'text.primary',
                            }}
                          >
                            {item.calculated_threshold ?? 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            fontFamily="monospace"
                            color={
                              item.sample_count < DEFAULT_MIN_SAMPLES
                                ? 'warning.main'
                                : 'text.primary'
                            }
                          >
                            {item.sample_count}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={item.current_apdex?.toFixed(3) ?? 'N/A'}
                            size="small"
                            sx={{
                              backgroundColor: getApdexColor(item.current_apdex),
                              color: '#fff',
                              minWidth: 65,
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={item.projected_apdex?.toFixed(3) ?? 'N/A'}
                            size="small"
                            sx={{
                              backgroundColor: getApdexColor(item.projected_apdex),
                              color: '#fff',
                              minWidth: 65,
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          {/* The API always sends a reason; without it "N/A" is unexplainable. */}
                          <Tooltip title={item.message ?? ''}>
                            <Chip
                              label={item.achievable ? 'OK' : 'N/A'}
                              size="small"
                              color={item.achievable ? 'success' : 'default'}
                              variant={item.achievable ? 'filled' : 'outlined'}
                            />
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}
