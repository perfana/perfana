'use client';

import { useCallback } from 'react';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, DynatraceEntity, DynatraceEntityMapping, RelatedTestRun } from '../types';
import {
  buildServiceFilterParam,
  buildDeepLinkUrl,
  buildMDAUrl,
  buildComparisonUrl,
  MANAGED_UI_FILTER_LINK_TYPES,
} from '../utils/dynatrace-formatters';

interface UseDynatraceHandlersProps {
  testRun: TestRun;
  configs: DynatraceConfig[];
  selectedMetric: string | null;
  minDuration: string;
  maxDuration: string;
}

export function useDynatraceHandlers({
  testRun,
  configs,
  selectedMetric,
  minDuration,
  maxDuration,
}: UseDynatraceHandlersProps) {
  // Handle deep link click
  const handleDeepLinkClick = useCallback((entity: DynatraceEntity, linkType: string) => {
    if (configs.length === 0) return;

    // Target the instance this entity was mapped from, not always the first one.
    const config = configs.find(c => c.id === entity.dynatraceConfigId) ?? configs[0];
    // Managed /ui/services/* routes reject the classic-hash filter encoding.
    const isManagedUiRoute =
      config.dynatraceType !== 'saas' && MANAGED_UI_FILTER_LINK_TYPES.has(linkType);
    const serviceFilterParam = buildServiceFilterParam(
      config,
      testRun.test_run_id,
      selectedMetric,
      minDuration,
      maxDuration,
      isManagedUiRoute ? 'ui' : 'classic'
    );

    const url = buildDeepLinkUrl(
      linkType,
      entity,
      config,
      testRun,
      serviceFilterParam ? `&servicefilter=${serviceFilterParam}` : ''
    );

    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Handle multidimensional analysis click
  const handleMultiDimensionalAnalysis = useCallback((entity: DynatraceEntity, analysisType: string) => {
    if (configs.length === 0) return;

    // Target the instance this entity was mapped from, not always the first one.
    const config = configs.find(c => c.id === entity.dynatraceConfigId) ?? configs[0];
    // Managed MDA is served from /ui/services/*/mda, which needs the ui encoding.
    const serviceFilterParam = buildServiceFilterParam(
      config,
      testRun.test_run_id,
      selectedMetric,
      minDuration,
      maxDuration,
      config.dynatraceType !== 'saas' ? 'ui' : 'classic'
    );

    const url = buildMDAUrl(
      analysisType,
      entity,
      config,
      testRun,
      serviceFilterParam
    );

    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Handle comparison click
  const handleComparisonClick = useCallback((
    mapping: DynatraceEntityMapping,
    selectedComparisonTestRun: RelatedTestRun
  ) => {
    if (configs.length === 0 || !selectedComparisonTestRun) return;

    // Target the instance this mapping was configured from, not always the first one.
    const config = configs.find(c => c.id === mapping.dynatraceConfigId) ?? configs[0];
    const url = buildComparisonUrl(
      mapping.entityId,
      config,
      testRun,
      selectedComparisonTestRun,
      selectedMetric,
      minDuration,
      maxDuration
    );

    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Convert entity mapping to DynatraceEntity
  const mappingToEntity = useCallback((mapping: DynatraceEntityMapping): DynatraceEntity => ({
    entityId: mapping.entityId,
    displayName: mapping.entityDisplayName,
    type: mapping.entityType,
  }), []);

  return {
    handleDeepLinkClick,
    handleMultiDimensionalAnalysis,
    handleComparisonClick,
    mappingToEntity,
  };
}
