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
  IconButton,
  Tooltip,
  Button,
  Checkbox
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Assessment as AssessmentIcon,
} from '@mui/icons-material';
import { Benchmark } from './types';
import { getUnit } from '@/lib/units';

interface SLOTableProps {
  benchmarks: Benchmark[];
  searchText: string;
  selectedTags: string[];
  selectedSloIds: Set<string>;
  onEdit: (benchmark: Benchmark) => void;
  onDelete: (benchmark: Benchmark) => void;
  onView: (benchmark: Benchmark) => void;
  onClearSearch: () => void;
  onClearTags: () => void;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
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

export default function SLOTable({
  benchmarks,
  searchText,
  selectedTags,
  selectedSloIds,
  onEdit,
  onDelete,
  onView,
  onClearSearch,
  onClearTags,
  onSelectAll,
  onSelectOne
}: SLOTableProps) {
  const getFilteredBenchmarks = () => {
    let filtered = benchmarks;
    
    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(b => 
        b.panel_title?.toLowerCase().includes(searchLower) ||
        b.description?.toLowerCase().includes(searchLower) ||
        b.config_title?.toLowerCase().includes(searchLower) ||
        b.dashboard_label?.toLowerCase().includes(searchLower)
      );
    }
    
    // Apply tag filter (OR logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(b => 
        selectedTags.some(tag => b.tags?.includes(tag))
      );
    }
    
    return filtered;
  };

  const filteredBenchmarks = getFilteredBenchmarks();

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table stickyHeader sx={{ minWidth: 650 }} aria-label="service level objectives table">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ backgroundColor: 'background.paper' }}>
              <Checkbox
                checked={selectedSloIds.size > 0 && selectedSloIds.size === filteredBenchmarks.length}
                indeterminate={selectedSloIds.size > 0 && selectedSloIds.size < filteredBenchmarks.length}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all SLOs' }}
              />
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Metric</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Source</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Evaluation</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Requirement</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Tags</strong></TableCell>
            <TableCell align="center" sx={{ backgroundColor: 'background.paper' }}><strong>Actions</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredBenchmarks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {searchText || selectedTags.length > 0
                    ? 'No SLOs match the current filters'
                    : 'No SLOs found'
                  }
                </Typography>
                {(searchText || selectedTags.length > 0) && (
                  <Box sx={{ mt: 1, display: 'flex', gap: 1, justifyContent: 'center' }}>
                    {searchText && (
                      <Button 
                        size="small" 
                        onClick={onClearSearch} 
                      >
                        Clear search
                      </Button>
                    )}
                    {selectedTags.length > 0 && (
                      <Button 
                        size="small" 
                        onClick={onClearTags} 
                      >
                        Clear tags
                      </Button>
                    )}
                  </Box>
                )}
              </TableCell>
            </TableRow>
          ) : (
            filteredBenchmarks.map((benchmark) => (
            <TableRow
              key={benchmark.id}
              hover
              selected={selectedSloIds.has(benchmark.id)}
            >
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedSloIds.has(benchmark.id)}
                  onChange={() => onSelectOne(benchmark.id)}
                  inputProps={{ 'aria-label': `Select SLO ${benchmark.config_title || benchmark.panel_title}` }}
                />
              </TableCell>
              <TableCell>
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    {benchmark.config_title || benchmark.panel_title || 'Unnamed Metric'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {benchmark.description}
                  </Typography>
                  {benchmark.dashboard_label && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Dashboard: {benchmark.dashboard_label}
                    </Typography>
                  )}
                  {benchmark.source === 'grafana' && benchmark.grafana_instance && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Grafana: {benchmark.grafana_instance}
                    </Typography>
                  )}
                </Box>
              </TableCell>
              <TableCell>
                <Chip
                  label={benchmark.source}
                  sx={{
                    height: '32px',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease',
                    background: (theme) => {
                      const isDark = theme.palette.mode === 'dark';
                      return benchmark.source === 'grafana'
                        ? isDark
                          ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                          : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)'
                        : isDark
                          ? 'linear-gradient(135deg, rgba(186, 104, 200, 0.18) 0%, rgba(186, 104, 200, 0.28) 100%)'
                          : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)';
                    },
                    border: (theme) => {
                      const isDark = theme.palette.mode === 'dark';
                      return benchmark.source === 'grafana'
                        ? `1px solid rgba(${isDark ? '56, 142, 232, 0.5' : '25, 118, 210, 0.3'})`
                        : `1px solid rgba(${isDark ? '186, 104, 200, 0.5' : '156, 39, 176, 0.3'})`;
                    },
                    color: benchmark.source === 'grafana'
                      ? 'primary.main'
                      : 'secondary.main',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: (theme) => {
                        const isDark = theme.palette.mode === 'dark';
                        return benchmark.source === 'grafana'
                          ? `0 4px 12px rgba(${isDark ? '56, 142, 232, 0.3' : '25, 118, 210, 0.2'})`
                          : `0 4px 12px rgba(${isDark ? '186, 104, 200, 0.3' : '156, 39, 176, 0.2'})`;
                      },
                      border: (theme) => {
                        const isDark = theme.palette.mode === 'dark';
                        return benchmark.source === 'grafana'
                          ? `1px solid rgba(${isDark ? '56, 142, 232, 0.7' : '25, 118, 210, 0.5'})`
                          : `1px solid rgba(${isDark ? '186, 104, 200, 0.7' : '156, 39, 176, 0.5'})`;
                      },
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
                    return evaluateTypeLabels[benchmark.evaluate_type || ''] || benchmark.evaluate_type || 'N/A';
                  })()}
                </Typography>
              </TableCell>
              <TableCell>
                {benchmark.requirement_operator && benchmark.requirement_value !== null ? (
                  <Typography variant="body2" fontWeight="medium">
                    {(() => {
                      // First check if requirement_value is a string with unit already included
                      const requirementValueStr = String(benchmark.requirement_value);
                      const parsedValue = parseValueWithUnit(requirementValueStr);
                      
                      let displayValue = requirementValueStr;
                      let unitSuffix = '';
                      
                      if (parsedValue.unit) {
                        // Unit is already in the requirement_value
                        displayValue = requirementValueStr;
                      } else if (benchmark.metric_unit) {
                        // Get unit from metric_unit
                        const unit = getUnit(benchmark.metric_unit);
                        // If unit has a format, use it (works for both known units and unknown fallback)
                        // For units like 'short' or 'none' with empty format, no suffix is added
                        if (unit.format) {
                          unitSuffix = ` ${unit.format}`;
                        }

                        // Handle percentunit conversion (0.0-1.0 to percentage)
                        if (benchmark.metric_unit === 'percentunit') {
                          displayValue = String(Math.round(Number(benchmark.requirement_value) * 10000) / 100);
                        }
                      }
                      
                      const finalValue = `${displayValue}${unitSuffix}`;
                      
                      switch (benchmark.requirement_operator) {
                        case 'lt': return `Less than ${finalValue}`;
                        case 'gt': return `Greater than ${finalValue}`;
                        case 'lte': return `Less than or equal ${finalValue}`;
                        case 'gte': return `Greater than or equal ${finalValue}`;
                        case 'eq': return `Equal to ${finalValue}`;
                        case 'ne': return `Not equal to ${finalValue}`;
                        default: return `${benchmark.requirement_operator} ${finalValue}`;
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
                          background: (theme) => theme.palette.mode === 'dark'
                            ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                            : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                          border: (theme) => theme.palette.mode === 'dark'
                            ? '1px solid rgba(56, 142, 232, 0.5)'
                            : '1px solid rgba(25, 118, 210, 0.3)',
                          color: 'primary.main',
                          '&:hover': {
                            transform: 'translateY(-1px)',
                            boxShadow: (theme) => theme.palette.mode === 'dark'
                              ? '0 4px 12px rgba(56, 142, 232, 0.3)'
                              : '0 4px 12px rgba(25, 118, 210, 0.2)',
                            border: (theme) => theme.palette.mode === 'dark'
                              ? '1px solid rgba(56, 142, 232, 0.7)'
                              : '1px solid rgba(25, 118, 210, 0.5)',
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
                {benchmark.benchmark_type === 'apdex' ? (
                  <Tooltip title="Apdex SLOs can be configured via the SLO Results card in Test Run details">
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      Configure in SLO Results
                    </Typography>
                  </Tooltip>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                    <Tooltip title="View Details">
                      <IconButton
                        size="small"
                        onClick={() => onView(benchmark)}
                      >
                        <AssessmentIcon />
                      </IconButton>
                    </Tooltip>

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
                        onClick={() => onDelete(benchmark)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </TableCell>
            </TableRow>
          ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}