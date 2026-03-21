'use client';

import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { DynatraceEntityMapping } from '../types';

interface DynatraceCollapsedViewProps {
  loading: boolean;
  error: string | null;
  entityMappings: DynatraceEntityMapping[];
  serviceEntities: DynatraceEntityMapping[];
  hostEntities: DynatraceEntityMapping[];
  metricNames: string[];
}

export function DynatraceCollapsedView({
  loading,
  error,
  entityMappings,
  serviceEntities,
  hostEntities,
  metricNames,
}: DynatraceCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={loading ? '—' : error ? '!' : `${serviceEntities.length} / ${hostEntities.length}`}
          label="Services / Hosts"
          loading={loading}
          color={error ? 'error' : (serviceEntities.length > 0 || hostEntities.length > 0) ? 'primary' : 'neutral'}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {loading && (
          <SoftBadge label="Loading entities..." color="purple" />
        )}

        {!loading && !error && entityMappings.length > 0 && (
          <>
            {/* Show individual badges for each service entity (max 3) */}
            {entityMappings.slice(0, 3).map((mapping) => (
              <SoftBadge
                key={mapping.id}
                label={mapping.entityDisplayName}
                color="purple"
              />
            ))}

            {/* Show "More +n" badge if there are more than 3 mappings */}
            {entityMappings.length > 3 && (
              <SoftBadge
                count={entityMappings.length - 3}
                label="more"
                color="purple"
              />
            )}

            {/* Show metrics count if any */}
            {metricNames.length > 0 && (
              <SoftBadge
                count={metricNames.length}
                label="metrics"
                color="blue"
              />
            )}
          </>
        )}

        {!loading && error && (
          <SoftBadge label="Configuration error" color="red" />
        )}
      </Box>
    </Box>
  );
}
