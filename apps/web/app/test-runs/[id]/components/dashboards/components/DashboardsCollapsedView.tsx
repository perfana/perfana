'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { Dashboard } from '../types';
import { filterSystemTags } from '@perfana/shared/utils';

interface DashboardsCollapsedViewProps {
  dashboards: Dashboard[];
  dashboardsLoading: boolean;
  onTagClick: (tag: string) => void;
}

export function DashboardsCollapsedView({
  dashboards,
  dashboardsLoading,
  onTagClick,
}: DashboardsCollapsedViewProps) {
  // Collect all unique tags from dashboards
  const allTags = new Set<string>();
  dashboards.forEach((dashboard) => {
    if (dashboard.tags && Array.isArray(dashboard.tags)) {
      const filteredTags = filterSystemTags(dashboard.tags);
      filteredTags.forEach((tag: string) => {
        if (tag) {
          allTags.add(tag);
        }
      });
    }
  });

  const sortedTags = Array.from(allTags).sort();
  const displayTags = sortedTags.slice(0, 6); // Show max 6 tags

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={dashboardsLoading ? '—' : dashboards.length}
          label="Dashboards Configured"
          loading={dashboardsLoading}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {dashboards.length > 0 && displayTags.length > 0 ? (
          displayTags.map((tag, index) => (
            <SoftBadge
              key={index}
              label={tag}
              color="blue"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick(tag);
              }}
            />
          ))
        ) : (
          <SoftBadge
            label={dashboards.length === 0 ? "Click to load" : "No tags"}
            color="neutral"
          />
        )}
      </Box>
    </Box>
  );
}
