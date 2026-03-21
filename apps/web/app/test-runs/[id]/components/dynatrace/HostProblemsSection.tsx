'use client';

import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip
} from '@mui/material';
import { Warning, CheckCircle } from '@mui/icons-material';
import { HostProblemResponse } from '@/lib/dynatrace';

interface HostProblemsSectionProps {
  problems: HostProblemResponse[];
}

export default function HostProblemsSection({
  problems
}: HostProblemsSectionProps) {
  const getSeverityColor = (severity: string): string => {
    const severityMap: Record<string, string> = {
      CRITICAL: '#f44336',
      HIGH: '#ff9800',
      MEDIUM: '#ffc107',
      LOW: '#2196f3',
    };
    return severityMap[severity.toUpperCase()] || '#9e9e9e';
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString();
  };

  const formatTimeRange = (start: string, end?: string): string => {
    const startTime = formatTimestamp(start);
    if (!end) return `${startTime} - Ongoing`;
    return `${startTime} - ${formatTimestamp(end)}`;
  };

  return (
    <Paper
      elevation={1}
      sx={{
        p: 4,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Problems & Health Status
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Detected issues and health events during test execution
        </Typography>
      </Box>

      {problems.length === 0 ? (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            borderRadius: 2,
            backgroundColor: 'rgba(76, 175, 80, 0.05)',
            border: '1px solid rgba(76, 175, 80, 0.2)',
          }}
        >
          <CheckCircle
            sx={{
              fontSize: '3rem',
              color: 'rgba(76, 175, 80, 0.8)',
              mb: 1,
            }}
          />
          <Typography variant="body1" sx={{ fontWeight: 600, color: 'rgba(76, 175, 80, 0.8)' }}>
            No problems detected during test
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Host was healthy throughout the test execution
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Severity</TableCell>
                <TableCell>Problem Title</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Time Range</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problems.map((problem) => (
                <TableRow key={problem.problemId} hover>
                  <TableCell>
                    <Chip
                      icon={<Warning />}
                      label={problem.severityLevel}
                      size="small"
                      sx={{
                        backgroundColor: `${getSeverityColor(problem.severityLevel)}15`,
                        color: getSeverityColor(problem.severityLevel),
                        fontWeight: 600,
                        '& .MuiChip-icon': {
                          color: getSeverityColor(problem.severityLevel),
                        },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {problem.title}
                    </Typography>
                    {problem.impactLevel && (
                      <Typography variant="caption" color="text.secondary">
                        Impact: {problem.impactLevel}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={problem.status}
                      size="small"
                      color={problem.status === 'RESOLVED' ? 'success' : 'warning'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatTimeRange(problem.startTime, problem.endTime)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
