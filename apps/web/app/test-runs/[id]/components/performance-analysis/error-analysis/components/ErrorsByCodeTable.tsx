'use client';

import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';
import FancyChip from '../../../shared/FancyChip';
import { ErrorByCode } from '../types';
import { calculateErrorPercentage } from '../utils/error-formatters';

interface ErrorsByCodeTableProps {
  errorsByCode: ErrorByCode[];
}

export function ErrorsByCodeTable({ errorsByCode }: ErrorsByCodeTableProps) {
  const totalErrors = errorsByCode.reduce((sum, item) => sum + item.errorCount, 0);
  const sortedErrorsByCode = [...errorsByCode].sort((a, b) => b.errorCount - a.errorCount);

  return (
    <Paper
      sx={{
        p: 3,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <ErrorIcon sx={{ mr: 1.5, color: 'error.main', fontSize: 28 }} />
        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            color: 'text.primary',
          }}
        >
          Errors by Code
        </Typography>
      </Box>
      <TableContainer sx={{ maxHeight: 400, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'primary.dark',
                  backgroundColor: 'rgba(25, 118, 210, 0.04)',
                  borderBottom: '2px solid',
                  borderBottomColor: 'primary.main',
                  py: 1.5,
                }}
              >
                Code
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'primary.dark',
                  backgroundColor: 'rgba(25, 118, 210, 0.04)',
                  borderBottom: '2px solid',
                  borderBottomColor: 'primary.main',
                  py: 1.5,
                }}
              >
                Errors
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'primary.dark',
                  backgroundColor: 'rgba(25, 118, 210, 0.04)',
                  borderBottom: '2px solid',
                  borderBottomColor: 'primary.main',
                  py: 1.5,
                }}
              >
                % of Total
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedErrorsByCode.map((row, index) => {
              const percentage = calculateErrorPercentage(row.errorCount, totalErrors);
              return (
                <TableRow
                  key={row.responseCode}
                  hover
                  sx={{
                    backgroundColor: index % 2 === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.02)',
                    '&:hover': {
                      backgroundColor: 'rgba(244, 67, 54, 0.04)',
                    },
                    transition: 'background-color 0.2s ease',
                  }}
                >
                  <TableCell sx={{ py: 1.5 }}>
                    <FancyChip
                      label={row.responseCode}
                      colorTheme="red"
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ py: 1.5 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        color: 'error.main',
                        fontFamily: 'monospace',
                        fontSize: '0.875rem',
                      }}
                    >
                      {row.errorCount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ py: 1.5 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.875rem',
                        color: 'text.primary',
                        fontWeight: 600,
                      }}
                    >
                      {percentage.toFixed(1)}%
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default ErrorsByCodeTable;
