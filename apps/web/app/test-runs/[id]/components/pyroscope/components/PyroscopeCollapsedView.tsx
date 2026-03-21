'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';

interface PyroscopeCollapsedViewProps {
  applications: string[];
  profilers: string[];
}

export function PyroscopeCollapsedView({
  applications,
  profilers,
}: PyroscopeCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={profilers.length}
          label="Profiler Types"
          color={profilers.length > 0 ? 'primary' : 'neutral'}
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
        {applications.length > 0 ? (
          <>
            {applications.slice(0, 2).map((app) => (
              <SoftBadge key={app} label={app} color="blue" />
            ))}
            {applications.length > 2 && (
              <SoftBadge
                count={applications.length - 2}
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
