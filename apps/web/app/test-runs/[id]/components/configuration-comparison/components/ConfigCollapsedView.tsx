'use client';

import React from 'react';
import { Box } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { ConfigComparison, ConfigItem } from '../types';
import { countUnexpectedChanges, hasUnexpectedChanges } from '../utils/comparison-formatters';

interface ConfigCollapsedViewProps {
  configLoading: boolean;
  configComparisons: ConfigComparison[];
  selectedRelatedTestRun: string;
  testRunConfigs: ConfigItem[];
}

export function ConfigCollapsedView({
  configLoading,
  configComparisons,
  selectedRelatedTestRun,
  testRunConfigs,
}: ConfigCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI */}
      <Box sx={{ py: 1 }}>
        {configLoading ? (
          <KPIDisplay value="—" label="Config Changes" loading={true} />
        ) : (
          <KPIDisplay
            value={countUnexpectedChanges(configComparisons)}
            label="Config Changes"
            color={hasUnexpectedChanges(configComparisons) ? 'warning' : 'success'}
          />
        )}
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {configLoading ? (
          <SoftBadge label="Comparing configs..." color="blue" />
        ) : selectedRelatedTestRun && configComparisons.length > 0 ? (
          <>
            {configComparisons.filter(c => c.status === 'same').length > 0 && (
              <SoftBadge
                count={configComparisons.filter(c => c.status === 'same').length}
                label="unchanged"
                color="green"
              />
            )}
            {configComparisons.filter(c => c.status === 'changed' && !c.isExpected).length > 0 && (
              <SoftBadge
                count={configComparisons.filter(c => c.status === 'changed' && !c.isExpected).length}
                label="changed"
                color="orange"
              />
            )}
            {configComparisons.filter(c => c.status === 'new' && !c.isExpected).length > 0 && (
              <SoftBadge
                count={configComparisons.filter(c => c.status === 'new' && !c.isExpected).length}
                label="added"
                color="blue"
              />
            )}
            {configComparisons.filter(c => c.status === 'removed' && !c.isExpected).length > 0 && (
              <SoftBadge
                count={configComparisons.filter(c => c.status === 'removed' && !c.isExpected).length}
                label="removed"
                color="red"
              />
            )}
            {configComparisons.filter(c => c.isExpected).length > 0 && (
              <SoftBadge
                count={configComparisons.filter(c => c.isExpected).length}
                label="ignored"
                color="neutral"
              />
            )}
          </>
        ) : !selectedRelatedTestRun && testRunConfigs.length > 0 ? (
          <SoftBadge
            count={testRunConfigs.length}
            label={`configuration${testRunConfigs.length !== 1 ? 's' : ''}`}
            color="green"
          />
        ) : null}
      </Box>
    </Box>
  );
}
