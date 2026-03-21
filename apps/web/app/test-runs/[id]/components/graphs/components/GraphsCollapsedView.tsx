'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { GraphPreset } from '@/lib/graph-presets';
import { ApplicationDashboard, SeriesConfig } from '../types';

interface GraphsCollapsedViewProps {
  presets: GraphPreset[];
  presetsLoading: boolean;
  dashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  addedSeries: SeriesConfig[];
}

export function GraphsCollapsedView({
  presets,
  presetsLoading,
  dashboards,
  dashboardsLoading,
  addedSeries,
}: GraphsCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={presetsLoading ? '—' : presets.length}
          label="Saved Graph Presets"
          loading={presetsLoading}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {dashboards.length > 0 ? (
          <>
            <SoftBadge
              count={dashboards.length}
              label="dashboards"
              color="blue"
            />
            {addedSeries.length > 0 && (
              <SoftBadge
                count={addedSeries.length}
                label="active series"
                color="green"
              />
            )}
          </>
        ) : dashboardsLoading ? (
          <SoftBadge label="Loading dashboards..." color="blue" />
        ) : (
          <SoftBadge label="No dashboards available" color="orange" />
        )}
      </Box>
    </Box>
  );
}
