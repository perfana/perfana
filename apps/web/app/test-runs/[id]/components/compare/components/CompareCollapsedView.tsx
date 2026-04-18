'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { ComparePreset } from '../ComparePresetsTable';
import { DataSource, RelatedTestRun } from '../types';

interface CompareCollapsedViewProps {
  presets: ComparePreset[];
  _presetsLoading: boolean;
  loading: boolean;
  availableSources: DataSource[];
  relatedTestRuns: RelatedTestRun[];
}

export function CompareCollapsedView({
  presets,
  presetsLoading,
  loading,
  availableSources,
  relatedTestRuns,
}: CompareCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={loading ? '—' : presets.length}
          label="Saved Presets"
          loading={loading}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {(() => {
          // Show available sources as badges
          if (availableSources.length > 0) {
            return (
              <>
                {availableSources.includes('grafana') && (
                  <SoftBadge label="Grafana Metrics" color="blue" />
                )}
                {availableSources.includes('dynatrace') && (
                  <SoftBadge label="Dynatrace Metrics" color="purple" />
                )}
                {availableSources.includes('performance-metrics') && (
                  <SoftBadge label="Performance Metrics" color="green" />
                )}
              </>
            );
          } else if (!loading) {
            return (
              <SoftBadge label="No dashboards available" color="orange" />
            );
          } else {
            return (
              <SoftBadge label="Statistical Comparison" color="blue" />
            );
          }
        })()}

        {relatedTestRuns.length > 0 && !loading && (
          <SoftBadge
            count={relatedTestRuns.length}
            label="test runs available"
            color="green"
          />
        )}
      </Box>
    </Box>
  );
}

export default CompareCollapsedView;
