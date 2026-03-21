import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Tooltip,
  IconButton,
  Checkbox,
  Toolbar,
  Paper,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { ProfileBenchmark } from '@/lib/profile-benchmarks';
import { getUnit } from '@/lib/units';

interface ProfileBenchmarksTableProps {
  benchmarks: ProfileBenchmark[];
  loading: boolean;
  error: string;
  selectedBenchmarkIds: Set<string>;
  onEdit: (benchmark: ProfileBenchmark) => void;
  onDelete: (benchmarkId: string) => void;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
  onBatchDelete: () => void;
}

// Helper function to parse value and unit from input
const parseValueWithUnit = (input: string): { value: string; unit: string; unitId: string } => {
  const match = input.match(/^([\d.]+)\s*([a-zA-Z%°Ω/µ]+)?$/);
  if (match && match[2]) {
    // Map common unit formats to their IDs
    const unitFormatMap: Record<string, string> = {
      'ms': 'ms',
      's': 's',
      'm': 'm',
      'h': 'h',
      'd': 'd',
      'ns': 'ns',
      'µs': 'µs',
      'us': 'µs',
      'μs': 'µs',
      'B': 'decbytes',
      'KB': 'deckbytes',
      'MB': 'decmbytes',
      'GB': 'decgbytes',
      'TB': 'dectbytes',
      'bytes': 'decbytes',
      'KiB': 'kbytes',
      'MiB': 'mbytes',
      'GiB': 'gbytes',
      'TiB': 'tbytes',
      '%': 'percent',
      'Mbps': 'Mbits',
      'Gbps': 'Gbits',
      'ops/sec': 'ops',
      'req/s': 'reqps',
      'rps': 'rps',
      'rpm': 'rpm',
      '°C': 'celsius',
      '°F': 'fahrenheit',
      'K': 'kelvin',
      'W': 'watt',
      'kW': 'kwatt',
      'MW': 'megwatt',
      'V': 'volt',
      'A': 'amp',
      'mA': 'mamp',
      'Ω': 'ohm',
      'Hz': 'hertz'
    };

    const unitId = unitFormatMap[match[2]] || match[2];
    return { value: match[1], unit: match[2], unitId };
  }
  return { value: input, unit: '', unitId: '' };
};

/**
 * Table component displaying Service Level Objectives (SLOs) for a profile
 * Shows benchmarks configured at the profile level to be auto-applied to test runs
 */
