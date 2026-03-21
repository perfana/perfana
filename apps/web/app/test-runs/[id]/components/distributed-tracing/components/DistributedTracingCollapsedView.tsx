'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { DistributedTracingCollapsedViewProps } from '../types';

/**
 * Get UI type badge color based on tracing type
 */
function getUiTypeBadgeColor(uiType: string): 'blue' | 'purple' | 'green' {
  switch (uiType) {
    case 'tempo':
      return 'blue';
    case 'jaeger':
      return 'purple';
    case 'elastic':
      return 'green';
    default:
      return 'blue';
  }
}

export function DistributedTracingCollapsedView({
  loading,
  tracingServices,
  totalServiceNames,
  uiTypes,
}: DistributedTracingCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={loading ? '—' : (!tracingServices || tracingServices.length === 0) ? 0 : totalServiceNames}
          label="Services Configured"
          loading={loading}
          color={(!tracingServices || tracingServices.length === 0) ? 'neutral' : 'primary'}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'center',
        }}
      >
        {uiTypes.length > 0 ? (
          <>
            {uiTypes.slice(0, 2).map((uiType) => (
              <SoftBadge
                key={uiType}
                label={uiType.toUpperCase()}
                color={getUiTypeBadgeColor(uiType)}
              />
            ))}
            {uiTypes.length > 2 && (
              <SoftBadge
                count={uiTypes.length - 2}
                label="more"
                color="blue"
              />
            )}
          </>
        ) : (
          <SoftBadge label="No configuration" color="orange" />
        )}
      </Box>
    </Box>
  );
}
