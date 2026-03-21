'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { TrendsPreset } from '../TrendsPresetsTable';

interface TrendsCollapsedViewProps {
  presets: TrendsPreset[];
  presetsLoading: boolean;
}

export function TrendsCollapsedView({
  presets,
  presetsLoading,
}: TrendsCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={presetsLoading ? '—' : presets.length}
          label="Saved Presets"
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
        {presetsLoading ? (
          <SoftBadge label="Loading..." color="blue" />
        ) : presets.length > 0 ? (
          <>
            <SoftBadge
              count={presets.length}
              label={presets.length === 1 ? 'preset' : 'presets'}
              color="blue"
            />
            {(() => {
              const presetDashboards = presets
                .filter(preset => preset.application_dashboard_id)
                .map(preset => preset.dashboard_label || 'Dashboard')
                .filter(label => label !== null);

              const uniqueDashboards = Array.from(new Set(presetDashboards));

              return uniqueDashboards.slice(0, 2).map((dashboard, index) => (
                <SoftBadge
                  key={index}
                  label={dashboard}
                  color="purple"
                />
              ));
            })()}
          </>
        ) : (
          <>
            <SoftBadge label="Metric Visualization" color="blue" />
            <SoftBadge label="Historical Analysis" color="purple" />
          </>
        )}
      </Box>
    </Box>
  );
}