export default function ProfileBenchmarksTable({
  benchmarks,
  loading,
  error,
  selectedBenchmarkIds,
  onEdit,
  onDelete,
  onSelectAll,
  onSelectOne,
  onBatchDelete,
}: ProfileBenchmarksTableProps) {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <>
      {/* Batch Actions Toolbar */}
      {selectedBenchmarkIds.size > 0 && (
        <Paper sx={{ mb: 2 }}>
          <Toolbar
            sx={{
              pl: { sm: 2 },
              pr: { xs: 1, sm: 1 },
              bgcolor: 'rgba(25, 118, 210, 0.08)',
            }}
          >
            <Typography
              sx={{ flex: '1 1 100%' }}
              color="primary"
              variant="subtitle1"
              component="div"
            >
              {selectedBenchmarkIds.size} SLO{selectedBenchmarkIds.size > 1 ? 's' : ''} selected
            </Typography>
            <Tooltip title="Delete selected">
              <IconButton onClick={onBatchDelete} color="error">
                <DeleteIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear selection">
              <IconButton onClick={() => onSelectAll()}>
                <CloseIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </Paper>
      )}

      <TableContainer>
      <Table sx={{ minWidth: 650 }} aria-label="profile service level objectives table">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={selectedBenchmarkIds.size > 0 && selectedBenchmarkIds.size === benchmarks.length}
                indeterminate={selectedBenchmarkIds.size > 0 && selectedBenchmarkIds.size < benchmarks.length}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all SLOs' }}
              />
            </TableCell>
            <TableCell><strong>Metric</strong></TableCell>
            <TableCell><strong>Workload Pattern</strong></TableCell>
            <TableCell><strong>Evaluation</strong></TableCell>
            <TableCell><strong>Requirement</strong></TableCell>
            <TableCell><strong>Tags</strong></TableCell>
            <TableCell align="center"><strong>Actions</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {benchmarks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  No SLOs found
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            benchmarks.map((benchmark) => (
              <TableRow
                key={benchmark.id}
                hover
                selected={selectedBenchmarkIds.has(benchmark.id)}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedBenchmarkIds.has(benchmark.id)}
                    onChange={() => onSelectOne(benchmark.id)}
                    inputProps={{ 'aria-label': `Select SLO ${benchmark.panelTitle}` }}
                  />
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {benchmark.panelTitle || 'Unnamed Metric'}
                    </Typography>
                    {benchmark.dashboardLabel && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {benchmark.dashboardLabel}
                      </Typography>
                    )}
                    {benchmark.grafanaInstance && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {benchmark.grafanaInstance}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={benchmark.workloadPattern}
                    sx={{
                      height: '32px',
                      fontWeight: 600,
                      backdropFilter: 'blur(8px)',
                      transition: 'all 0.2s ease',
                      background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                      border: '1px solid rgba(25, 118, 210, 0.3)',
                      color: 'primary.dark',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                        border: '1px solid rgba(25, 118, 210, 0.5)',
                      },
                      '& .MuiChip-label': {
                        px: 1.5,
                        py: 0,
                        fontSize: '0.8rem'
                      }
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {(() => {
                      const evaluateTypeLabels: Record<string, string> = {
                        'avg': 'Average',
                        'max': 'Maximum',
                        'min': 'Minimum',
                        'last': 'Last Value',
                        'q50': '50th Percentile',
                        'q90': '90th Percentile',
                        'q95': '95th Percentile',
                        'q99': '99th Percentile'
                      };
                      return evaluateTypeLabels[benchmark.evaluateType || ''] || benchmark.evaluateType || 'N/A';
                    })()}
                  </Typography>
                </TableCell>
                <TableCell>
                  {benchmark.requirementOperator && benchmark.requirementValue !== null && benchmark.requirementValue !== undefined ? (
                    <Typography variant="body2" fontWeight="medium">
                      {(() => {
                        // First check if requirement_value is a string with unit already included
                        const requirementValueStr = String(benchmark.requirementValue);
                        const parsedValue = parseValueWithUnit(requirementValueStr);

                        let displayValue = requirementValueStr;
                        let unitSuffix = '';

                        if (parsedValue.unit) {
                          // Unit is already in the requirement_value
                          displayValue = requirementValueStr;
                        } else if (benchmark.metricUnit) {
                          // Get unit from metric_unit
                          const unit = getUnit(benchmark.metricUnit);
                          unitSuffix = unit.format ? ` ${unit.format}` : ` ${benchmark.metricUnit}`;

                          // Handle percentunit conversion (0.0-1.0 to percentage)
                          if (benchmark.metricUnit === 'percentunit') {
                            displayValue = String(Math.round(Number(benchmark.requirementValue) * 10000) / 100);
                          }
                        }

                        const finalValue = `${displayValue}${unitSuffix}`;

                        switch (benchmark.requirementOperator) {
                          case 'lt': return `Less than ${finalValue}`;
                          case 'gt': return `Greater than ${finalValue}`;
                          case 'lte': return `Less than or equal ${finalValue}`;
                          case 'gte': return `Greater than or equal ${finalValue}`;
                          case 'eq': return `Equal to ${finalValue}`;
                          case 'ne': return `Not equal to ${finalValue}`;
                          default: return `${benchmark.requirementOperator} ${finalValue}`;
                        }
                      })()}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No requirement
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {benchmark.tags && benchmark.tags.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                      {benchmark.tags.slice(0, 3).map((tag, index) => (
                        <Chip
                          key={index}
                          label={tag}
                          sx={{
                            height: '32px',
                            fontWeight: 600,
                            backdropFilter: 'blur(8px)',
                            transition: 'all 0.2s ease',
                            background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                            border: '1px solid rgba(25, 118, 210, 0.3)',
                            color: 'primary.dark',
                            '&:hover': {
                              transform: 'translateY(-1px)',
                              boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                              border: '1px solid rgba(25, 118, 210, 0.5)',
                            },
                            '& .MuiChip-label': {
                              px: 1.5,
                              py: 0,
                              fontSize: '0.8rem'
                            }
                          }}
                        />
                      ))}
                      {benchmark.tags.length > 3 && (
                        <Chip
                          label={`+${benchmark.tags.length - 3} more`}
                          sx={{
                            height: '32px',
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
                              px: 1.5,
                              py: 0,
                              fontSize: '0.8rem'
                            }
                          }}
                        />
                      )}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No tags
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                    <Tooltip title="Edit SLO">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(benchmark)}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Delete SLO">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDelete(benchmark.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
    </>
  );
}
