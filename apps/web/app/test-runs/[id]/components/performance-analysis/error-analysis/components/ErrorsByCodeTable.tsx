'use client';

import {
  Box,
  Typography,
  Paper,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { PieChart as PieChartIcon } from '@mui/icons-material';
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
      elevation={2}
      sx={{
        p: 3,
        borderLeft: '4px solid #e91e63',
        backgroundColor: 'background.paper',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ color: '#e91e63', display: 'flex', alignItems: 'center' }}>
          <PieChartIcon />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
          Errors by Code
        </Typography>
      </Box>

      <Divider sx={{ mb: 2 }} />

      <TableContainer sx={{ maxHeight: 400, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, backgroundColor: 'background.paper' }}>Code</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'background.paper' }}>
                Errors
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'background.paper' }}>
                % of Total
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedErrorsByCode.map((row) => {
              const percentage = calculateErrorPercentage(row.errorCount, totalErrors);
              return (
                <TableRow key={row.responseCode} hover>
                  <TableCell>
                    <FancyChip label={row.responseCode} colorTheme="red" />
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: 'error.main', fontFamily: 'monospace' }}
                    >
                      {row.errorCount.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
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
