'use client';

import {
  Box,
  Typography,
  CircularProgress,
  Chip,
  TextField,
  IconButton,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { Dashboard } from '../types';
import { DashboardCard } from './DashboardCard';

interface DashboardsExpandedContentProps {
  dashboards: Dashboard[];
  filteredDashboards: Dashboard[];
  dashboardsLoading: boolean;
  allDashboardTags: string[];
  selectedDashboardTags: string[];
  dashboardSearchText: string;
  systemName?: string;
  testEnvironment?: string;
  onSearchChange: (text: string) => void;
  onTagToggle: (tag: string) => void;
  onViewDashboard: (dashboard: Dashboard) => void;
  onOpenInGrafana: (dashboard: Dashboard) => void;
}

export function DashboardsExpandedContent({
  dashboards,
  filteredDashboards,
  dashboardsLoading,
  allDashboardTags,
  selectedDashboardTags,
  dashboardSearchText,
  systemName,
  testEnvironment,
  onSearchChange,
  onTagToggle,
  onViewDashboard,
  onOpenInGrafana,
}: DashboardsExpandedContentProps) {
  return (
    <>
      {/* Dashboard Search */}
      {dashboards.length > 0 && (
        <Box mb={3}>
          <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
            Search Dashboards
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder="Search dashboards by label..."
            value={dashboardSearchText}
            onChange={(e) => onSearchChange(e.target.value)}
            sx={{ mb: 2 }}
            InputProps={{
              endAdornment: dashboardSearchText && (
                <IconButton
                  size="small"
                  onClick={() => onSearchChange('')}
                  sx={{ mr: -1 }}
                >
                  <Close fontSize="small" />
                </IconButton>
              )
            }}
          />
        </Box>
      )}

      {/* Dashboard Tag Filters */}
      {dashboards.length > 0 && allDashboardTags.length > 0 && (
        <Box mb={3}>
          <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
            Filter by Tags
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {allDashboardTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                clickable
                onClick={() => onTagToggle(tag)}
                sx={{
                  height: '32px',
                  fontWeight: 600,
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  background: (theme) =>
                    selectedDashboardTags.includes(tag)
                      ? theme.palette.mode === 'dark'
                        ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.20) 0%, rgba(66, 165, 245, 0.28) 100%)'
                        : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)'
                      : theme.palette.mode === 'dark'
                        ? 'linear-gradient(135deg, rgba(206, 147, 216, 0.15) 0%, rgba(186, 104, 200, 0.22) 100%)'
                        : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                  border: (theme) =>
                    selectedDashboardTags.includes(tag)
                      ? theme.palette.mode === 'dark'
                        ? '1px solid rgba(100, 181, 246, 0.5)'
                        : '1px solid rgba(25, 118, 210, 0.3)'
                      : theme.palette.mode === 'dark'
                        ? '1px solid rgba(206, 147, 216, 0.4)'
                        : '1px solid rgba(156, 39, 176, 0.3)',
                  color: (theme) =>
                    selectedDashboardTags.includes(tag)
                      ? theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark
                      : theme.palette.mode === 'dark' ? '#ce93d8' : '#9c27b0',
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: (theme) =>
                      selectedDashboardTags.includes(tag)
                        ? theme.palette.mode === 'dark'
                          ? '0 4px 12px rgba(100, 181, 246, 0.3)'
                          : '0 4px 12px rgba(25, 118, 210, 0.2)'
                        : theme.palette.mode === 'dark'
                          ? '0 4px 12px rgba(206, 147, 216, 0.3)'
                          : '0 4px 12px rgba(156, 39, 176, 0.2)',
                    border: (theme) =>
                      selectedDashboardTags.includes(tag)
                        ? theme.palette.mode === 'dark'
                          ? '1px solid rgba(100, 181, 246, 0.7)'
                          : '1px solid rgba(25, 118, 210, 0.5)'
                        : theme.palette.mode === 'dark'
                          ? '1px solid rgba(206, 147, 216, 0.6)'
                          : '1px solid rgba(156, 39, 176, 0.5)',
                  },
                  '& .MuiChip-label': {
                    px: 1.5,
                    py: 0,
                    fontSize: '0.8rem'
                  }
                }}
              />
            ))}
          </Box>
          {(selectedDashboardTags.length > 0 || dashboardSearchText.length > 0) && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing {filteredDashboards.length} of {dashboards.length} dashboards
              {dashboardSearchText && ` matching "${dashboardSearchText}"`}
              {selectedDashboardTags.length > 0 && ` with tags: ${selectedDashboardTags.join(', ')}`}
            </Typography>
          )}
        </Box>
      )}

      {/* Dashboard Grid or Loading/Empty State */}
      {dashboardsLoading ? (
        <Box display="flex" justifyContent="center" py={2}>
          <CircularProgress size={24} />
        </Box>
      ) : filteredDashboards.length > 0 ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 2,
            '@media (max-width: 1200px)': {
              gridTemplateColumns: 'repeat(3, 1fr)'
            },
            '@media (max-width: 900px)': {
              gridTemplateColumns: 'repeat(2, 1fr)'
            },
            '@media (max-width: 600px)': {
              gridTemplateColumns: '1fr'
            }
          }}
        >
          {filteredDashboards.map((dashboard) => (
            <DashboardCard
              key={dashboard.id}
              dashboard={dashboard}
              onView={onViewDashboard}
              onOpenInGrafana={onOpenInGrafana}
            />
          ))}
        </Box>
      ) : (
        <Box textAlign="center" py={4}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {dashboards.length === 0
              ? "No dashboards configured for this system and environment."
              : (selectedDashboardTags.length > 0 || dashboardSearchText.length > 0)
                ? (() => {
                    const filters = [];
                    if (dashboardSearchText) filters.push(`search "${dashboardSearchText}"`);
                    if (selectedDashboardTags.length > 0) filters.push(`tags: ${selectedDashboardTags.join(', ')}`);
                    return `No dashboards match the current filters (${filters.join(' and ')})`;
                  })()
                : "No dashboards available."
            }
          </Typography>
          {dashboards.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              System: <strong>{systemName}</strong>{' '}
              Environment: <strong>{testEnvironment}</strong>
            </Typography>
          ) : (selectedDashboardTags.length > 0 || dashboardSearchText.length > 0) ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Try clearing the search or changing filters to see more results.
            </Typography>
          ) : null}
        </Box>
      )}
    </>
  );
}
