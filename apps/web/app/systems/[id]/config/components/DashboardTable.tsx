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
  MonitorHeart as MonitorHeartIcon,
} from '@mui/icons-material';
import { ApplicationDashboard } from '@/lib/types';
import { filterSystemTags } from '@perfana/shared/utils';

// Artificial dashboards don't exist in Grafana - they're synthetic entries
const ARTIFICIAL_DASHBOARD_UID_PREFIXES = [
  'performance-test-metrics-',  // Performance metrics pipeline
  'dynatrace-',                  // Dynatrace host metrics
];

/**
 * Check if a dashboard is "artificial" (synthetic entry for metrics)
 * These dashboards don't actually exist in Grafana
 */
function isArtificialDashboard(dashboard: { dashboard_uid?: string }): boolean {
  const uid = dashboard.dashboard_uid;
  if (!uid) return false;
  return ARTIFICIAL_DASHBOARD_UID_PREFIXES.some(prefix => uid.startsWith(prefix));
}

interface DashboardTableProps {
  dashboards: ApplicationDashboard[];
  searchText: string;
  selectedTags: string[];
  selectedDashboardIds: Set<string>;
  onEdit: (dashboard: ApplicationDashboard) => void;
  onDelete: (dashboard: ApplicationDashboard) => void;
  onClearSearch: () => void;
  onClearTags: () => void;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
}

export default function DashboardTable({
  dashboards,
  searchText,
  selectedTags,
  selectedDashboardIds,
  onEdit,
  onDelete,
  onClearSearch,
  onClearTags,
  onSelectAll,
  onSelectOne
}: DashboardTableProps) {

  const getFilteredDashboards = () => {
    // First, filter out artificial dashboards (created by performance-metrics pipeline)
    // These should not be shown in the system under test config
    let filtered = dashboards.filter(d => !isArtificialDashboard(d));

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(d => 
        d.dashboard_name.toLowerCase().includes(searchLower) ||
        d.dashboard_label?.toLowerCase().includes(searchLower) ||
        d.tags?.some(t => t.toLowerCase().includes(searchLower))
      );
    }
    
    // Apply tag filter (OR logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(d => {
        const dashboardTags = filterSystemTags(d.tags || []);
        return selectedTags.some(tag => dashboardTags.includes(tag));
      });
    }
    
    return filtered;
  };

  const filteredDashboards = getFilteredDashboards();

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table stickyHeader sx={{ minWidth: 650 }} aria-label="application dashboards table">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ backgroundColor: 'background.paper' }}>
              <Checkbox
                checked={selectedDashboardIds.size > 0 && selectedDashboardIds.size === filteredDashboards.length}
                indeterminate={selectedDashboardIds.size > 0 && selectedDashboardIds.size < filteredDashboards.length}
                onChange={onSelectAll}
                inputProps={{ 'aria-label': 'Select all dashboards' }}
              />
            </TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Dashboard Name</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Label</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Variables</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Variable Values</strong></TableCell>
            <TableCell sx={{ backgroundColor: 'background.paper' }}><strong>Tags</strong></TableCell>
            <TableCell align="center" sx={{ backgroundColor: 'background.paper' }}><strong>Actions</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredDashboards.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  {searchText || selectedTags.length > 0
                    ? 'No dashboards match the current filters'
                    : 'No dashboards found'
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
            filteredDashboards.map((dashboard) => (
              <TableRow
                key={dashboard.id}
                hover
                selected={selectedDashboardIds.has(dashboard.id)}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedDashboardIds.has(dashboard.id)}
                    onChange={() => onSelectOne(dashboard.id)}
                    inputProps={{ 'aria-label': `Select dashboard ${dashboard.dashboard_name}` }}
                  />
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {dashboard.dashboard_name}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {dashboard.dashboard_label}
                  </Typography>
                </TableCell>
                <TableCell>
                  {dashboard.variables && dashboard.variables.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {dashboard.variables
                        .filter(variable => variable && !Array.isArray(variable) && typeof variable.name === 'string' && !['system_under_test', 'test_environment'].includes(variable.name))
                        .map((variable, index) => (
                          <Chip
                            key={index}
                            label={variable.name}
                            sx={{
                              height: '24px',
                              fontWeight: 600,
                              backdropFilter: 'blur(8px)',
                              transition: 'all 0.2s ease',
                              background: (theme) => theme.palette.mode === 'dark'
                                ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                                : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                              border: (theme) => theme.palette.mode === 'dark'
                                ? '1px solid rgba(56, 142, 232, 0.5)' : '1px solid rgba(25, 118, 210, 0.3)',
                              color: (theme) => theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: (theme) => theme.palette.mode === 'dark'
                                  ? '0 4px 12px rgba(56, 142, 232, 0.3)' : '0 4px 12px rgba(25, 118, 210, 0.2)',
                                border: (theme) => theme.palette.mode === 'dark'
                                  ? '1px solid rgba(56, 142, 232, 0.7)' : '1px solid rgba(25, 118, 210, 0.5)',
                              },
                              '& .MuiChip-label': {
                                px: 1,
                                py: 0,
                                fontSize: '0.75rem'
                              }
                            }}
                          />
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No variables
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {dashboard.variables && dashboard.variables.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {dashboard.variables
                        .filter(variable => variable && !Array.isArray(variable) && typeof variable.name === 'string' && !['system_under_test', 'test_environment'].includes(variable.name))
                        .map((variable, index) => {
                          // Display variable values
                          const displayValue = Array.isArray(variable.values) ? variable.values.join(', ') : variable.values;
                          return (
                            <Typography key={index} variant="caption">
                              <strong>{variable.name}:</strong> {displayValue || '(empty)'}
                            </Typography>
                          );
                        })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      -
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {dashboard.tags && dashboard.tags.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {filterSystemTags(dashboard.tags).map((tag, index) => (
                          <Chip
                            key={index}
                            label={tag}
                            sx={{
                              height: '24px',
                              fontWeight: 600,
                              backdropFilter: 'blur(8px)',
                              transition: 'all 0.2s ease',
                              background: (theme) => theme.palette.mode === 'dark'
                                ? 'linear-gradient(135deg, rgba(186, 104, 200, 0.18) 0%, rgba(186, 104, 200, 0.28) 100%)'
                                : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                              border: (theme) => theme.palette.mode === 'dark'
                                ? '1px solid rgba(186, 104, 200, 0.5)' : '1px solid rgba(156, 39, 176, 0.3)',
                              color: (theme) => theme.palette.mode === 'dark' ? '#ce93d8' : '#9c27b0',
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: (theme) => theme.palette.mode === 'dark'
                                  ? '0 4px 12px rgba(186, 104, 200, 0.3)' : '0 4px 12px rgba(156, 39, 176, 0.2)',
                                border: (theme) => theme.palette.mode === 'dark'
                                  ? '1px solid rgba(186, 104, 200, 0.7)' : '1px solid rgba(156, 39, 176, 0.5)',
                              },
                              '& .MuiChip-label': {
                                px: 1,
                                py: 0,
                                fontSize: '0.75rem'
                              }
                            }}
                          />
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No tags
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                    {/* Only show "View in Grafana" for real dashboards, not artificial ones from performance-metrics pipeline */}
                    {!isArtificialDashboard(dashboard) && (
                      <Tooltip title="View in Grafana">
                        <IconButton
                          size="small"
                          disabled
                          onClick={() => {
                            // Grafana instance details need to be loaded separately
                          }}
                        >
                          <MonitorHeartIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    
                    <Tooltip title="Edit Configuration">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(dashboard)}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title="Delete Configuration">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDelete(dashboard)}
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
  );
}